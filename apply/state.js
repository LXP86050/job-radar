/**
 * Append-only JSONL log of every application attempt.
 *
 * Each line:
 *   { ts, job_id, company, role, source, jd_url, resume_pdf, resume_docx,
 *     applicant_address, salary_min, salary_max, fields_filled, status,
 *     dry_run, screenshot, error? }
 *
 * Status values:
 *   "tailored"    — resume generated but applier hasn't touched the form yet
 *   "form-opened" — Playwright loaded the job URL
 *   "form-filled" — all detectable fields filled (dry-run stops here)
 *   "submitted"   — clicked Submit (only with --apply mode)
 *   "failed"      — any error; check .error field
 *   "skipped"     — already applied earlier (dedup against this log)
 */
const fs = require('fs');
const path = require('path');

const STATE_DIR = path.join(__dirname, '..', 'state');
const LOG_PATH = path.join(STATE_DIR, 'applied.jsonl');

function ensureDir() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

function append(entry) {
  ensureDir();
  const record = { ts: new Date().toISOString(), ...entry };
  fs.appendFileSync(LOG_PATH, JSON.stringify(record) + '\n');
  return record;
}

function loadAll() {
  if (!fs.existsSync(LOG_PATH)) return [];
  return fs.readFileSync(LOG_PATH, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
}

function alreadyApplied(jobId) {
  return loadAll().some(e =>
    e.job_id === jobId &&
    (e.status === 'submitted' || e.status === 'form-filled') &&
    !e.dry_run
  );
}

function summary() {
  const all = loadAll();
  const counts = {};
  for (const e of all) counts[e.status] = (counts[e.status] || 0) + 1;
  return { total: all.length, by_status: counts };
}

module.exports = { append, loadAll, alreadyApplied, summary, LOG_PATH };
