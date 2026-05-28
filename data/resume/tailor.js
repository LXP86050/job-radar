/**
 * Per-JD resume tailorer.
 *
 * Usage:
 *   node tailor.js <jd-file> <company-slug> [role-slug]
 *
 * What it does:
 *   1. Reads the JD text.
 *   2. Extracts profile-relevant keywords from the JD.
 *   3. Diffs against the master resume; finds missing-but-claimable terms.
 *   4. Injects those terms into the matching skill category (defensible
 *      additions only — vocabulary already approved in resume_profile.json).
 *   5. Re-emits a tailored DOCX + PDF into ./output/.
 *   6. Reports JD-keyword coverage of the tailored resume (target 95%+).
 */
const fs = require('fs');
const path = require('path');
const masterData = require('./resume-data');
const { buildDocx } = require('./build-docx');
const { buildPdf } = require('./build-pdf');
const { extractJdSkills, detectRequiredState, isPresent, properCase } = require('./lib/jd-keywords');

const [,, jdFile, companySlug = 'company', roleSlug = 'role'] = process.argv;

if (!jdFile) {
  console.error('Usage: node tailor.js <jd-file> <company-slug> [role-slug]');
  process.exit(1);
}

const jdText = fs.readFileSync(jdFile, 'utf8');

// 1. JD-keyword extraction
const { byCategory: jdByCat, all: jdSkills } = extractJdSkills(jdText);
console.log(`\nJD keywords found (vs profile): ${jdSkills.length}`);
for (const [cat, sks] of Object.entries(jdByCat)) {
  console.log(`  ${cat}: ${sks.join(', ')}`);
}

// 2. Diff: which JD skills are missing from master resume text?
function flattenResumeText(d) {
  return [
    d.summary,
    ...Object.values(d.skills).flat(),
    ...d.experience.flatMap(j => [j.title, j.company, ...j.bullets]),
    ...d.projects.flatMap(p => [p.name, p.stack, ...p.bullets]),
    ...d.certifications.flatMap(c => [c.name, c.issuer]),
  ].join(' \n ').toLowerCase();
}

const resumeHaystack = flattenResumeText(masterData);
const missing = jdSkills.filter(s => !isPresent(s.toLowerCase(), resumeHaystack));

console.log(`\nKeywords in JD but missing from master resume: ${missing.length}`);
if (missing.length) console.log(`  ${missing.join(', ')}`);

// 3. Inject missing keywords into a clone of the master
const tailored = JSON.parse(JSON.stringify(masterData));
const categoryMap = {
  languages: 'Languages',
  backend: 'Backend',
  frontend: 'Frontend',
  databases: 'Databases',
  cloud: 'Cloud & DevOps',
  ai_ml: 'AI & ML',
  security: 'Security',
  concepts: 'Concepts',
};
// Reverse lookup: which profile category does this skill belong to?
const profile = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'resume_profile.json'), 'utf8')
);
function categoryOf(skill) {
  for (const [cat, list] of Object.entries(profile.skills)) {
    if (list.includes(skill.toLowerCase())) return cat;
  }
  return null;
}
const injected = [];
for (const sk of missing) {
  const cat = categoryOf(sk);
  const target = categoryMap[cat];
  if (target && tailored.skills[target]) {
    const formatted = properCase(sk);
    if (!tailored.skills[target].includes(formatted)) {
      tailored.skills[target].push(formatted);
      injected.push(`${formatted} → ${target}`);
    }
  }
}

console.log(`\nInjected ${injected.length} keyword(s) into tailored resume:`);
for (const i of injected) console.log(`  + ${i}`);

// 4. Detect state requirement
const stateReq = detectRequiredState(jdText);
console.log(`\nState requirement detected: ${stateReq || '(none — will use default WA)'}`);

// 5. Build outputs
const outDir = path.join(__dirname, 'output');
fs.mkdirSync(outDir, { recursive: true });
const baseName = `lokesh-resume-${companySlug}-${roleSlug}`.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
const docxPath = path.join(outDir, `${baseName}.docx`);
const pdfPath = path.join(outDir, `${baseName}.pdf`);

(async () => {
  await buildDocx(tailored, docxPath);
  await buildPdf(tailored, pdfPath);

  // 6. Score tailored coverage against this JD
  const tailoredText = flattenResumeText(tailored);
  const covered = jdSkills.filter(s => isPresent(s.toLowerCase(), tailoredText));
  const pct = jdSkills.length ? Math.round((covered.length / jdSkills.length) * 100) : 100;

  console.log(`\n--- Tailored resume written ---`);
  console.log(`  DOCX: ${docxPath}`);
  console.log(`  PDF:  ${pdfPath}`);
  console.log(`\nJD coverage: ${pct}% (${covered.length}/${jdSkills.length})`);
  if (pct < 90) {
    console.log(`  ⚠️  Below 90% — likely JD asks for unclaimed skills (review missing list above).`);
  } else {
    console.log(`  ✓  Above 90% target.`);
  }
})();
