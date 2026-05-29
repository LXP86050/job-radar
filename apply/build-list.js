#!/usr/bin/env node
/**
 * Plain text/markdown list of today's Greenhouse matches with absolute PDF paths
 * and JD URLs. Opens a Finder window so PDFs are draggable.
 *
 * Usage: node apply/build-list.js [--date YYYY-MM-DD]
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const RESUME_DIR = path.join(ROOT, 'data', 'resume');
const OUTPUT_DIR = path.join(RESUME_DIR, 'output');

const date = (() => {
  const i = process.argv.indexOf('--date');
  return i > -1 ? process.argv[i + 1] : new Date().toISOString().slice(0, 10);
})();

const matchesPath = path.join(ROOT, 'state', 'matches', `${date}-job-radar.json`);
if (!fs.existsSync(matchesPath)) {
  console.error(`No matches file at ${matchesPath}`);
  process.exit(1);
}

const matches = JSON.parse(fs.readFileSync(matchesPath, 'utf8'));
const jobs = matches.filter(m => m.source === 'greenhouse').sort((a, b) => (b.score || 0) - (a.score || 0));

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const md = ['# Greenhouse jobs to apply to — ' + date + '\n',
  `${jobs.length} jobs · sorted by score (highest first)\n`,
  `Each row: company, role, JD link, tailored resume PDF (absolute path).\n`,
  `---\n`];

const rows = [];
for (let i = 0; i < jobs.length; i++) {
  const j = jobs[i];
  const companySlug = slugify(j.company);
  const roleSlug = slugify(j.title).slice(0, 60);
  const baseName = `lokesh-resume-${companySlug}-${roleSlug}`.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  const pdf = path.join(OUTPUT_DIR, `${baseName}.pdf`);
  const exists = fs.existsSync(pdf);

  md.push(`## ${i + 1}. ${j.company.toUpperCase()} — ${j.title}  (score ${j.score || '—'})`);
  md.push(`**Location:** ${j.location || '—'}`);
  md.push(`**Apply:** ${j.url}`);
  md.push(`**Resume:** \`${pdf}\` ${exists ? '✓' : '(missing — run build-dashboard.js)'}`);
  md.push('');

  rows.push({ n: i + 1, co: j.company, role: j.title.slice(0, 50), url: j.url, pdf, exists });
}

const outMd = path.join(__dirname, `jobs-${date}.md`);
fs.writeFileSync(outMd, md.join('\n'));

// Also print a clean terminal-friendly version
console.log(`\n${'='.repeat(80)}`);
console.log(`GREENHOUSE JOBS — ${date}  (${jobs.length} matches)`);
console.log(`${'='.repeat(80)}\n`);
for (const r of rows) {
  console.log(`${String(r.n).padStart(2)}. ${r.co.toUpperCase().padEnd(20)} ${r.role}`);
  console.log(`    🔗 ${r.url}`);
  console.log(`    📄 ${r.pdf}${r.exists ? '' : '  ⚠ MISSING'}`);
  console.log('');
}

console.log(`${'='.repeat(80)}`);
console.log(`Markdown saved: ${outMd}`);
console.log(`Resume folder:  ${OUTPUT_DIR}`);
console.log(`${'='.repeat(80)}\n`);

// Open Finder window pointing at resume folder so PDFs are draggable
execFileSync('open', [OUTPUT_DIR]);
// Open markdown in default viewer (your text editor)
execFileSync('open', [outMd]);
