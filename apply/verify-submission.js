/**
 * Verify whether a submission actually went through by re-opening the URL
 * with the same browser context that just attempted it. If the page now
 * shows a confirmation OR "already applied" message → success. If the form
 * is fresh and submittable → failed.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const URLS = [
  ['klaviyo', 'https://www.klaviyo.com/careers/jobs?gh_jid=7749877003'],
  ['boxinc',  'https://job-boards.greenhouse.io/boxinc/jobs/7926452'],
];

(async () => {
  const browser = await chromium.launch({ headless: false, args: ['--no-sandbox'] });
  for (const [name, url] of URLS) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    console.log(`\n=== ${name} ===`);
    console.log(`URL: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
    const out = path.join(__dirname, '..', 'state', 'screenshots', `verify-${name}-${Date.now()}.png`);
    await page.screenshot({ path: out, fullPage: true });

    // Look for signals
    const body = (await page.textContent('body').catch(() => '')) || '';
    const lc = body.toLowerCase();
    const signals = {
      'confirmation_text': /thank you for applying|application (was )?received|we.?ll be in touch|application submitted|thanks for applying/.test(lc),
      'already_applied': /already applied|you have applied|you submitted/.test(lc),
      'form_still_visible': await page.$('input[type="email"], input[name*="first_name"]').then(el => !!el).catch(() => false),
    };
    console.log('Signals:', signals);
    console.log(`Screenshot: ${out}`);
    await ctx.close();
  }
  await browser.close();
})();
