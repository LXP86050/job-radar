#!/usr/bin/env node
/**
 * Generates tailored resume for each Greenhouse match in today's
 * job-radar output, then builds a single-page HTML dashboard.
 *
 * Usage:
 *   node apply/build-dashboard.js [--date YYYY-MM-DD] [--all-sources]
 *
 * Default: today's matches, Greenhouse only.
 * --all-sources includes Lever/Ashby/Workday too (no tailoring for non-GH
 *   since those adapters don't exist yet — just links).
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const RESUME_DIR = path.join(ROOT, 'data', 'resume');
const OUTPUT_DIR = path.join(RESUME_DIR, 'output');
const TAILOR_SCRIPT = path.join(RESUME_DIR, 'tailor.js');

function parseArgs() {
  const args = { date: new Date().toISOString().slice(0, 10), allSources: false };
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--date') args.date = process.argv[++i];
    else if (process.argv[i] === '--all-sources') args.allSources = true;
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
  const pdf = path.join(OUTPUT_DIR, `${baseName}.pdf`);
  const docx = path.join(OUTPUT_DIR, `${baseName}.docx`);

  if (fs.existsSync(pdf) && fs.existsSync(docx)) {
    return { pdf, docx, alreadyExisted: true };
  }

  // Write JD to a temp file and call tailor.js
  const tmpJd = path.join(OUTPUT_DIR, `_jd-${companySlug}-${roleSlug}.txt`);
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const jdText = job.description_html || job.title;
  fs.writeFileSync(tmpJd, jdText);
  try {
    execFileSync('node', [TAILOR_SCRIPT, tmpJd, companySlug, roleSlug], {
      cwd: RESUME_DIR, stdio: 'inherit',
    });
  } finally {
    if (fs.existsSync(tmpJd)) fs.unlinkSync(tmpJd);
  }
  return { pdf, docx, alreadyExisted: false };
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function buildHtml(rows) {
  const sourceCounts = {};
  for (const r of rows) sourceCounts[r.source] = (sourceCounts[r.source] || 0) + 1;
  const sourceSummary = Object.entries(sourceCounts).map(([k, v]) => `${k}: ${v}`).join(' • ');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Job Radar — Manual Apply Dashboard</title>
<style>
  :root {
    --bg: #0a0a0a; --card: #141414; --border: #2a2a2a; --text: #e8e8e8;
    --muted: #888; --accent: #4a9eff; --green: #4ade80; --red: #ef4444;
    --orange: #fb923c;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: var(--bg); color: var(--text); padding: 24px; line-height: 1.5; }
  header { margin-bottom: 24px; border-bottom: 1px solid var(--border); padding-bottom: 16px; }
  h1 { font-size: 24px; font-weight: 600; margin-bottom: 8px; }
  .summary { color: var(--muted); font-size: 14px; }
  .progress { margin-top: 12px; height: 6px; background: var(--border); border-radius: 3px; overflow: hidden; }
  .progress-bar { height: 100%; background: var(--green); width: 0%; transition: width 0.3s; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  th, td { padding: 12px 10px; text-align: left; border-bottom: 1px solid var(--border); vertical-align: top; }
  th { background: var(--card); font-size: 12px; text-transform: uppercase;
       letter-spacing: 0.5px; color: var(--muted); font-weight: 600; }
  tr:hover { background: rgba(255,255,255,0.02); }
  tr.applied { opacity: 0.5; }
  tr.applied td.role { text-decoration: line-through; }
  .company { font-weight: 600; }
  .role { font-size: 14px; }
  .location { font-size: 12px; color: var(--muted); }
  .score { display: inline-block; padding: 2px 8px; border-radius: 4px;
    background: var(--card); color: var(--green); font-size: 11px; font-weight: 600; }
  .source-tag { display: inline-block; padding: 1px 6px; border-radius: 3px;
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
  .source-greenhouse { background: rgba(74,158,255,0.2); color: var(--accent); }
  .source-lever, .source-ashby, .source-workday, .source-smartrecruiters, .source-workable {
    background: rgba(251,146,60,0.2); color: var(--orange); }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  .btn { display: inline-block; padding: 6px 12px; border-radius: 4px;
    background: var(--card); border: 1px solid var(--border); color: var(--text);
    text-decoration: none; font-size: 12px; cursor: pointer; }
  .btn:hover { background: var(--border); }
  .btn-primary { background: var(--accent); color: white; border-color: var(--accent); }
  .actions { white-space: nowrap; }
  .checkbox { width: 18px; height: 18px; cursor: pointer; }
  .filters { margin-bottom: 16px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
  .filter-btn { padding: 4px 12px; border-radius: 20px; background: var(--card);
    border: 1px solid var(--border); color: var(--muted); font-size: 12px;
    cursor: pointer; }
  .filter-btn.active { background: var(--accent); color: white; border-color: var(--accent); }
</style>
</head>
<body>
<header>
  <h1>Job Radar — Manual Apply</h1>
  <div class="summary">${rows.length} jobs · ${esc(sourceSummary)}</div>
  <div class="progress"><div class="progress-bar" id="progress"></div></div>
</header>

<div class="filters">
  <button class="filter-btn active" data-filter="all">All</button>
  <button class="filter-btn" data-filter="greenhouse">Greenhouse</button>
  <button class="filter-btn" data-filter="other">Other ATS</button>
  <button class="filter-btn" data-filter="unapplied">Unapplied</button>
  <span style="color: var(--muted); font-size: 12px; margin-left: auto;">
    Tailored resumes are at <code>data/resume/output/</code>. Check the box after submitting; state saves to localStorage.
  </span>
</div>

<table>
<thead>
<tr>
  <th style="width: 32px;">✓</th>
  <th>Company / Role</th>
  <th style="width: 80px;">Score</th>
  <th style="width: 60px;">Source</th>
  <th>Location</th>
  <th class="actions" style="width: 220px;">Actions</th>
</tr>
</thead>
<tbody>
${rows.map(r => `
<tr data-source="${esc(r.source)}" data-id="${esc(r.id)}">
  <td><input type="checkbox" class="checkbox" data-job="${esc(r.id)}"></td>
  <td>
    <div class="company">${esc(r.company)}</div>
    <div class="role">${esc(r.title)}</div>
  </td>
  <td><span class="score">${r.score}</span></td>
  <td><span class="source-tag source-${esc(r.source)}">${esc(r.source)}</span></td>
  <td class="location">${esc(r.location || '—')}</td>
  <td class="actions">
    <a class="btn btn-primary" href="${esc(r.url)}" target="_blank">Open job</a>
    ${r.pdf
      ? `<a class="btn" href="file://${esc(r.pdf)}" target="_blank">PDF</a>`
      : '<span style="color: var(--muted); font-size: 11px;">no tailor</span>'}
  </td>
</tr>
`).join('')}
</tbody>
</table>

<script>
  const STORAGE_KEY = 'job-radar-applied-${rows[0]?.runDate || ''}';
  const applied = new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'));
  const total = ${rows.length};

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...applied]));
    updateProgress();
  }
  function updateProgress() {
    const pct = total ? (applied.size / total) * 100 : 0;
    document.getElementById('progress').style.width = pct + '%';
  }
  function applyState(cb) {
    const id = cb.dataset.job;
    const row = cb.closest('tr');
    if (cb.checked) {
      applied.add(id);
      row.classList.add('applied');
    } else {
      applied.delete(id);
      row.classList.remove('applied');
    }
    persist();
  }

  document.querySelectorAll('.checkbox').forEach(cb => {
    const id = cb.dataset.job;
    if (applied.has(id)) {
      cb.checked = true;
      cb.closest('tr').classList.add('applied');
    }
    cb.addEventListener('change', () => applyState(cb));
  });
  updateProgress();

  // Filters
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const f = btn.dataset.filter;
      document.querySelectorAll('tbody tr').forEach(row => {
        const src = row.dataset.source;
        const id = row.dataset.id;
        let show = true;
        if (f === 'greenhouse') show = src === 'greenhouse';
        else if (f === 'other') show = src !== 'greenhouse';
        else if (f === 'unapplied') show = !applied.has(id);
        row.style.display = show ? '' : 'none';
      });
    });
  });
</script>
</body></html>`;
}

(async () => {
  const args = parseArgs();
  const matchesPath = path.join(ROOT, 'state', 'matches', `${args.date}-job-radar.json`);
  if (!fs.existsSync(matchesPath)) {
    console.error(`No matches file at ${matchesPath}`);
    process.exit(1);
  }
  const matches = JSON.parse(fs.readFileSync(matchesPath, 'utf8'));
  const jobs = args.allSources ? matches : matches.filter(m => m.source === 'greenhouse');

  console.log(`\nBuilding dashboard for ${jobs.length} job(s)…\n`);

  const rows = [];
  for (const job of jobs) {
    let resumeFiles = null;
    if (job.source === 'greenhouse') {
      try {
        resumeFiles = ensureTailored(job);
        console.log(`  ${resumeFiles.alreadyExisted ? '·' : '✓'} ${job.company} — ${job.title.slice(0, 60)}`);
      } catch (e) {
        console.error(`  ✗ ${job.company}: ${e.message}`);
      }
    }
    rows.push({
      id: job.id,
      company: job.company,
      title: job.title,
      location: job.location,
      url: job.url,
      source: job.source,
      score: job.score || '—',
      pdf: resumeFiles ? resumeFiles.pdf : null,
      runDate: args.date,
    });
  }

  rows.sort((a, b) => (b.score || 0) - (a.score || 0));

  const html = buildHtml(rows);
  const outPath = path.join(__dirname, 'dashboard.html');
  fs.writeFileSync(outPath, html);
  console.log(`\nDashboard: ${outPath}\nOpening…`);

  execFileSync('open', [outPath]);
})();
