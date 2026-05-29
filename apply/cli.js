#!/usr/bin/env node
/**
 * CLI for the auto-applier.
 *
 * Usage:
 *   node apply/cli.js --jobs <file.json> [--apply] [--max N]
 *
 * <file.json> is a JSON array of job objects (the same shape job-radar emits:
 * id, company, title, location, url, description_html, source).
 *
 * Default mode is DRY-RUN. Pass --apply to actually submit.
 */
const fs = require('fs');
const { applyOne } = require('./applier');
const state = require('./state');

function parseArgs(argv) {
  const args = { jobs: null, apply: false, max: 10 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--jobs') args.jobs = argv[++i];
    else if (a === '--apply') args.apply = true;
    else if (a === '--max') args.max = parseInt(argv[++i], 10);
    else if (a === '--help' || a === '-h') {
      console.log(`Usage: node apply/cli.js --jobs <file.json> [--apply] [--max N]`);
      process.exit(0);
    }
  }
  return args;
}

(async () => {
  const args = parseArgs(process.argv);
  if (!args.jobs) {
    console.error('Error: --jobs <file.json> required');
    process.exit(1);
  }

  const jobs = JSON.parse(fs.readFileSync(args.jobs, 'utf8'));
  const todo = jobs.slice(0, args.max);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`AUTO-APPLIER  •  ${args.apply ? '🚨 REAL APPLY MODE' : 'DRY-RUN (no submit)'}`);
  console.log(`Jobs to process: ${todo.length}`);
  console.log(`Log: ${state.LOG_PATH}`);
  console.log(`${'='.repeat(60)}\n`);

  for (const job of todo) {
    await applyOne(job, { apply: args.apply });
    // Polite delay between applications (human-like cadence)
    await new Promise(r => setTimeout(r, 5000 + Math.random() * 5000));
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('SUMMARY:', state.summary());
  console.log(`${'='.repeat(60)}\n`);
})();
