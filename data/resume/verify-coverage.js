/**
 * Verifies the resume text contains every skill listed in resume_profile.json.
 * Uses alias map to handle variant spellings (C# = csharp, Next.js = nextjs, etc.)
 * — matching what most real ATS parsers do.
 *
 * Run with: node verify-coverage.js
 */
const fs = require('fs');
const path = require('path');
const data = require('./resume-data');

const profile = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'resume_profile.json'), 'utf8')
);

// Alias map — bidirectional. Each needle is checked against itself + listed aliases.
const ALIASES = {
  'csharp':                          ['c#'],
  'c#':                              ['csharp', 'c sharp'],
  'sklearn':                         ['scikit-learn', 'scikit learn'],
  'scikit-learn':                    ['sklearn'],
  'nextjs':                          ['next.js', 'next js'],
  'next.js':                         ['nextjs'],
  'postgres':                        ['postgresql'],
  'postgresql':                      ['postgres'],
  'oauth2':                          ['oauth 2.0', 'oauth 2', 'oauth'],
  'oauth':                           ['oauth 2.0', 'oauth2'],
  'material ui':                     ['material-ui', 'materialui', 'mui'],
  'hugging face':                    ['huggingface'],
  'huggingface':                     ['hugging face'],
  'retrieval augmented generation':  ['retrieval-augmented generation'],
  'k8s':                             ['kubernetes'],
  'kubernetes':                      ['k8s'],
  'html':                            ['html5', 'html 5'],
  'css':                             ['css3', 'css 3'],
  'fullstack':                       ['full stack', 'full-stack'],
  'full stack':                      ['fullstack', 'full-stack'],
  'full-stack':                      ['fullstack', 'full stack'],
  'entra':                           ['microsoft entra', 'entra id'],
  'sso':                             ['single sign-on', 'single sign on'],
  'llm':                             ['llms', 'large language model', 'large language models'],
  'llms':                            ['llm', 'large language model', 'large language models'],
  'rag':                             ['retrieval-augmented generation', 'retrieval augmented generation'],
  'iac':                             ['infrastructure as code'],
  'infrastructure as code':          ['iac'],
  'ci/cd':                           ['ci cd', 'continuous integration'],
  'gpt-4':                           ['gpt 4', 'gpt4'],
  '.net':                            ['dotnet', '.net core'],
  '.net core':                       ['.net', 'dotnet core'],
  'asp.net':                         ['aspnet'],
  'rest api':                        ['rest apis', 'restful api', 'restful apis'],
  'rest apis':                       ['rest api', 'restful api', 'restful apis'],
  'gcp':                             ['google cloud', 'google cloud platform'],
  'google cloud':                    ['gcp', 'google cloud platform'],
  'aws':                             ['amazon web services'],
};

function flattenResume(d) {
  const parts = [
    d.name, d.summary,
    ...Object.values(d.skills).flat(),
    ...d.experience.flatMap(j => [j.title, j.company, ...j.bullets]),
    ...d.projects.flatMap(p => [p.name, p.stack, ...p.bullets]),
    ...d.education.flatMap(e => [e.degree, e.school]),
    ...d.certifications.flatMap(c => [c.name, c.issuer]),
  ];
  return parts.join(' \n ').toLowerCase();
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isPresent(needle, haystack) {
  const candidates = [needle, ...(ALIASES[needle] || [])];
  for (const c of candidates) {
    // Word-boundary-ish: not preceded/followed by alphanumeric
    const re = new RegExp(`(?<![a-z0-9])${escapeRe(c)}(?![a-z0-9])`, 'i');
    if (re.test(haystack)) return { ok: true, matched: c };
  }
  return { ok: false };
}

const haystack = flattenResume(data);
const allSkills = Object.entries(profile.skills);
const results = {};
let totalFound = 0, totalSkills = 0;

for (const [category, skills] of allSkills) {
  const missing = [];
  const found = [];
  for (const s of skills) {
    const r = isPresent(s.toLowerCase(), haystack);
    if (r.ok) found.push(s);
    else missing.push(s);
  }
  results[category] = { found, missing, coverage: found.length / skills.length };
  totalFound += found.length;
  totalSkills += skills.length;
}

console.log('\n=== Resume vs resume_profile.json coverage (alias-aware) ===\n');
for (const [cat, r] of Object.entries(results)) {
  const pct = (r.coverage * 100).toFixed(0);
  console.log(`${cat.padEnd(12)} ${pct.padStart(3)}%  (${r.found.length}/${r.found.length + r.missing.length})`);
  if (r.missing.length) {
    console.log(`             missing: ${r.missing.join(', ')}`);
  }
}
console.log(`\nOVERALL:     ${((totalFound / totalSkills) * 100).toFixed(0)}%  (${totalFound}/${totalSkills})\n`);
