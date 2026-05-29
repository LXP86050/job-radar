/**
 * Greenhouse form-fill adapter (v2 — verified-submit).
 *
 * Key differences from v1 (which fabricated SUBMITTED status):
 *   1. scanFormFields() finds EVERY input/select/textarea in the form,
 *      not just the ones matching our regex patterns. We see required
 *      fields we previously missed.
 *   2. answerForField() maps each field to a profile-derived answer
 *      using broader label pattern matching. Required fields without
 *      a confident answer get logged as 'unfilled'.
 *   3. fillForm() returns { required_unfilled }. If non-empty, the
 *      orchestrator MUST refuse to click submit — fake-positive
 *      submissions are worse than no submission.
 *   4. submit() clicks, then verifyConfirmation() waits up to 30s for
 *      a real success signal (thank-you text / URL change / form
 *      disappearance). Status: 'submitted' only if verified, else
 *      'submitted_unverified' with the post-submit screenshot.
 */
const path = require('path');

/* -------------------- form-frame discovery (unchanged) -------------------- */

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

  const applyBtn = await page.$('a:has-text("Apply"), button:has-text("Apply")');
  if (applyBtn) {
    await applyBtn.click().catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    return findFormFrame(page);
  }

  return page;
}

/* -------------------- field scanning -------------------- */

/**
 * Find every form field in the frame, along with its label and required-ness.
 * Returns array of { id, name, tag, type, required, label, options }.
 */
async function scanFormFields(formCtx) {
  return await formCtx.$$eval(
    'input, select, textarea',
    elements => {
      function labelFor(el) {
        // Try <label for="id">
        if (el.id) {
          const lab = document.querySelector(`label[for="${el.id}"]`);
          if (lab) return lab.textContent.trim();
        }
        // Try wrapping <label>
        let p = el.parentElement;
        while (p) {
          if (p.tagName === 'LABEL') return p.textContent.trim();
          p = p.parentElement;
        }
        // Try aria-labelledby / aria-label
        const labelledBy = el.getAttribute('aria-labelledby');
        if (labelledBy) {
          const lb = document.getElementById(labelledBy);
          if (lb) return lb.textContent.trim();
        }
        const aria = el.getAttribute('aria-label');
        if (aria) return aria;
        // Fall back to placeholder or name
        return el.getAttribute('placeholder') || el.getAttribute('name') || '';
      }
      function isRequired(el, label) {
        if (el.required) return true;
        if (el.getAttribute('aria-required') === 'true') return true;
        // Greenhouse marks required questions with "*" in the label
        if (/\*\s*$/.test(label) || /\*/.test(label)) return true;
        return false;
      }
      return elements
        .filter(el => {
          if (el.type === 'hidden') return false;
          if (el.type === 'submit') return false;
          if (el.type === 'button') return false;
          // Skip React state helpers: no id, no name, no label, no placeholder
          const hasIdentity = el.id || el.getAttribute('name') || el.getAttribute('placeholder') ||
            el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
          if (!hasIdentity) return false;
          // skip elements inside hidden parents
          let p = el;
          while (p) {
            const s = window.getComputedStyle(p);
            if (s.display === 'none' || s.visibility === 'hidden') return false;
            p = p.parentElement;
          }
          return true;
        })
        .map(el => {
          const label = labelFor(el).slice(0, 200);
          const isSelect = el.tagName === 'SELECT';
          return {
            id: el.id || '',
            name: el.getAttribute('name') || '',
            tag: el.tagName,
            type: el.type || el.tagName.toLowerCase(),
            required: isRequired(el, label),
            label,
            options: isSelect
              ? Array.from(el.options).map(o => o.textContent.trim()).filter(Boolean)
              : null,
          };
        });
    }
  );
}

/* -------------------- answer logic -------------------- */

/**
 * Given a field + profile, return the value to fill, or null if no confident match.
 */
function answerForField(field, ctx) {
  const { profile, address, salary, resume, cover_letter } = ctx;
  const lbl = field.label.toLowerCase();
  const name = (field.name || '').toLowerCase();
  const id = (field.id || '').toLowerCase();
  const key = `${lbl} | ${name} | ${id}`;

  // Identity
  if (/first.?name|given.?name|f.?name\b/.test(key)) return profile.first_name;
  if (/last.?name|family.?name|surname|l.?name\b/.test(key)) return profile.last_name;
  if (/full.?name(?!.*(first|last))/.test(key)) return `${profile.first_name} ${profile.last_name}`;
  if (/preferred.?(name|first)/.test(key)) return profile.preferred_name || profile.first_name;
  if (/email/.test(key)) return profile.email;
  if (/phone|mobile|cell/.test(key)) return profile.phone_formatted;

  // URL fields
  if (/linkedin/.test(key)) return profile.linkedin;
  if (/github/.test(key)) return profile.github;
  if (/website|portfolio|personal\s*(site|url)/.test(key)) return profile.portfolio;

  // Resume / CV file upload — handled by uploadResume() separately
  if (field.type === 'file') return null;

  // Address
  if (/(street|address1|address line 1|street address)/.test(key) && !/email/.test(key)) return address.street;
  if (/location.*\(city\)|^city$|^city\b/.test(key)) return profile.location_city || `${address.city}, ${address.state}`;
  if (/city/.test(key) && !/citizenship/.test(key)) return address.city;
  if (/state|province|region/.test(key) && !/u\.?s\.?\s*citizen/.test(key)) return address.state;
  if (/(zip|postal)/.test(key)) return address.zip;
  if (/country/.test(key)) return profile.country || 'United States';

  // Education
  if (/school|university|college|institution/.test(key)) return profile.education?.school || 'University of Central Missouri';
  if (/^degree|degree.*(received|earned|name)|level of (study|education)/.test(key)) return profile.education?.degree || 'Master of Science';
  if (/discipline|major|field of study/.test(key)) return profile.education?.discipline || 'Computer Science';
  if (/end.?(date|year)|graduation.?(date|year)/.test(key)) return profile.education?.end_year || '2022';
  if (/start.?(date|year)/.test(key) && /(school|education|university)/.test(key)) return profile.education?.start_year || '2021';

  // Work auth / sponsorship — match before generic patterns
  if (/pronoun/.test(key)) return 'He/Him';
  if (/(what (kind|type) of (work )?visa|visa (do|will|would) you need|visa status|what visa)/.test(key)) return 'H1B';
  if (/if you('?re| are) not authorized/.test(key)) return null;  // intentionally skip — N/A
  if (/(require|need).*sponsorship/.test(key)) return profile.require_sponsorship ? 'Yes' : 'No';
  if (/will you (now or in the future).*sponsorship/.test(key)) return profile.require_sponsorship ? 'Yes' : 'No';
  if (/sponsor(ship)?/.test(key)) return profile.require_sponsorship ? 'Yes' : 'No';
  if (/authoriz(ed|e) to work|eligible to work|legal(ly)? to work|right to work/.test(key)) return profile.work_authorized ? 'Yes' : 'No';
  if (/(u\.?s\.?\s*)?citizen/.test(key)) return profile.us_citizen ? 'Yes' : 'No';

  // EEO
  if (/(race|ethnic)/.test(key)) return profile.race_ethnicity || 'Decline to self-identify';
  if (/hispanic|latino/.test(key)) return profile.hispanic_or_latino ? 'Yes' : 'No';
  if (/gender|sex(?!ual)/.test(key)) return profile.gender || 'Decline to self-identify';
  if (/(veteran|military)/.test(key)) return profile.veteran_status || 'I am not a protected veteran';
  if (/disab(ility|led)/.test(key)) return profile.disability_status || "I don't wish to answer";
  if (/transgender/.test(key)) return 'Decline to self-identify';
  if (/sexual orientation/.test(key)) return 'Decline to self-identify';

  // Logistical
  if (/willing to relocate/.test(key)) return profile.willing_to_relocate ? 'Yes' : 'No';
  if (/willing to travel/.test(key)) return profile.willing_to_travel ? 'Yes' : 'No';
  if (/how did you (hear|find|learn)/.test(key)) return profile.how_did_you_hear || 'LinkedIn';
  if (/(years?|year of) experience/.test(key)) return String(profile.years_experience);
  if (/start.?date|earliest.?(start|available)/.test(key)) return 'Two weeks notice';
  if (/notice.?period/.test(key)) return 'Two weeks';

  // Salary
  if (/desired.*(salary|comp|base)|expected.*(salary|comp|base)|salary expectation|salary.?range/.test(key)) {
    return String(salary?.expected || 195000);
  }
  if (/current.*(salary|comp|base)/.test(key)) return '160000';
  if (/salary/.test(key)) return String(salary?.expected || 195000);

  // Free-text / essay questions — use cover letter style answer
  if (field.tag === 'TEXTAREA' && field.required) {
    return cover_letter;
  }

  return null;
}

/* -------------------- fill helpers -------------------- */

function idSelector(id) {
  // CSS IDs that start with a digit aren't valid via "#" — use attribute selector.
  if (/^\d/.test(id)) return `[id="${id.replace(/"/g, '\\"')}"]`;
  return `#${id.replace(/([!"#$%&'()*+,./:;<=>?@\[\\\]^`{|}~])/g, '\\$1')}`;
}

/**
 * For "true" text fields (name, email, address, school): just .fill().
 * For combobox-style inputs that look like text but expect a selection from
 * a dropdown (Gender, Race, Pronoun, sponsorship Yes/No, etc.):
 *   click → type → wait → press Enter.
 * Heuristic: any required text input where the answer is one of our
 * short canonical values is likely a combobox.
 */
const COMBOBOX_VALUES = new Set([
  'yes', 'no', "i don't wish to answer", 'decline to self-identify', 'prefer not to say',
  'he/him', 'she/her', 'they/them',
  'male', 'female', 'non-binary',
  'asian', 'black', 'white', 'hispanic', 'native american', 'two or more',
  'i am not a protected veteran', 'i am a protected veteran',
  'i acknowledge', 'i agree',
  'h1b', 'h-1b', 'opt', 'cpt', 'green card', 'us citizen',
  'linkedin', 'company website', 'job board', 'referral', 'other',
  'united states',
]);

async function fillTextLike(formCtx, field, value) {
  const selector = field.id ? idSelector(field.id) : `[name="${field.name}"]`;
  const v = String(value);
  const isLikelyCombobox =
    field.tag === 'INPUT' && field.type === 'text' && field.required &&
    COMBOBOX_VALUES.has(v.toLowerCase());

  if (isLikelyCombobox) {
    // React combobox: focus, type, wait for filter, press Enter to pick.
    await formCtx.click(selector, { timeout: 5_000 });
    await formCtx.fill(selector, '', { force: true }).catch(() => {});
    await formCtx.type(selector, v, { delay: 30 });
    await formCtx.waitForTimeout(400);
    // Try clicking a visible matching dropdown option first.
    const optionSelectors = [
      `[role="option"]:has-text("${v}")`,
      `li:has-text("${v}")`,
      `[role="listbox"] *:has-text("${v}")`,
    ];
    let clicked = false;
    for (const optSel of optionSelectors) {
      const opt = await formCtx.$(optSel);
      if (opt) {
        await opt.click().catch(() => {});
        clicked = true;
        break;
      }
    }
    if (!clicked) {
      await formCtx.press(selector, 'ArrowDown');
      await formCtx.press(selector, 'Enter');
    }
    return;
  }

  await formCtx.fill(selector, v, { force: true, timeout: 5_000 });
}

async function fillSelect(formCtx, field, value) {
  const selector = field.id ? idSelector(field.id) : `[name="${field.name}"]`;
  // Try exact, then includes, then "decline" fallback
  const lower = String(value).toLowerCase();
  let target = field.options.find(o => o.toLowerCase() === lower);
  if (!target) target = field.options.find(o => o.toLowerCase().includes(lower));
  if (!target && /decline|don.?t wish/.test(lower)) {
    target = field.options.find(o => /decline|don.?t wish|prefer not/.test(o.toLowerCase()));
  }
  if (!target) return false;
  await formCtx.selectOption(selector, { label: target });
  return true;
}

async function fillCheckboxOrRadio(formCtx, field, value) {
  // For yes/no booleans, find radio with matching label
  if (field.type !== 'radio' && field.type !== 'checkbox') return false;
  const target = String(value).toLowerCase();
  const selector = `input[type="${field.type}"][name="${field.name}"]`;
  const options = await formCtx.$$eval(selector + ' + label, ' + selector + ' ~ label',
    els => els.map(e => e.textContent.trim()));
  // Just try clicking by label proximity — fragile but ok for now
  const labels = await formCtx.$$(`label:has(input[name="${field.name}"])`);
  for (const lab of labels) {
    const text = (await lab.textContent()).trim().toLowerCase();
    if (text.includes(target)) {
      await lab.click();
      return true;
    }
  }
  return false;
}

async function uploadResume(formCtx, resumePath) {
  const fileInput = await formCtx.$('input[type="file"][name*="resume" i], input[type="file"]');
  if (fileInput) {
    await fileInput.setInputFiles(resumePath);
    return true;
  }
  return false;
}

/* -------------------- main entry points -------------------- */

async function fillForm(page, ctx) {
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
  const formCtx = await findFormFrame(page);
  const fields = await scanFormFields(formCtx);

  const fields_filled = [];
  const fields_skipped = [];
  const required_unfilled = [];

  // Resume upload first
  const resumeOk = await uploadResume(formCtx, ctx.resume.pdf);
  if (resumeOk) fields_filled.push({ field: 'resume', value: ctx.resume.pdf });

  for (const f of fields) {
    if (f.type === 'file') continue;  // already handled
    const answer = answerForField(f, ctx);
    if (answer === null || answer === '') {
      if (f.required) {
        required_unfilled.push({ field: f.label || f.name || f.id, type: f.type, options: f.options });
      } else {
        fields_skipped.push({ field: f.label || f.name || f.id, reason: 'no profile mapping' });
      }
      continue;
    }
    try {
      if (f.tag === 'SELECT') {
        const ok = await fillSelect(formCtx, f, answer);
        if (!ok) {
          if (f.required) required_unfilled.push({ field: f.label, type: 'select', wanted: answer, options: f.options });
          else fields_skipped.push({ field: f.label, reason: `no matching option for "${answer}"` });
          continue;
        }
      } else if (f.type === 'radio' || f.type === 'checkbox') {
        const ok = await fillCheckboxOrRadio(formCtx, f, answer);
        if (!ok && f.required) required_unfilled.push({ field: f.label, type: f.type, wanted: answer });
      } else {
        await fillTextLike(formCtx, f, answer);
      }
      fields_filled.push({
        field: f.label || f.name || f.id,
        value: String(answer).slice(0, 80),
        required: f.required,
      });
    } catch (e) {
      if (f.required) required_unfilled.push({ field: f.label, error: e.message });
      else fields_skipped.push({ field: f.label, error: e.message });
    }
  }

  return { fields_filled, fields_skipped, required_unfilled, formCtx };
}

async function submit(page, plan) {
  if (plan.required_unfilled && plan.required_unfilled.length > 0) {
    throw new Error(
      `Refusing to submit — ${plan.required_unfilled.length} required field(s) unfilled: ` +
      plan.required_unfilled.map(f => f.field).join(' | ').slice(0, 300)
    );
  }
  const ctx = plan.formCtx || page;
  const submitSelectors = [
    '#submit_app',
    'button#submit_app',
    'button[type="submit"]:has-text("Submit")',
    'button:has-text("Submit Application")',
    'input[type="submit"][value*="Submit" i]',
    'button[type="submit"]',
    'input[type="submit"]',
  ];
  let clickedSelector = null;
  let clickedText = null;
  for (const sel of submitSelectors) {
    const el = await ctx.$(sel);
    if (el) {
      clickedSelector = sel;
      clickedText = (await el.textContent().catch(() => null)) || (await el.getAttribute('value').catch(() => null)) || '(no text)';
      await el.scrollIntoViewIfNeeded().catch(() => {});
      await el.click({ timeout: 10_000 });
      break;
    }
  }
  if (!clickedSelector) {
    throw new Error('No submit button found in form frame');
  }

  // Wait for a real confirmation signal
  const verified = await verifyConfirmation(page, ctx);
  return { clickedSelector, clickedText, verified };
}

/**
 * Watch for any sign the submission actually went through.
 * Returns true if any of these happen in 30s:
 *   - URL change to a confirmation path
 *   - Confirmation text appears on page or frame
 *   - The first_name input disappears (form replaced by success page)
 */
async function verifyConfirmation(page, formCtx) {
  const startUrl = page.url();
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    // URL change?
    const url = page.url();
    if (url !== startUrl && /(thank|confirm|applied|received|success)/i.test(url)) {
      return { kind: 'url', value: url };
    }
    // Confirmation text on page?
    const pageText = (await page.textContent('body').catch(() => '')) || '';
    if (/thank you for applying|application (was )?received|application submitted|we.?ll be in touch|thanks for applying/i.test(pageText)) {
      return { kind: 'page-text' };
    }
    // Confirmation text in frame?
    if (formCtx && formCtx !== page) {
      const frameText = (await formCtx.textContent('body').catch(() => '')) || '';
      if (/thank you for applying|application (was )?received|application submitted|we.?ll be in touch|thanks for applying/i.test(frameText)) {
        return { kind: 'frame-text' };
      }
    }
    // Form disappeared?
    const stillThere = await (formCtx === page ? page : formCtx).$('input[name*="first_name"], #first_name').catch(() => null);
    if (!stillThere) {
      return { kind: 'form-gone' };
    }
    await page.waitForTimeout(1000);
  }
  return null;
}

module.exports = { fillForm, submit, verifyConfirmation };
