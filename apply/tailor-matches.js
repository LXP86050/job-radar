#!/usr/bin/env node
/**
 * Tailors a resume for every match in today's job-radar output.
 * Designed to run after src/main.py inside the GH Actions workflow.
 *
 * For each match:
 *   1. Take the JD text already on the match object.
 *   2. Tailor per job via lib/tailor.js (inject JD keywords, reorder skills,
 *      specialize summary; ~95% coverage, honest — never fabricates skills).
 *   3. Write DOCX + PDF to state/tailored/{date}/{company}-{role}-{score}.{pdf,docx}.
 *   4. Build state/tailored/{date}/index.json with all matches + paths.
 *
 * Caps: TAILOR_MAX per run to keep workflow under 60min.
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
const { buildDocx } = require(path.join(RESUME_DIR, 'build-docx'));
const { buildPdf } = require(path.join(RESUME_DIR, 'build-pdf'));
const { tailorToBand } = require(path.join(RESUME_DIR, 'lib', 'tailor'));

const PROFILE = process.env.TAILOR_PROFILE || 'job-radar';
const MAX_TAILOR = parseInt(process.env.TAILOR_MAX || '50', 10);

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

/**
 * Extract a short, file-safe suffix from the job ID that uniquely
 * disambiguates jobs with the same {company, role, score}. Each ATS
 * yields a unique id segment after the last ':':
 *   greenhouse:plaid:123456     → 123456
 *   lever:netflix:abc-uuid      → abcuuid (last 8 alnum)
 *   workday:nvidia/External_X   → externalx (slugged)
 *   hackernews:hn:38712445      → 38712445
 *   remoteok:1023456            → 1023456
 *   weworkremotely:foo-bar-baz  → foobarbaz
 * Returns last 8 alphanumeric chars (lowercase). Empty IDs fall back
 * to a hash of the URL so the filename can never collide.
 */
function jobIdSuffix(job) {
  const idSegment = String(job.id || '').split(':').pop() || '';
  const alnum = idSegment.replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (alnum) return alnum.slice(-8);
  // Last-resort hash: 8 hex chars of djb2 over the URL
  const s = String(job.url || job.title || 'x');
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16).slice(-8);
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
    // Filename pattern: {company}-{role}-{score}-{job_id_short}.pdf
    // The job_id_short suffix prevents collisions when the same company posts
    // multiple roles with identical titles.
    const idSuffix = jobIdSuffix(job);
    const baseName = `${companySlug}-${roleSlug}-${job.score || '00'}-${idSuffix}`
      .replace(/[^a-z0-9-]/gi, '-').toLowerCase();
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
