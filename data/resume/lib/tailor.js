/**
 * Shared per-job resume tailoring.
 *
 * Clones the master resume and adapts it to ONE job description:
 *   1. Injects missing profile keywords the JD mentions (honest — vocabulary is
 *      resume_profile.json, so nothing fabricated).
 *   2. Reorders skills within each category so JD-relevant ones lead.
 *   3. Specializes the summary's opening line to the JD's dominant theme.
 *   4. Trims to ~95% coverage so it reads naturally (not 100% keyword-stuffed).
 *
 * This is the single source of tailoring logic, required by both
 * apply/tailor-matches.js (daily batch) and apply/tailor-url.js (single URL),
 * so the two can never drift apart.
 */
const path = require('path');
const masterData = require(path.join(__dirname, '..', 'resume-data'));
const { extractJdSkills, isPresent, properCase } = require(path.join(__dirname, 'jd-keywords'));
const profile = require(path.join(__dirname, '..', '..', 'resume_profile.json'));

const TARGET_MIN = 0.92;
const TARGET_MAX = 0.96;

const CATEGORY_MAP = {
  languages: 'Languages', backend: 'Backend', frontend: 'Frontend',
  databases: 'Databases', cloud: 'Cloud & DevOps', ai_ml: 'AI & ML',
  security: 'Security', concepts: 'Concepts',
};

// Skills never dropped when trimming to band. NOTE: 'java' intentionally omitted —
// the candidate does not have Java, so it is never kept or injected.
const CORE_KEEPERS = new Set([
  'python', 'javascript', 'typescript', 'c#', 'sql',
  'react', 'next.js', 'django', 'fastapi', '.net core',
  'azure', 'aws', 'kubernetes', 'docker', 'terraform', 'github actions',
  'restful apis', 'rest api', 'rest apis', 'microservices architecture',
  'large language models (llm, llms)', 'retrieval-augmented generation (rag)',
  'agentic ai', 'ai agents', 'langchain', 'azure openai (gpt-4)',
  'system design', 'distributed systems',
].map(s => s.toLowerCase()));

function categoryOf(skill) {
  for (const [cat, list] of Object.entries(profile.skills)) {
    if (list.includes(skill.toLowerCase())) return cat;
  }
  return null;
}

function flattenResume(d) {
  return [
    d.summary,
    ...Object.values(d.skills).flat(),
    ...d.experience.flatMap(j => [j.title, j.company, ...j.bullets]),
    ...d.projects.flatMap(p => [p.name, p.stack, ...p.bullets]),
    ...d.certifications.flatMap(c => [c.name, c.issuer]),
  ].join(' \n ').toLowerCase();
}

// First-sentence lead, chosen by the JD's dominant skill category. All true of the
// candidate — this is emphasis, not fabrication.
const LEAD = {
  ai_ml:     'Software Engineer (SDE II) with ~7 years building agentic AI and LLM-powered (RAG) applications on cloud-native platforms.',
  frontend:  'Full-stack Software Engineer (SDE II) with ~7 years building responsive React/TypeScript front-ends backed by scalable cloud services.',
  backend:   'Software Engineer (SDE II) with ~7 years building scalable, high-throughput backend services and distributed systems in the cloud.',
  cloud:     'Software Engineer (SDE II) with ~7 years building cloud-native, containerized microservices with CI/CD and Infrastructure-as-Code.',
  databases: 'Software Engineer (SDE II) with ~7 years building data-intensive services across relational and NoSQL stores at scale.',
  security:  'Software Engineer (SDE II) with ~7 years building secure, identity-aware services (OAuth2, RBAC, SSO) in the cloud.',
};

function tailorSummary(base, jdByCat) {
  let top = null, best = 0;
  for (const [cat, arr] of Object.entries(jdByCat || {})) {
    if (arr.length > best) { best = arr.length; top = cat; }
  }
  if (!top || !LEAD[top]) return base;
  const tail = base.split('. ').slice(1).join('. ');
  return LEAD[top] + (tail ? ' ' + tail : '');
}

function tailorToBand(jdText) {
  const { byCategory: jdByCat, all: jdSkills } = extractJdSkills(jdText);
  const tailored = JSON.parse(JSON.stringify(masterData));

  // 1. Inject missing JD keywords (only profile skills — honest).
  let haystack = flattenResume(tailored);
  for (const sk of jdSkills) {
    if (isPresent(sk.toLowerCase(), haystack)) continue;
    const cat = CATEGORY_MAP[categoryOf(sk)];
    if (cat && tailored.skills[cat]) {
      const formatted = properCase(sk);
      if (!tailored.skills[cat].some(x => x.toLowerCase() === formatted.toLowerCase())) {
        tailored.skills[cat].push(formatted);
        haystack = flattenResume(tailored);
      }
    }
  }

  // 2. Reorder each category so JD-relevant skills lead (visible per-job tailoring).
  const isJd = (item) => {
    const low = item.toLowerCase();
    return jdSkills.some(s => { const x = s.toLowerCase(); return low.includes(x) || x.includes(low); });
  };
  for (const cat of Object.keys(tailored.skills)) {
    const items = tailored.skills[cat];
    tailored.skills[cat] = [...items.filter(isJd), ...items.filter(x => !isJd(x))];
  }

  // 3. Specialize the summary opener to the JD's dominant theme.
  tailored.summary = tailorSummary(masterData.summary, jdByCat);

  // 4. Coverage; trim a few non-core matched dupes to land ~95% (reads natural).
  haystack = flattenResume(tailored);
  let matched = jdSkills.filter(s => isPresent(s.toLowerCase(), haystack));
  let pct = jdSkills.length ? matched.length / jdSkills.length : 1;
  if (pct > TARGET_MAX) {
    for (const [, items] of Object.entries(tailored.skills)) {
      for (let i = items.length - 1; i >= 0 && pct > TARGET_MAX; i--) {
        const item = items[i];
        if (CORE_KEEPERS.has(item.toLowerCase()) || !isJd(item)) continue;
        items.splice(i, 1);
        haystack = flattenResume(tailored);
        const np = jdSkills.length ? jdSkills.filter(s => isPresent(s.toLowerCase(), haystack)).length / jdSkills.length : 1;
        if (np < TARGET_MIN) { items.splice(i, 0, item); continue; }  // undo if it dips too far
        pct = np;
      }
      if (pct <= TARGET_MAX) break;
    }
    matched = jdSkills.filter(s => isPresent(s.toLowerCase(), flattenResume(tailored)));
  }

  return { tailored, jdSkillCount: jdSkills.length, matched: matched.length, coverage: pct };
}

module.exports = { tailorToBand, tailorSummary, flattenResume, categoryOf, CATEGORY_MAP, CORE_KEEPERS };
