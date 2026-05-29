/**
 * PDF builder. Exports buildPdf(data, outPath) for the tailorer;
 * runs as CLI to build the master resume when invoked directly.
 *
 * Renders via puppeteer-core + system Chrome (no Chromium download).
 */
const fs = require('fs');
const path = require('path');

/**
 * Cross-platform Chrome resolution:
 *   - macOS dev: /Applications/Google Chrome.app
 *   - Ubuntu CI: use puppeteer's bundled Chrome (install puppeteer not core)
 *   - Override with env CHROME_PATH if set
 */
function resolveChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (require('fs').existsSync(mac)) return mac;
  // Try common Linux paths
  const linux = ['/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium'];
  for (const p of linux) if (require('fs').existsSync(p)) return p;
  return null; // Let puppeteer use its bundled Chromium
}
const CHROME = resolveChrome();

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function skillsHtml(skills) {
  return Object.entries(skills).map(([cat, items]) => `
    <p class="skill-row"><span class="skill-cat">${esc(cat)}:</span> ${items.map(esc).join(', ')}</p>
  `).join('');
}

function expHtml(jobs) {
  return jobs.map(j => `
    <div class="job">
      <div class="job-header">
        <span class="job-title"><strong>${esc(j.title)}</strong> | <strong>${esc(j.company)}</strong></span>
        <span class="job-dates">${esc(j.dates)}</span>
      </div>
      <ul>${j.bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>
    </div>
  `).join('');
}

function projHtml(projects) {
  return projects.map(p => `
    <div class="project">
      <p class="proj-header"><strong>${esc(p.name)}</strong> | <em>${esc(p.stack)}</em></p>
      <ul>${p.bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>
    </div>
  `).join('');
}

function eduHtml(edu) {
  return edu.map(e => `
    <p class="edu-row"><strong>${esc(e.degree)}</strong> — ${esc(e.school)}, ${esc(e.year)}</p>
  `).join('');
}

function certsHtml(certs) {
  return `<ul class="certs">${certs.map(c => `
    <li>${esc(c.issuer)} — <strong>${esc(c.name)}</strong> (${esc(c.date)})</li>
  `).join('')}</ul>`;
}

function renderHtml(data) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(data.name)} – Resume</title>
<style>
  @page { size: Letter; margin: 0.5in 0.6in; }
  * { box-sizing: border-box; }
  body { font-family: 'Calibri', 'Arial', sans-serif; font-size: 10.5pt; color: #000; line-height: 1.32; margin: 0; }
  h1 { font-size: 22pt; text-align: center; margin: 0 0 4px; font-weight: 700; letter-spacing: 0.5px; color: #1F4E79; }
  .contact { text-align: center; font-size: 10pt; color: #333; margin-bottom: 10px; }
  .contact a { color: #0563C1; text-decoration: underline; }
  .contact a.portfolio-link { font-weight: 700; }
  h2 { font-size: 11.5pt; text-transform: uppercase; letter-spacing: 1px; margin: 12px 0 4px; padding-bottom: 2px; border-bottom: 1px solid #1F4E79; font-weight: 700; color: #1F4E79; }
  p, ul { margin: 3px 0; }
  ul { padding-left: 18px; }
  li { margin-bottom: 2px; }
  .skill-row { margin: 2px 0; }
  .skill-cat { font-weight: 700; }
  .job-header { display: flex; justify-content: space-between; margin-top: 6px; }
  .job-title { font-size: 10.8pt; }
  .job-dates { font-size: 10pt; color: #333; font-style: italic; }
  .job ul, .project ul { margin-top: 2px; }
  .proj-header { margin: 6px 0 2px; }
  .edu-row { margin: 2px 0; }
  .certs { margin-top: 2px; }
  .certs li { margin-bottom: 1px; }
</style></head>
<body>
  <h1>${esc(data.name)}</h1>
  <p class="contact">
    ${esc(data.contact.phone)} &nbsp;|&nbsp;
    <a href="mailto:${esc(data.contact.email)}">${esc(data.contact.email)}</a> &nbsp;|&nbsp;
    <a href="https://${esc(data.contact.linkedin)}">${esc(data.contact.linkedin)}</a> &nbsp;|&nbsp;
    <a href="https://${esc(data.contact.github)}">${esc(data.contact.github)}</a> &nbsp;|&nbsp;
    <a href="https://${esc(data.contact.portfolio)}" class="portfolio-link">${esc(data.contact.portfolio)}</a>
  </p>

  <h2>Summary</h2>
  <p>${esc(data.summary)}</p>

  <h2>Core Skills</h2>
  ${skillsHtml(data.skills)}

  <h2>Experience</h2>
  ${expHtml(data.experience)}

  <h2>Projects</h2>
  ${projHtml(data.projects)}

  <h2>Education</h2>
  ${eduHtml(data.education)}

  <h2>Certifications</h2>
  ${certsHtml(data.certifications)}
</body></html>`;
}

/**
 * @param {object} data    Resume data (defaults to ./resume-data.js)
 * @param {string} outPath Output .pdf path
 * @returns {Promise<string>} the written path
 */
async function buildPdf(data, outPath) {
  if (!data) data = require('./resume-data');
  if (!outPath) outPath = path.join(__dirname, 'lokesh-pulivarthi-resume.pdf');

  // Prefer puppeteer-core when we have a system Chrome (dev), else full puppeteer (CI).
  const moduleName = CHROME ? 'puppeteer-core' : 'puppeteer';
  const puppeteer = await import(moduleName);
  const browser = await puppeteer.launch({
    ...(CHROME ? { executablePath: CHROME } : {}),
    headless: 'new',
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage();
  await page.setContent(renderHtml(data), { waitUntil: 'networkidle0' });
  await page.pdf({
    path: outPath,
    format: 'Letter',
    printBackground: true,
    margin: { top: '0.5in', bottom: '0.5in', left: '0.6in', right: '0.6in' },
  });
  await browser.close();
  return outPath;
}

module.exports = { buildPdf };

if (require.main === module) {
  buildPdf().then(p => console.log(`PDF written: ${p}`));
}
