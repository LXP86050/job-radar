/** Dumps every field the Greenhouse scanner sees on a given URL. */
const { chromium } = require('playwright');

async function findFormFrame(page) {
  const inline = await page.$('input[name="job_application[first_name]"], #first_name');
  if (inline) return page;
  for (const f of page.frames()) {
    if (f === page.mainFrame()) continue;
    if (/greenhouse\.io/.test(f.url())) return f;
  }
  const start = Date.now();
  while (Date.now() - start < 15_000) {
    for (const f of page.frames()) {
      if (f === page.mainFrame()) continue;
      if (/greenhouse\.io/.test(f.url()) || /embed/.test(f.url())) {
        try { await f.waitForSelector('input', { timeout: 5_000 }); return f; } catch {}
      }
    }
    await page.waitForTimeout(500);
  }
  return page;
}

(async () => {
  const url = process.argv[2] || 'https://www.klaviyo.com/careers/jobs?gh_jid=7749877003';
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
  await page.waitForTimeout(3000);
  const ctx = await findFormFrame(page);
  console.log(`\nForm frame: ${ctx === page ? 'main page' : ctx.url()}\n`);

  const fields = await ctx.$$eval('input, select, textarea', els => els.map(el => {
    function labelFor(el) {
      if (el.id) {
        const lab = document.querySelector(`label[for="${el.id}"]`);
        if (lab) return lab.textContent.trim();
      }
      let p = el.parentElement;
      while (p) {
        if (p.tagName === 'LABEL') return p.textContent.trim();
        p = p.parentElement;
      }
      const lbBy = el.getAttribute('aria-labelledby');
      if (lbBy) {
        const lb = document.getElementById(lbBy);
        if (lb) return lb.textContent.trim();
      }
      return el.getAttribute('aria-label') || el.getAttribute('placeholder') || '';
    }
    const isHidden = (() => {
      let p = el;
      while (p) {
        const s = window.getComputedStyle(p);
        if (s.display === 'none' || s.visibility === 'hidden') return true;
        p = p.parentElement;
      }
      return false;
    })();
    return {
      tag: el.tagName,
      type: el.type || '',
      id: el.id || '',
      name: el.getAttribute('name') || '',
      required: el.required || el.getAttribute('aria-required') === 'true',
      label: labelFor(el).slice(0, 100),
      visible: !isHidden,
      hasOptions: el.tagName === 'SELECT' ? el.options.length : null,
    };
  }));

  console.log(`Total fields: ${fields.length}`);
  console.log(`Visible: ${fields.filter(f => f.visible).length}\n`);
  fields.filter(f => f.visible).forEach((f, i) => {
    console.log(`${(i+1).toString().padStart(2)}. [${f.tag}/${f.type}] ${f.required ? 'REQ ' : '   '} id="${f.id}" name="${f.name}"`);
    console.log(`     label: "${f.label}"`);
    if (f.hasOptions) console.log(`     options: ${f.hasOptions}`);
  });

  await browser.close();
})();
