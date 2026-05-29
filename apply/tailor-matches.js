#!/usr/bin/env node
/**
 * Tailors a resume for every match in today's job-radar output.
 * Designed to run after src/main.py inside the GH Actions workflow.
 *
 * For each match:
 *   1. Take the JD text already on the match object.
 *   2. Tailor to 90-95% coverage (caps at 95%, never 100%).
 *   3. Write DOCX + PDF to state/tailored/{date}/{company}-{role}-{score}.{pdf,docx}.
 *   4. Build state/tailored/{date}/index.json with all matches + paths.
 *
 * Caps: MAX_TAILOR=50 per run to keep workflow under 60min.
 * Skips: anything already in state/tailored/{date}/ from a prior run.
 *
 * Env:
 *   TAILOR_PROFILE=job-radar (default)
 *   TAILOR_MAX=50
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RESUME_DIR = path.join(ROOT, 'data', 'resume');
const masterData = require(path.join(RESUME_DIR, 'resume-data'));
const { buildDocx } = require(path.join(RESUME_DIR, 'build-docx'));
const { buildPdf } = require(path.join(RESUME_DIR, 'build-pdf'));
const { extractJdSkills, isPresent, properCase } =
  require(path.join(RESUME_DIR, 'lib', 'jd-keywords'));
const profile = require(path.join(RESUME_DIR, '..', 'resume_profile.json'));

const PROFILE = process.env.TAILOR_PROFILE || 'job-radar';
const MAX_TAILOR = parseInt(process.env.TAILOR_MAX || '50', 10);
const TARGET_MIN = 0.90;
const TARGET_MAX = 0.95;

const date = new Date().toISOString().slice(0, 10);
const matchesPath = path.join(ROOT, 'state', 'matches', `${date}-${PROFILE}.json`);
const outDir = path.join(ROOT, 'state', 'tailored', date);

if (!fs.existsSync(matchesPath)) {
  console.log(`No matches file at ${matchesPath} — nothing to tailor.`);
  process.exit(0);
}
fs.mkdirSync(outDir, { recursive: true });

const matches = JSON.parse(fs.readFileSync(matchesPath, 'utf8'));
console.log(`Found ${matches.length} matches. Cap: ${MAX_TAILOR}/run.\n`);

const CATEGORY_MAP = {
  languages: 'Languages', backend: 'Backend', frontend: 'Frontend',
  databases: 'Databases', cloud: 'Cloud & DevOps', ai_ml: 'AI & ML',
  security: 'Security', concepts: 'Concepts',
};
function categoryOf(skill) {
  for (const [cat, list] of Object.entries(profile.skills)) {
    if (list.includes(skill.toLowerCase())) return cat;
  }
  return null;
}

const CORE_KEEPERS = new Set([
  'python', 'javascript', 'typescript', 'c#', 'java', 'sql',
  'react', 'next.js', 'django', 'fastapi', '.net core',
  'azure', 'aws', 'kubernetes', 'docker', 'terraform', 'github actions',
  'rest api', 'rest apis', 'microservices architecture',
  'large language models (llm, llms)', 'retrieval-augmented generation (rag)',
  'agentic ai', 'ai agents', 'langchain', 'azure openai (gpt-4)',
  'system design', 'distributed systems',
].map(s => s.toLowerCase()));

function flattenResume(d) {
  return [
    d.summary,
    ...Object.values(d.skills).flat(),
    ...d.experience.flatMap(j => [j.title, j.company, ...j.bullets]),
    ...d.projects.flatMap(p => [p.name, p.stack, ...p.bullets]),
    ...d.certifications.flatMap(c => [c.name, c.issuer]),
  ].join(' \n ').toLowerCase();
}

function tailorToBand(jdText) {
  const { all: jdSkills } = extractJdSkills(jdText);
  const tailored = JSON.parse(JSON.stringify(masterData));

  let haystack = flattenResume(tailored);
  const stillMissing = jdSkills.filter(s => !isPresent(s.toLowerCase(), haystack));
  for (const sk of stillMissing) {
    const target = CATEGORY_MAP[categoryOf(sk)];
    if (target && tailored.skills[target]) {
      const formatted = properCase(sk);
      if (!tailored.skills[target].includes(formatted)) {
        tailored.skills[target].push(formatted);
      }
    }
  }

  haystack = flattenResume(tailored);
  let matched = jdSkills.filter(s => isPresent(s.toLowerCase(), haystack));
  let pct = jdSkills.length ? matched.length / jdSkills.length : 1;

  if (pct > TARGET_MAX) {
    const candidates = [];
    for (const [cat, items] of Object.entries(tailored.skills)) {
      for (const item of items) {
        if (CORE_KEEPERS.has(item.toLowerCase())) continue;
        for (const jdSk of matched) {
          if (item.toLowerCase().includes(jdSk.toLowerCase()) ||
              jdSk.toLowerCase().includes(item.toLowerCase())) {
            candidates.push({ cat, item });
            break;
          }
        }
      }
    }
    candidates.sort(() => Math.random() - 0.5);
    for (const { cat, item } of candidates) {
      const idx = tailored.skills[cat].indexOf(item);
      if (idx === -1) continue;
      tailored.skills[cat].splice(idx, 1);
      haystack = flattenResume(tailored);
      matched = jdSkills.filter(s => isPresent(s.toLowerCase(), haystack));
      const newPct = jdSkills.length ? matched.length / jdSkills.length : 1;
      if (newPct < TARGET_MIN) {
        tailored.skills[cat].splice(idx, 0, item);
        continue;
      }
      pct = newPct;
      if (pct <= TARGET_MAX) break;
    }
  }
  return { tailored, jdSkillCount: jdSkills.length, matched: matched.length, coverage: pct };
}

function stripHtml(s) {
  return String(s || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const indexPath = path.join(outDir, 'index.json');
const existingIndex = fs.existsSync(indexPath) ? JSON.parse(fs.readFileSync(indexPath, 'utf8')) : [];
const existingIds = new Set(existingIndex.map(e => e.job_id));

const todo = matches.filter(m => !existingIds.has(m.id)).slice(0, MAX_TAILOR);
console.log(`Tailoring ${todo.length} new match(es) (${existingIndex.length} already done today)…\n`);

const newRows = [];

(async () => {
  for (let i = 0; i < todo.length; i++) {
    const job = todo[i];
    const jdText = stripHtml(job.description_html || job.title);
    const companySlug = slugify(job.company);
    const roleSlug = slugify(job.title).slice(0, 60);
    const baseName = `${companySlug}-${roleSlug}-${job.score || '00'}`.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
    const pdfPath = path.join(outDir, `${baseName}.pdf`);
    const docxPath = path.join(outDir, `${baseName}.docx`);

    try {
      const { tailored, jdSkillCount, matched, coverage } = tailorToBand(jdText);
      await buildDocx(tailored, docxPath);
      await buildPdf(tailored, pdfPath);
      const pct = Math.round(coverage * 100);
      console.log(`  [${i + 1}/${todo.length}] ${pct}%  ${job.company} — ${job.title.slice(0, 50)}`);
      newRows.push({
        job_id: job.id,
        company: job.company,
        role: job.title,
        location: job.location,
        url: job.url,
        score: job.score,
        source: job.source,
        coverage: pct,
        jd_skills: jdSkillCount,
        matched_skills: matched,
        pdf: path.relative(ROOT, pdfPath),
        docx: path.relative(ROOT, docxPath),
      });
    } catch (e) {
      console.error(`  [${i + 1}/${todo.length}] ✗ ${job.company}: ${e.message}`);
      newRows.push({
        job_id: job.id, company: job.company, role: job.title,
        url: job.url, score: job.score, error: e.message,
      });
    }
  }

  const fullIndex = [...existingIndex, ...newRows];
  fs.writeFileSync(indexPath, JSON.stringify(fullIndex, null, 2));
  console.log(`\nIndex: ${indexPath}`);
  console.log(`Total this date: ${fullIndex.length}`);
})();
