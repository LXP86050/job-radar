#!/usr/bin/env node
/**
 * Daily auto-apply runner. Designed to be called by the GH Actions workflow
 * right after src/main.py finishes its daily radar run.
 *
 * Behavior:
 *  - Loads today's matches from state/matches/{YYYY-MM-DD}-{profile-slug}.json
 *  - Filters to source ∈ ADAPTERS_ENABLED (currently just "greenhouse")
 *  - Applies for real (no --dry-run) with a polite cadence
 *  - Hard caps:
 *      MAX_PER_DAY = 30 (effectively no cap for normal radar volume)
 *      STOP_AFTER_FAILURES = 3 consecutive failures aborts the run
 *  - Sends a summary email at the end
 *
 * Override via env:
 *   AUTO_APPLY_DRY_RUN=1   → forces dry-run even in this script
 *   AUTO_APPLY_MAX=N       → override MAX_PER_DAY
 *   AUTO_APPLY_PROFILE=name→ load a different profile's matches
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { applyOne } = require('./applier');
const state = require('./state');

const ADAPTERS_ENABLED = new Set(['greenhouse']);  // expand as we add Lever/Ashby/Workday
const MAX_PER_DAY = parseInt(process.env.AUTO_APPLY_MAX || '30', 10);
const STOP_AFTER_FAILURES = 3;
const DRY_RUN = process.env.AUTO_APPLY_DRY_RUN === '1';

const PROFILE = process.env.AUTO_APPLY_PROFILE || 'job-radar';
const today = new Date().toISOString().slice(0, 10);
const matchesPath = path.join(__dirname, '..', 'state', 'matches', `${today}-${PROFILE}.json`);

function fail(msg) { console.error(`ERROR: ${msg}`); process.exit(1); }

if (!fs.existsSync(matchesPath)) {
  fail(`No matches file for today: ${matchesPath}\nDid src/main.py run first?`);
}
const matches = JSON.parse(fs.readFileSync(matchesPath, 'utf8'));

const eligible = matches.filter(m => ADAPTERS_ENABLED.has(m.source));
console.log(`\n${'='.repeat(60)}`);
console.log(`DAILY AUTO-APPLY  •  ${DRY_RUN ? 'DRY-RUN' : '🚨 REAL APPLY'}`);
console.log(`Today's matches:    ${matches.length}`);
console.log(`Greenhouse-eligible: ${eligible.length}`);
console.log(`Cap:                 ${MAX_PER_DAY}/day`);
console.log(`Log:                 ${state.LOG_PATH}`);
console.log(`${'='.repeat(60)}\n`);

(async () => {
  let applied = 0;
  let consecutiveFails = 0;
  const startTime = Date.now();

  for (const job of eligible) {
    if (applied >= MAX_PER_DAY) {
      console.log(`\n⏸  Hit daily cap (${MAX_PER_DAY}). Stopping.`);
      break;
    }
    if (consecutiveFails >= STOP_AFTER_FAILURES) {
      console.log(`\n🛑 ${STOP_AFTER_FAILURES} consecutive failures. Aborting.`);
      break;
    }

    const before = state.summary();
    await applyOne(job, { apply: !DRY_RUN });
    const after = state.summary();
    const justFailed = (after.by_status?.failed || 0) > (before.by_status?.failed || 0);
    if (justFailed) consecutiveFails += 1;
    else { consecutiveFails = 0; applied += 1; }

    // Polite human-like delay: 30-90s between submissions
    const delay = 30_000 + Math.random() * 60_000;
    console.log(`   (waiting ${Math.round(delay/1000)}s before next…)\n`);
    await new Promise(r => setTimeout(r, delay));
  }

  const elapsedMin = Math.round((Date.now() - startTime) / 60_000);
  const summary = state.summary();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`DONE in ${elapsedMin}min`);
  console.log(`Applied:        ${applied}`);
  console.log(`State summary:`, summary);
  console.log(`${'='.repeat(60)}\n`);
})();
