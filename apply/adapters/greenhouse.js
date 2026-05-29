/**
 * Greenhouse form-fill adapter.
 *
 * Greenhouse applications all live at *.greenhouse.io/embed/job_app or
 * /jobs/{id}#app or boards.greenhouse.io/{co}/jobs/{id} URLs. The form is
 * standardized: first_name, last_name, email, phone, resume (file input),
 * cover_letter (file or textarea), LinkedIn URL, and N custom questions.
 *
 * Strategy: query by stable selectors (input id / name patterns), fall back
 * to label-text matching for custom questions.
 */
const path = require('path');

const FILL = {
  first_name: ['input[name="job_application[first_name]"]', '#first_name', 'input[autocomplete="given-name"]'],
  last_name:  ['input[name="job_application[last_name]"]',  '#last_name',  'input[autocomplete="family-name"]'],
  email:      ['input[name="job_application[email]"]',      '#email',      'input[type="email"]'],
  phone:      ['input[name="job_application[phone]"]',      '#phone',      'input[type="tel"]'],
  resume:     ['input[name="job_application[resume]"]',     '#resume',     'input[type="file"]'],
  linkedin:   ['input[name="job_application[urls][LinkedIn]"]', 'input[id*="linkedin" i]', 'input[name*="linkedin" i]'],
  github:     ['input[name="job_application[urls][GitHub]"]',   'input[id*="github" i]',   'input[name*="github" i]'],
  portfolio:  ['input[name="job_application[urls][Portfolio]"]','input[id*="website" i]', 'input[id*="portfolio" i]'],
};

async function fillIfFound(page, selectors, value) {
  for (const sel of selectors) {
    const el = await page.$(sel);
    if (el) {
      await el.fill(String(value), { force: true });
      return sel;
    }
  }
  return null;
}

async function uploadIfFound(page, selectors, filePath) {
  for (const sel of selectors) {
    const el = await page.$(sel);
    if (el) {
      await el.setInputFiles(filePath);
      return sel;
    }
  }
  return null;
}

/**
 * Detect custom questions by scanning label texts and matching to known patterns
 * (sponsorship, authorization, etc.). Returns an array of {label, selector, value}.
 */
async function detectCustomQuestions(page, profile) {
  const all = await page.$$eval('label', els => els.map(e => ({
    text: e.textContent.trim().slice(0, 200),
    forId: e.getAttribute('for') || '',
  })));

  const matched = [];
  const patterns = [
    { match: /authoriz(ed|e) to work/i,         value: profile.work_authorized ? 'Yes' : 'No' },
    { match: /require .*(sponsorship|visa)/i,    value: profile.require_sponsorship ? 'Yes' : 'No' },
    { match: /will you (now or in the future ).*(require|need).*sponsorship/i, value: profile.require_sponsorship ? 'Yes' : 'No' },
    { match: /us citizen/i,                       value: profile.us_citizen ? 'Yes' : 'No' },
    { match: /(years?|year of) experience/i,      value: String(profile.years_experience) },
    { match: /how did you (hear|find)/i,          value: profile.how_did_you_hear || 'LinkedIn' },
    { match: /willing to relocate/i,              value: profile.willing_to_relocate ? 'Yes' : 'No' },
    { match: /veteran/i,                           value: profile.veteran_status || 'Decline to self-identify' },
    { match: /disab(ility|led)/i,                  value: profile.disability_status || 'Decline to self-identify' },
    { match: /(gender|sex)/i,                      value: profile.gender || 'Decline to self-identify' },
    { match: /(race|ethnicity)/i,                  value: profile.race_ethnicity || 'Decline to self-identify' },
    { match: /hispanic/i,                          value: profile.hispanic_or_latino ? 'Yes' : 'No' },
    { match: /current.*(salary|compensation)/i,    value: '160000' },  // current
    { match: /(desired|expected).*(salary|compensation)/i, value: 'See salary expectations field' },
  ];

  for (const l of all) {
    for (const p of patterns) {
      if (p.match.test(l.text) && l.forId) {
        matched.push({ label: l.text, selector: `#${l.forId}`, value: p.value });
        break;
      }
    }
  }
  return matched;
}

/**
 * Find the actual form frame: vanilla Greenhouse renders inline, but most
 * companies embed via an iframe (id="grnhse_iframe" or src*="greenhouse.io").
 * Returns a "frame-like" object that has $/$$/waitForLoadState methods.
 */
async function findFormFrame(page) {
  // Try inline first
  const inline = await page.$('input[name="job_application[first_name]"], #first_name');
  if (inline) return page;

  // Look for known Greenhouse iframe
  for (const f of page.frames()) {
    if (f === page.mainFrame()) continue;
    const url = f.url();
    if (/greenhouse\.io/.test(url)) return f;
  }

  // Wait up to 15s for an iframe to mount
  const start = Date.now();
  while (Date.now() - start < 15_000) {
    for (const f of page.frames()) {
      if (f === page.mainFrame()) continue;
      const url = f.url();
      if (/greenhouse\.io/.test(url) || /embed/.test(url)) {
        try {
          await f.waitForSelector('input', { timeout: 5_000 });
          return f;
        } catch (_) {}
      }
    }
    await page.waitForTimeout(500);
  }

  // Some companies bake the form inline but lazy-mount on click
  // Try clicking an "Apply" button
  const applyBtn = await page.$('a:has-text("Apply"), button:has-text("Apply")');
  if (applyBtn) {
    await applyBtn.click().catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    return findFormFrame(page);
  }

  return page; // fallback — let caller handle empty matches
}

async function fillForm(page, ctx) {
  const { profile, address, salary, resume, cover_letter, dryRun } = ctx;
  const fields_filled = [];
  const fields_skipped = [];

  // Wait briefly for any async form mount
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

  // Resolve which frame the actual form is in
  const formCtx = await findFormFrame(page);
  fields_filled.push({ field: '[meta] form-frame', value: formCtx.url ? formCtx.url() : 'main' });

  // Redirect "page" to formCtx for the rest of this function
  page = formCtx;

  // Standard fields
  const standard = [
    ['first_name', profile.first_name],
    ['last_name',  profile.last_name],
    ['email',      profile.email],
    ['phone',      profile.phone_formatted],
    ['linkedin',   profile.linkedin],
    ['github',     profile.github],
    ['portfolio',  profile.portfolio],
  ];
  for (const [field, value] of standard) {
    const used = await fillIfFound(page, FILL[field], value);
    (used ? fields_filled : fields_skipped).push({ field, value: String(value), selector: used });
  }

  // Resume upload
  const resumeSel = await uploadIfFound(page, FILL.resume, resume.pdf);
  (resumeSel ? fields_filled : fields_skipped).push({
    field: 'resume', value: resume.pdf, selector: resumeSel,
  });

  // Cover-letter textarea (rare; some Greenhouse forms have it)
  const clEl = await page.$('textarea[name*="cover_letter" i], textarea[id*="cover" i]');
  if (clEl) {
    await clEl.fill(cover_letter);
    fields_filled.push({ field: 'cover_letter', value: cover_letter.slice(0, 80) + '…', selector: 'textarea[cover_letter]' });
  }

  // Custom questions (sponsorship, work auth, etc.)
  const customs = await detectCustomQuestions(page, profile);
  for (const q of customs) {
    try {
      const el = await page.$(q.selector);
      if (!el) continue;
      const tagName = await el.evaluate(e => e.tagName);
      if (tagName === 'SELECT') {
        // Try to select by visible text; fall back to first option that includes the value
        await el.selectOption({ label: q.value }).catch(async () => {
          const options = await page.$$eval(`${q.selector} option`, opts => opts.map(o => o.textContent.trim()));
          const match = options.find(o => o.toLowerCase().includes(q.value.toLowerCase()));
          if (match) await el.selectOption({ label: match });
        });
      } else {
        await el.fill(q.value, { force: true }).catch(() => {});
      }
      fields_filled.push({ field: `[custom] ${q.label.slice(0, 60)}`, value: q.value, selector: q.selector });
    } catch (e) {
      fields_skipped.push({ field: `[custom] ${q.label.slice(0, 60)}`, error: e.message });
    }
  }

  // Address fields (some Greenhouse forms include them; rare)
  const addrFields = [
    ['address',  'input[name*="address" i]:not([name*="email"])', address.street],
    ['city',     'input[name*="city" i]',                          address.city],
    ['state',    'input[name*="state" i], select[name*="state" i]', address.state],
    ['zip',      'input[name*="zip" i], input[name*="postal" i]',   address.zip],
  ];
  for (const [field, sel, value] of addrFields) {
    const el = await page.$(sel);
    if (el) {
      await el.fill(String(value), { force: true }).catch(() => {});
      fields_filled.push({ field, value: String(value), selector: sel });
    }
  }

  return { fields_filled, fields_skipped };
}

async function submit(page) {
  const submitSel = 'button[type="submit"], input[type="submit"], #submit_app';
  await page.click(submitSel);
  // Wait for navigation or confirmation
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
}

module.exports = { fillForm, submit };
