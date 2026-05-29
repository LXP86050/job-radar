/**
 * Auto-applier orchestrator.
 *
 * Per-job flow:
 *  1. Skip if already applied (dedup against state/applied.jsonl).
 *  2. Detect required state from JD text → pick state-appropriate address.
 *  3. Generate tailored resume PDF + DOCX (calls resume tailorer).
 *  4. Open job URL with Playwright + system Chrome.
 *  5. Dispatch to ATS-specific adapter (Greenhouse/Lever/Ashby/Workday).
 *  6. Adapter fills form fields, uploads tailored PDF, logs every action.
 *  7. If --apply mode: click submit. Else: stop with status "form-filled".
 *  8. Record screenshot + result to state/applied.jsonl.
 *
 * Safety:
 *  - DRY-RUN by default (must pass --apply explicitly).
 *  - Per-day cap enforced via state log.
 *  - Per-job timeout 90s.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');

const profile = require('../data/applicant_profile.json');
const stateAddresses = require('../data/state_addresses.json');
const state = require('./state');

const RESUME_DIR = path.join(__dirname, '..', 'data', 'resume');
const TAILOR_SCRIPT = path.join(RESUME_DIR, 'tailor.js');

// Per-ATS adapters (lazy-loaded)
const ADAPTERS = {
  greenhouse: () => require('./adapters/greenhouse'),
  // lever, ashby, workday — Phase 3.2
};

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function tailorResume(jdText, companySlug, roleSlug) {
  // Write JD to a temp file then call tailor.js as a child process.
  // (Could refactor to import directly later — keeps tailor.js as the
  // single source of truth for resume generation.)
  const tmpJd = path.join(RESUME_DIR, 'output', `_jd-${companySlug}-${roleSlug}.txt`);
  fs.mkdirSync(path.dirname(tmpJd), { recursive: true });
  fs.writeFileSync(tmpJd, jdText);
  execFileSync('node', [TAILOR_SCRIPT, tmpJd, companySlug, roleSlug], {
    cwd: RESUME_DIR, stdio: 'inherit',
  });
  fs.unlinkSync(tmpJd);
  const baseName = `lokesh-resume-${companySlug}-${roleSlug}`.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  return {
    pdf: path.join(RESUME_DIR, 'output', `${baseName}.pdf`),
    docx: path.join(RESUME_DIR, 'output', `${baseName}.docx`),
  };
}

function pickAddress(jdState) {
  return stateAddresses[jdState] || stateAddresses[profile.default_state];
}

function computeSalary(jdText) {
  // Find $XXX,XXX – $YYY,YYY (or with " to ")
  const m = jdText.match(/\$\s*(\d{2,3}),?(\d{3})\s*[-–to]+\s*\$?\s*(\d{2,3}),?(\d{3})/);
  if (m) {
    const lo = parseInt(m[1] + m[2], 10);
    const hi = parseInt(m[3] + m[4], 10);
    const expected = Math.round(lo + 0.75 * (hi - lo));
    return { min: lo, max: hi, expected };
  }
  return { min: profile.salary.floor, max: profile.salary.floor + 60000, expected: profile.salary.floor };
}

async function applyOne(job, opts) {
  const dryRun = !opts.apply;
  const adapterName = job.source; // 'greenhouse', 'lever', etc.
  const adapter = ADAPTERS[adapterName] && ADAPTERS[adapterName]();
  if (!adapter) {
    return state.append({
      job_id: job.id, company: job.company, role: job.title, source: adapterName,
      jd_url: job.url, status: 'skipped', error: `no adapter for ${adapterName}`,
      dry_run: dryRun,
    });
  }

  if (state.alreadyApplied(job.id) && !dryRun) {
    return state.append({
      job_id: job.id, company: job.company, role: job.title, source: adapterName,
      jd_url: job.url, status: 'skipped', error: 'already applied',
      dry_run: dryRun,
    });
  }

  const companySlug = slugify(job.company);
  const roleSlug = slugify(job.title).slice(0, 60);
  const jdText = job.description_html || job._jd_text || job.title;

  // 1. Detect state requirement + pick address
  const { detectRequiredState } = require('../data/resume/lib/jd-keywords');
  const jdState = detectRequiredState(jdText);
  const address = pickAddress(jdState);
  const salary = computeSalary(jdText);

  // 2. Tailor resume
  console.log(`\n📄 Tailoring resume for ${job.company} — ${job.title}…`);
  const resume = tailorResume(jdText, companySlug, roleSlug);

  state.append({
    job_id: job.id, company: job.company, role: job.title, source: adapterName,
    jd_url: job.url, status: 'tailored',
    resume_pdf: resume.pdf, resume_docx: resume.docx,
    applicant_address: address, jd_state: jdState,
    salary_min: salary.min, salary_max: salary.max, salary_expected: salary.expected,
    dry_run: dryRun,
  });

  // 3. Open browser + dispatch to adapter
  console.log(`🌐 Opening ${job.url}…`);
  const browser = await chromium.launch({ headless: dryRun, args: ['--no-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);

  try {
    await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    state.append({ job_id: job.id, status: 'form-opened', dry_run: dryRun });

    const plan = await adapter.fillForm(page, {
      profile, address, salary, resume,
      cover_letter: profile.cover_letter_template.replace(/{company}/g, job.company),
      portal_password: process.env.PORTAL_PASSWORD,
      dryRun,
    });

    const screenshotPath = path.join(__dirname, '..', 'state', 'screenshots',
      `${companySlug}-${roleSlug}-${Date.now()}.png`);
    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true });

    if (dryRun) {
      console.log(`✓ DRY RUN — would submit ${plan.fields_filled.length} fields. Screenshot: ${screenshotPath}`);
      state.append({
        job_id: job.id, company: job.company, role: job.title, source: adapterName,
        jd_url: job.url, status: 'form-filled',
        fields_filled: plan.fields_filled, fields_skipped: plan.fields_skipped,
        screenshot: screenshotPath, dry_run: true,
        resume_pdf: resume.pdf,
      });
    } else {
      await adapter.submit(page, plan);
      console.log(`✓ SUBMITTED`);
      state.append({
        job_id: job.id, company: job.company, role: job.title, source: adapterName,
        jd_url: job.url, status: 'submitted',
        fields_filled: plan.fields_filled,
        screenshot: screenshotPath, dry_run: false,
        resume_pdf: resume.pdf,
      });
    }
  } catch (err) {
    console.error(`✗ FAILED: ${err.message}`);
    state.append({
      job_id: job.id, company: job.company, role: job.title, source: adapterName,
      jd_url: job.url, status: 'failed', error: err.message, dry_run: dryRun,
    });
  } finally {
    await browser.close();
  }
}

module.exports = { applyOne, slugify };
