#!/usr/bin/env node
/**
 * Semi-auto applier. Opens job URL in VISIBLE Chrome, auto-fills every field
 * we can, then PAUSES — you review, fix the combobox fields that the React
 * forms reject (Gender / Race / Pronoun / Sexual Orientation / etc.), click
 * Submit yourself, and press Enter in the terminal to move to the next job.
 *
 * Usage:
 *   node apply/semi-auto.js              # iterate all 29 GH matches
 *   node apply/semi-auto.js --max 5      # limit to first 5
 *   node apply/semi-auto.js --start 10   # skip first 10 (resume later)
 *   node apply/semi-auto.js --company klaviyo  # just one company
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');

const profile = require('../data/applicant_profile.json');
const stateAddresses = require('../data/state_addresses.json');
const state = require('./state');
const greenhouse = require('./adapters/greenhouse');
const { detectRequiredState } = require('../data/resume/lib/jd-keywords');

const ROOT = path.join(__dirname, '..');
const RESUME_DIR = path.join(ROOT, 'data', 'resume');
const TAILOR_SCRIPT = path.join(RESUME_DIR, 'tailor.js');

function parseArgs() {
  const args = { max: 99, start: 0, company: null, date: new Date().toISOString().slice(0, 10) };
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === '--max') args.max = parseInt(process.argv[++i], 10);
    else if (a === '--start') args.start = parseInt(process.argv[++i], 10);
    else if (a === '--company') args.company = process.argv[++i];
    else if (a === '--date') args.date = process.argv[++i];
  }
  return args;
}

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function ensureTailored(job) {
  const companySlug = slugify(job.company);
  const roleSlug = slugify(job.title).slice(0, 60);
  const baseName = `lokesh-resume-${companySlug}-${roleSlug}`.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  const pdf = path.join(RESUME_DIR, 'output', `${baseName}.pdf`);
  const docx = path.join(RESUME_DIR, 'output', `${baseName}.docx`);
  if (fs.existsSync(pdf) && fs.existsSync(docx)) return { pdf, docx };
  const tmp = path.join(RESUME_DIR, 'output', `_jd-${companySlug}.txt`);
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.writeFileSync(tmp, job.description_html || job.title);
  try {
    execFileSync('node', [TAILOR_SCRIPT, tmp, companySlug, roleSlug],
      { cwd: RESUME_DIR, stdio: 'inherit' });
  } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
  return { pdf, docx };
}

function computeSalary(jdText) {
  const m = jdText.match(/\$\s*(\d{2,3}),?(\d{3})\s*[-–to]+\s*\$?\s*(\d{2,3}),?(\d{3})/);
  if (m) {
    const lo = parseInt(m[1] + m[2], 10);
    const hi = parseInt(m[3] + m[4], 10);
    return { min: lo, max: hi, expected: Math.round(lo + 0.75 * (hi - lo)) };
  }
  return { min: profile.salary.floor, max: profile.salary.floor + 60000, expected: profile.salary.floor };
}

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans); }));
}

async function semiAutoOne(job) {
  const resume = ensureTailored(job);
  const jdText = job.description_html || job.title;
  const jdState = detectRequiredState(jdText);
  const address = stateAddresses[jdState] || stateAddresses[profile.default_state];
  const salary = computeSalary(jdText);

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`🏢 ${job.company.toUpperCase()}  —  ${job.title}`);
  console.log(`📍 ${job.location || '(remote)'}`);
  console.log(`🔗 ${job.url}`);
  console.log(`📄 ${resume.pdf}`);
  console.log(`💰 ${salary.min/1000}K–${salary.max/1000}K, expect ${Math.round(salary.expected/1000)}K`);
  console.log(`${'═'.repeat(70)}\n`);

  const browser = await chromium.launch({ headless: false, args: ['--no-sandbox', '--window-size=1280,900'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  try {
    await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    console.log(`Auto-filling form…`);
    const plan = await greenhouse.fillForm(page, {
      profile, address, salary, resume,
      cover_letter: profile.cover_letter_template.replace(/{company}/g, job.company),
      portal_password: process.env.PORTAL_PASSWORD,
      dryRun: false,
    });

    console.log(`\n✓ Filled ${plan.fields_filled.length} fields:`);
    for (const f of plan.fields_filled) {
      if (f.field === '[meta] form-frame') continue;
      console.log(`   ✓ ${String(f.field).slice(0, 50).padEnd(50)} → ${String(f.value || '').slice(0, 40)}`);
    }
    if ((plan.required_unfilled || []).length) {
      console.log(`\n⚠ ${plan.required_unfilled.length} required field(s) need YOUR attention:`);
      for (const f of plan.required_unfilled) {
        console.log(`   ✗ ${String(f.field).slice(0, 60)}`);
      }
    }

    console.log(`\n👀 Review the browser window. Fix any unfilled fields, click Submit yourself.`);
    const ans = (await prompt(`\n[Enter] = next job   |   's' = skip without applying   |   'q' = quit:  `)).trim().toLowerCase();

    state.append({
      job_id: job.id, company: job.company, role: job.title, source: 'greenhouse',
      jd_url: job.url, status: ans === 's' ? 'skipped_manual' : 'manual_review',
      fields_filled: plan.fields_filled, required_unfilled: plan.required_unfilled || [],
      resume_pdf: resume.pdf, semi_auto: true,
    });

    return ans === 'q' ? 'quit' : 'next';
  } catch (e) {
    console.error(`\n✗ Error: ${e.message}`);
    state.append({
      job_id: job.id, company: job.company, role: job.title, source: 'greenhouse',
      jd_url: job.url, status: 'failed', error: e.message, semi_auto: true,
    });
    const ans = await prompt(`\n[Enter] = next job   |   'q' = quit:  `);
    return ans.trim().toLowerCase() === 'q' ? 'quit' : 'next';
  } finally {
    await browser.close();
  }
}

(async () => {
  const args = parseArgs();
  const matchesPath = path.join(ROOT, 'state', 'matches', `${args.date}-job-radar.json`);
  if (!fs.existsSync(matchesPath)) {
    console.error(`No matches file: ${matchesPath}`);
    process.exit(1);
  }
  const matches = JSON.parse(fs.readFileSync(matchesPath, 'utf8'));
  let jobs = matches.filter(m => m.source === 'greenhouse');
  if (args.company) jobs = jobs.filter(j => j.company.toLowerCase().includes(args.company.toLowerCase()));
  jobs = jobs.slice(args.start, args.start + args.max);

  // Skip jobs already marked applied or manual_review
  const applied = new Set(state.loadAll()
    .filter(e => ['submitted', 'manual_review', 'skipped_manual'].includes(e.status))
    .map(e => e.job_id));
  const todo = jobs.filter(j => !applied.has(j.id));

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`SEMI-AUTO APPLIER`);
  console.log(`${todo.length} job(s) to process (${jobs.length - todo.length} already handled)`);
  console.log(`${'═'.repeat(70)}`);

  for (let i = 0; i < todo.length; i++) {
    console.log(`\n[${i + 1} of ${todo.length}]`);
    const result = await semiAutoOne(todo[i]);
    if (result === 'quit') {
      console.log(`\nQuit. Resume later with --start ${args.start + i + 1}`);
      break;
    }
  }
  console.log(`\nDone.`);
})();
