/**
 * Extract profile-relevant keywords from a JD.
 * Returns { byCategory: {cat: [skills...]}, all: [skills...] }.
 *
 * Strategy: take resume_profile.json skill list as the vocabulary,
 * then check which appear in the JD (word-boundary regex, alias-aware).
 */
const fs = require('fs');
const path = require('path');

const profile = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'resume_profile.json'), 'utf8')
);

// Bidirectional alias map — same as verify-coverage.js
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
  'ci/cd':                           ['ci cd', 'continuous integration', 'continuous integration/continuous delivery'],
  '.net':                            ['dotnet'],
  'rest api':                        ['rest apis', 'restful api', 'restful apis'],
  'gcp':                             ['google cloud', 'google cloud platform'],
  'google cloud':                    ['gcp'],
  'aws':                             ['amazon web services'],
};

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function isPresent(needle, haystack) {
  const candidates = [needle, ...(ALIASES[needle] || [])];
  for (const c of candidates) {
    const re = new RegExp(`(?<![a-z0-9])${escapeRe(c)}(?![a-z0-9])`, 'i');
    if (re.test(haystack)) return true;
  }
  return false;
}

/**
 * @param {string} jdText  Raw JD text (lowercased internally)
 * @returns {{byCategory: object, all: string[]}}
 */
function extractJdSkills(jdText) {
  const text = jdText.toLowerCase();
  const byCategory = {};
  const all = [];
  for (const [cat, skills] of Object.entries(profile.skills)) {
    for (const s of skills) {
      if (isPresent(s.toLowerCase(), text)) {
        (byCategory[cat] ||= []).push(s);
        all.push(s);
      }
    }
  }
  return { byCategory, all };
}

/**
 * Detect required state from JD (e.g. "must reside in CA", "California residents only").
 * Returns ISO state code or null.
 */
const STATE_PATTERNS = [
  ['AL', /\b(alabama|in al\b)/i],
  ['AK', /\b(alaska)\b/i],
  ['AZ', /\b(arizona)\b/i],
  ['AR', /\b(arkansas)\b/i],
  ['CA', /\b(california|in ca\b|bay area|san francisco|san jose|los angeles)\b/i],
  ['CO', /\b(colorado|denver|boulder)\b/i],
  ['CT', /\b(connecticut)\b/i],
  ['DE', /\b(delaware)\b/i],
  ['DC', /\b(washington dc|district of columbia|washington, d\.c\.)\b/i],
  ['FL', /\b(florida|miami|tampa|orlando)\b/i],
  ['GA', /\b(georgia|atlanta)\b/i],
  ['HI', /\b(hawaii)\b/i],
  ['ID', /\b(idaho|boise)\b/i],
  ['IL', /\b(illinois|chicago)\b/i],
  ['IN', /\b(indiana|indianapolis)\b/i],
  ['IA', /\b(iowa)\b/i],
  ['KS', /\b(kansas)\b/i],
  ['KY', /\b(kentucky)\b/i],
  ['LA', /\b(louisiana|new orleans)\b/i],
  ['ME', /\b(maine)\b/i],
  ['MD', /\b(maryland|baltimore)\b/i],
  ['MA', /\b(massachusetts|boston|cambridge)\b/i],
  ['MI', /\b(michigan|detroit|ann arbor)\b/i],
  ['MN', /\b(minnesota|minneapolis)\b/i],
  ['MS', /\b(mississippi)\b/i],
  ['MO', /\b(missouri|st\.? louis|kansas city)\b/i],
  ['MT', /\b(montana)\b/i],
  ['NE', /\b(nebraska|omaha)\b/i],
  ['NV', /\b(nevada|las vegas|reno)\b/i],
  ['NH', /\b(new hampshire)\b/i],
  ['NJ', /\b(new jersey|jersey city|newark)\b/i],
  ['NM', /\b(new mexico|albuquerque)\b/i],
  ['NY', /\b(new york|nyc|manhattan|brooklyn)\b/i],
  ['NC', /\b(north carolina|charlotte|raleigh)\b/i],
  ['ND', /\b(north dakota)\b/i],
  ['OH', /\b(ohio|columbus|cleveland|cincinnati)\b/i],
  ['OK', /\b(oklahoma)\b/i],
  ['OR', /\b(oregon|portland)\b/i],
  ['PA', /\b(pennsylvania|philadelphia|pittsburgh)\b/i],
  ['RI', /\b(rhode island)\b/i],
  ['SC', /\b(south carolina|charleston)\b/i],
  ['SD', /\b(south dakota)\b/i],
  ['TN', /\b(tennessee|nashville)\b/i],
  ['TX', /\b(texas|austin|dallas|houston)\b/i],
  ['UT', /\b(utah|salt lake)\b/i],
  ['VT', /\b(vermont)\b/i],
  ['VA', /\b(virginia|arlington|richmond)\b/i],
  ['WA', /\b(washington state|seattle|bellevue|redmond)\b/i],
  ['WV', /\b(west virginia)\b/i],
  ['WI', /\b(wisconsin|madison|milwaukee)\b/i],
  ['WY', /\b(wyoming)\b/i],
];

const REQUIREMENT_PATTERNS = [
  /must reside in/i,
  /must be located in/i,
  /local candidates only/i,
  /residents? of \w+/i,
  /on[- ]?site in/i,
  /based out of/i,
  /located in/i,
];

function detectRequiredState(jdText) {
  const requiresLocal = REQUIREMENT_PATTERNS.some(p => p.test(jdText));
  if (!requiresLocal) return null;
  for (const [code, re] of STATE_PATTERNS) {
    if (re.test(jdText)) return code;
  }
  return null;
}

/**
 * Proper-case map for skills that have a canonical form.
 * Used when injecting a skill into the resume — avoids "Csharp" / "Nextjs".
 */
const CASE_MAP = {
  'c#': 'C#', 'csharp': 'C#',
  '.net': '.NET', 'dotnet': '.NET',
  '.net core': '.NET Core', 'asp.net': 'ASP.NET',
  'next.js': 'Next.js', 'nextjs': 'Next.js',
  'react': 'React', 'redux': 'Redux',
  'tailwind': 'Tailwind CSS', 'tailwind css': 'Tailwind CSS',
  'fluent ui': 'Fluent UI', 'material ui': 'Material-UI', 'material-ui': 'Material-UI',
  'html': 'HTML5', 'html5': 'HTML5', 'css': 'CSS3', 'css3': 'CSS3',
  'postgres': 'PostgreSQL', 'postgresql': 'PostgreSQL',
  'sql server': 'SQL Server', 'mongodb': 'MongoDB',
  'cosmos db': 'Cosmos DB', 'redis': 'Redis',
  'azure ai search': 'Azure AI Search',
  'aws': 'AWS', 'gcp': 'GCP', 'google cloud': 'GCP',
  'azure': 'Azure', 'azure devops': 'Azure DevOps',
  'aks': 'AKS', 'kubernetes': 'Kubernetes', 'k8s': 'Kubernetes (K8s)',
  'docker': 'Docker', 'terraform': 'Terraform',
  'bicep': 'Bicep', 'github actions': 'GitHub Actions',
  'ci/cd': 'CI/CD Pipelines',
  'infrastructure as code': 'Infrastructure as Code (IaC)', 'iac': 'IaC',
  'openai': 'OpenAI', 'azure openai': 'Azure OpenAI',
  'langchain': 'LangChain', 'llamaindex': 'LlamaIndex',
  'rag': 'RAG', 'retrieval augmented generation': 'Retrieval-Augmented Generation (RAG)',
  'scikit-learn': 'scikit-learn', 'sklearn': 'scikit-learn',
  'nltk': 'NLTK', 'tensorflow': 'TensorFlow', 'pytorch': 'PyTorch',
  'huggingface': 'HuggingFace', 'hugging face': 'HuggingFace', 'transformers': 'Transformers',
  'vector search': 'Vector Search', 'vector database': 'Vector Database',
  'embeddings': 'Vector Embeddings',
  'llm': 'LLM', 'llms': 'LLMs', 'fine-tuning': 'Fine-tuning',
  'prompt engineering': 'Prompt Engineering',
  'agents': 'AI Agents', 'agentic': 'Agentic AI', 'mcp': 'MCP',
  'azure ad': 'Azure AD', 'entra': 'Microsoft Entra',
  'oauth': 'OAuth 2.0', 'oauth2': 'OAuth 2.0',
  'jwt': 'JWT', 'rbac': 'RBAC',
  'saml': 'SAML', 'sso': 'SSO', 'okta': 'Okta',
  'distributed systems': 'Distributed Systems',
  'system design': 'System Design',
  'scalability': 'Scalability',
  'high availability': 'High Availability',
  'performance optimization': 'Performance Optimization',
  'api integration': 'API Integration',
  'authentication': 'Authentication',
  'authorization': 'Authorization',
  'full stack': 'Full Stack', 'fullstack': 'Full Stack', 'full-stack': 'Full Stack',
  'backend': 'Backend', 'frontend': 'Frontend',
  'production engineering': 'Production Engineering',
  'agile': 'Agile', 'scrum': 'Scrum',
  'python': 'Python', 'javascript': 'JavaScript', 'typescript': 'TypeScript',
  'java': 'Java', 'sql': 'SQL',
  'django': 'Django', 'fastapi': 'FastAPI',
  'rest api': 'RESTful APIs', 'rest apis': 'RESTful APIs',
  'microservices': 'Microservices Architecture',
  'entity framework': 'Entity Framework', 'dapper': 'Dapper',
  'graphql': 'GraphQL', 'grpc': 'gRPC',
};

function properCase(skill) {
  return CASE_MAP[skill.toLowerCase()] || skill;
}

module.exports = { extractJdSkills, detectRequiredState, isPresent, properCase, ALIASES };
