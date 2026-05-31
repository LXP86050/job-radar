#!/usr/bin/env node
/**
 * Take a job URL, fetch the JD, tailor the resume to 90-95% coverage
 * (NEVER 100% — keyword stuffing gets ATS-flagged), output URL + path.
 *
 * Usage:
 *   node apply/tailor-url.js <URL>                    # auto-derives company/role
 *   node apply/tailor-url.js <URL> <company> <role>   # explicit names
 *
 * Strategy:
 *   1. Fetch the URL (curl) — works for any ATS.
 *   2. Strip HTML tags → plain JD text.
 *   3. Inject missing profile keywords as the existing tailor does.
 *   4. If coverage ends up > 95%, RANDOMLY drop matched-but-non-core skills
 *      from the resume until coverage lands in 90-95%.
 *   5. Re-emit DOCX + PDF.
 *   6. Print: URL + PDF path.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const RESUME_DIR = path.join(__dirname, '..', 'data', 'resume');
const masterData = require(path.join(RESUME_DIR, 'resume-data'));
const { buildDocx } = require(path.join(RESUME_DIR, 'build-docx'));
const { buildPdf } = require(path.join(RESUME_DIR, 'build-pdf'));
const { extractJdSkills, isPresent, properCase } =
  require(path.join(RESUME_DIR, 'lib', 'jd-keywords'));
const profile = require(path.join(RESUME_DIR, '..', 'resume_profile.json'));

const OUTPUT_DIR = path.join(RESUME_DIR, 'output');
const TARGET_MIN = 0.90;
const TARGET_MAX = 0.95;

/* ---------- fetch + parse JD ---------- */

function fetchJdText(url) {
  // Try Greenhouse public API first when the URL pattern matches
  const ghMatch = url.match(/(?:boards|job-boards)\.greenhouse\.io\/([^/]+)\/jobs\/(\d+)/);
  if (ghMatch) {
    const [, slug, id] = ghMatch;
    try {
      const apiUrl = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs/${id}?content=true`;
      const raw = execSync(`curl -sSL -A "Mozilla/5.0" "${apiUrl}"`, { maxBuffer: 8 * 1024 * 1024 }).toString();
      const json = JSON.parse(raw);
      if (json.content) return { text: stripHtml(json.content), title: json.title || '', company: slug };
    } catch (_) { /* fall through to scrape */ }
  }

  // Generic scrape
  const html = execSync(`curl -sSL -A "Mozilla/5.0" "${url}"`, { maxBuffer: 8 * 1024 * 1024 }).toString();
  // Sniff title from <title> tag
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : '';
  return { text: stripHtml(html), title, company: hostnameToCo(url) };
}

function stripHtml(s) {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim();
}

function hostnameToCo(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^(www|careers|jobs)\./, '');
    return host.split('.')[0];
  } catch { return 'company'; }
}

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/* ---------- tailor logic with cap ---------- */

function flattenResume(d) {
  return [
    d.summary,
    ...Object.values(d.skills).flat(),
    ...d.experience.flatMap(j => [j.title, j.company, ...j.bullets]),
    ...d.projects.flatMap(p => [p.name, p.stack, ...p.bullets]),
    ...d.certifications.flatMap(c => [c.name, c.issuer]),
  ].join(' \n ').toLowerCase();
}

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

/* Skills considered "core" — we don't drop these even if coverage too high. */
const CORE_KEEPERS = new Set([
  'python', 'javascript', 'typescript', 'c#', 'sql',
  'react', 'next.js', 'django', 'fastapi', '.net core',
  'azure', 'aws', 'kubernetes', 'docker', 'terraform', 'github actions',
  'rest api', 'rest apis', 'microservices architecture',
  'large language models (llm, llms)', 'retrieval-augmented generation (rag)',
  'agentic ai', 'ai agents', 'langchain', 'azure openai (gpt-4)',
  'system design', 'distributed systems',
].map(s => s.toLowerCase()));

function tailorToBand(jdText, opts = {}) {
  const { byCategory: jdByCat, all: jdSkills } = extractJdSkills(jdText);
  const tailored = JSON.parse(JSON.stringify(masterData));

  // 1. Inject every missing JD keyword that exists in our profile
  let haystack = flattenResume(tailored);
  const stillMissing = jdSkills.filter(s => !isPresent(s.toLowerCase(), haystack));
  const injected = [];
  for (const sk of stillMissing) {
    const target = CATEGORY_MAP[categoryOf(sk)];
    if (target && tailored.skills[target]) {
      const formatted = properCase(sk);
      if (!tailored.skills[target].includes(formatted)) {
        tailored.skills[target].push(formatted);
        injected.push(`${formatted} → ${target}`);
      }
    }
  }

  // 2. Measure post-injection coverage
  haystack = flattenResume(tailored);
  let matched = jdSkills.filter(s => isPresent(s.toLowerCase(), haystack));
  let pct = jdSkills.length ? matched.length / jdSkills.length : 1;

  // 3. If coverage exceeds 95%, randomly drop non-core matched skills from
  //    skill sections until we drop below 95%. Don't go under 90%.
  const dropped = [];
  if (pct > TARGET_MAX) {
    // Find candidates: skills in tailored.skills that match a JD term + aren't core
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
    // Shuffle for variety
    candidates.sort(() => Math.random() - 0.5);

    for (const { cat, item } of candidates) {
      const idx = tailored.skills[cat].indexOf(item);
      if (idx === -1) continue;
      // Try removing — only commit if we'd still be above TARGET_MIN
      tailored.skills[cat].splice(idx, 1);
      haystack = flattenResume(tailored);
      matched = jdSkills.filter(s => isPresent(s.toLowerCase(), haystack));
      const newPct = jdSkills.length ? matched.length / jdSkills.length : 1;
      if (newPct < TARGET_MIN) {
        // Undo — we went too low
        tailored.skills[cat].splice(idx, 0, item);
        continue;
      }
      dropped.push(`${item} (${cat})`);
      pct = newPct;
      if (pct <= TARGET_MAX) break;
    }
  }

  return { tailored, jdSkills, matched, coverage: pct, injected, dropped };
}

/* ---------- CLI ---------- */

async function main() {
  const [,, urlArg, companyArg, roleArg] = process.argv;
  if (!urlArg) {
    console.error('Usage: node apply/tailor-url.js <URL> [company] [role]');
    process.exit(1);
  }

  console.log(`\n🌐 Fetching JD from ${urlArg}…`);
  const { text: jdText, title: jdTitle, company: hostCo } = fetchJdText(urlArg);
  if (!jdText || jdText.length < 200) {
    console.error(`Fetched only ${jdText.length} chars — likely blocked. Try saving JD to a file and passing that path.`);
    process.exit(1);
  }

  const companySlug = slugify(companyArg || hostCo);
  const roleSlug = slugify(roleArg || jdTitle).slice(0, 60) || 'role';

  console.log(`📊 Analyzing JD…`);
  const { tailored, jdSkills, matched, coverage, injected, dropped } = tailorToBand(jdText);

  console.log(`\nJD keywords found: ${jdSkills.length}`);
  console.log(`Injected ${injected.length} keyword(s) into resume:`);
  for (const i of injected) console.log(`  + ${i}`);
  if (dropped.length) {
    console.log(`Dropped ${dropped.length} keyword(s) to stay under 95% (avoid ATS keyword-stuffing flag):`);
    for (const d of dropped) console.log(`  − ${d}`);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const baseName = `lokesh-resume-${companySlug}-${roleSlug}`.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  const docxPath = path.join(OUTPUT_DIR, `${baseName}.docx`);
  const pdfPath = path.join(OUTPUT_DIR, `${baseName}.pdf`);

  await buildDocx(tailored, docxPath);
  await buildPdf(tailored, pdfPath);

  console.log(`\n${'='.repeat(70)}`);
  console.log(`✓ TAILORED RESUME READY`);
  console.log(`${'='.repeat(70)}`);
  console.log(`Coverage: ${Math.round(coverage * 100)}% (${matched.length}/${jdSkills.length}) — target band 90-95%`);
  console.log(`Job URL:  ${urlArg}`);
  console.log(`PDF:      ${pdfPath}`);
  console.log(`DOCX:     ${docxPath}`);
  console.log(`${'='.repeat(70)}\n`);

  // Open PDF in Preview so user can review
  execSync(`open "${pdfPath}"`);
}

main().catch(e => { console.error(e); process.exit(1); });
