/**
 * Client-Side Resume Parsing & ATS Intelligence Engine
 * Extracts Candidate Details, Technical Stack, Projects, compares with target job role benchmarks,
 * calculates ATS match, extracts skill gaps, and generates moderate-level interview questions.
 */

/**
 * Canonical target-role options for the interview setup dropdowns.
 * Grouped for readability; the flat list is convenient for validation and
 * for preserving a previously saved custom role.
 */
export const TARGET_ROLE_GROUPS = [
  {
    label: 'Software Engineering',
    roles: [
      'Software Engineer',
      'Full Stack Developer',
      'Frontend Developer',
      'Backend Developer',
      'Mobile Developer',
      'Android Developer',
      'iOS Developer',
      'QA / Test Engineer',
    ],
  },
  {
    label: 'Data & AI',
    roles: [
      'ML Engineer',
      'AI Engineer',
      'Data Scientist',
      'Data Analyst',
      'Business Intelligence Analyst',
    ],
  },
  {
    label: 'Cloud & DevOps',
    roles: [
      'DevOps Engineer',
      'Cloud Engineer',
      'Site Reliability Engineer',
      'Platform Engineer',
    ],
  },
];

export const TARGET_ROLE_OPTIONS = TARGET_ROLE_GROUPS.flatMap((group) => group.roles);

export const KNOWN_SKILLS = [
  // Web & Full Stack
  'React', 'React.js', 'Next.js', 'Vue', 'Angular', 'TypeScript', 'JavaScript', 'HTML5', 'CSS3', 'TailwindCSS',
  'Node.js', 'Express', 'NestJS', 'GraphQL', 'REST APIs', 'WebSockets', 'Vite', 'Webpack',
  // Backend & Systems
  'Python', 'Django', 'FastAPI', 'Flask', 'Java', 'Spring Boot', 'Go', 'Golang', 'C++', 'C#', '.NET',
  'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'SQL', 'Prisma', 'Hibernate', 'Microservices', 'System Design',
  // AI, Machine Learning & Data Science
  'Machine Learning', 'Deep Learning', 'PyTorch', 'TensorFlow', 'Scikit-Learn', 'Pandas', 'NumPy',
  'Computer Vision', 'NLP', 'Natural Language Processing', 'LLMs', 'RAG', 'Hugging Face', 'Data Analysis',
  'Data Science', 'Data Preprocessing', 'Model Training', 'Model Evaluation', 'Statistics',
  // Cloud, DevOps & Tools
  'Docker', 'Kubernetes', 'AWS', 'Azure', 'GCP', 'CI/CD', 'Git', 'GitHub', 'Linux',
  'Kafka', 'RabbitMQ', 'Jest', 'Unit Testing', 'Power BI', 'Tableau'
];

/**
 * Benchmark skills by technical category for role alignment & skill gap suggestions.
 */
export const ROLE_BENCHMARK_SKILLS = {
  ml: {
    coreSkills: ['Python', 'Machine Learning', 'Scikit-Learn', 'Pandas', 'Model Training', 'PyTorch', 'Data Preprocessing', 'Model Evaluation'],
    advancedSkills: ['TensorFlow', 'Deep Learning', 'FastAPI', 'Docker', 'MLOps', 'Hyperparameter Tuning', 'NLP', 'Computer Vision']
  },
  data: {
    coreSkills: ['SQL', 'Python', 'Pandas', 'Data Cleaning', 'Data Visualization', 'Exploratory Analysis', 'Statistics'],
    advancedSkills: ['Power BI', 'Tableau', 'A/B Testing', 'Machine Learning', 'BigQuery', 'ETL Pipelines']
  },
  frontend: {
    coreSkills: ['React', 'JavaScript', 'TypeScript', 'HTML5/CSS3', 'Responsive UI', 'REST API Integration', 'State Management'],
    advancedSkills: ['Next.js', 'TailwindCSS', 'Redux / Zustand', 'Performance Optimization', 'Jest / Testing', 'WebSockets']
  },
  backend: {
    coreSkills: ['Node.js', 'Express', 'PostgreSQL', 'RESTful APIs', 'JWT Authentication', 'Database Schema', 'SQL'],
    advancedSkills: ['Redis', 'Docker', 'Microservices', 'GraphQL', 'Prisma / ORM', 'CI/CD Pipelines']
  },
  devops: {
    coreSkills: ['Docker', 'CI/CD Pipelines', 'Linux', 'AWS Cloud', 'Git', 'Containerization'],
    advancedSkills: ['Kubernetes', 'Terraform', 'Prometheus / Grafana', 'Helm', 'Bash Scripting', 'Security & IAM']
  },
  fullstack: {
    coreSkills: ['React', 'Node.js', 'PostgreSQL', 'REST APIs', 'JavaScript', 'TypeScript', 'Git', 'Database Schema'],
    advancedSkills: ['Docker', 'Redis', 'Next.js', 'TailwindCSS', 'System Design', 'CI/CD']
  }
};

/**
 * Categorizes any job role title into a recognized technical domain.
 */
export const getRoleCategory = (role = '') => {
  const r = (role || '').toLowerCase();
  if (r.includes('ml') || r.includes('machine learning') || r.includes('ai') || r.includes('artificial intelligence') || r.includes('deep learning') || r.includes('computer vision') || r.includes('nlp')) {
    return 'ml';
  }
  if (r.includes('data science') || r.includes('data scientist') || r.includes('data analyst') || r.includes('analytics') || r.includes('bi analyst') || r.includes('business intelligence')) {
    return 'data';
  }
  if (r.includes('frontend') || r.includes('front-end') || r.includes('react') || r.includes('ui') || r.includes('web developer')) {
    return 'frontend';
  }
  if (r.includes('backend') || r.includes('back-end') || r.includes('node') || r.includes('java') || r.includes('api') || r.includes('spring') || r.includes('django')) {
    return 'backend';
  }
  if (r.includes('devops') || r.includes('cloud') || r.includes('docker') || r.includes('kubernetes') || r.includes('platform') || r.includes('sre') || r.includes('reliability') || r.includes('infrastructure')) {
    return 'devops';
  }
  if (r.includes('mobile') || r.includes('android') || r.includes('ios') || r.includes('flutter') || r.includes('react native')) {
    return 'mobile';
  }
  return 'fullstack';
};

/**
 * Provides domain-specific default skills and realistic projects based on target role.
 */
export const getRoleDefaults = (role = 'Software Engineer') => {
  const category = getRoleCategory(role);
  switch (category) {
    case 'ml':
      return {
        skills: ['Python', 'Machine Learning', 'Scikit-Learn', 'Pandas', 'Model Training', 'PyTorch'],
        featuredProject: 'Predictive Machine Learning Classification Pipeline with Model Evaluation'
      };
    case 'data':
      return {
        skills: ['SQL', 'Python', 'Pandas', 'Data Cleaning', 'Data Visualization', 'Exploratory Analysis'],
        featuredProject: 'Customer Insights & Business Intelligence Analytics Dashboard'
      };
    case 'frontend':
      return {
        skills: ['React', 'JavaScript', 'TypeScript', 'HTML5/CSS3', 'Responsive UI', 'REST API Integration'],
        featuredProject: 'Interactive Web Application with Responsive Component Architecture'
      };
    case 'backend':
      return {
        skills: ['Node.js', 'Express', 'PostgreSQL', 'RESTful APIs', 'JWT Authentication', 'Database Schema'],
        featuredProject: 'Scalable Backend REST API Service with Authentication & Database Integration'
      };
    case 'devops':
      return {
        skills: ['Docker', 'CI/CD Pipelines', 'Linux', 'AWS Cloud', 'Git', 'Containerization'],
        featuredProject: 'Automated Containerized CI/CD Deployment Pipeline on Cloud'
      };
    case 'mobile':
      return {
        skills: ['React Native', 'JavaScript', 'Mobile UI/UX', 'State Management', 'REST APIs', 'Git'],
        featuredProject: 'Cross-Platform Mobile Application with Offline Sync & Clean Navigation'
      };
    case 'fullstack':
    default:
      return {
        skills: ['React', 'Node.js', 'PostgreSQL', 'REST APIs', 'JavaScript', 'Git'],
        featuredProject: 'Full Stack Web Application with Responsive Frontend and Secure REST API'
      };
  }
};

export const RESUME_MAX_BYTES = 20 * 1024 * 1024;
export const RESUME_ALLOWED_EXTENSIONS = ['.pdf', '.txt'];

export const getResumeExtension = (fileName = '') => {
  const name = String(fileName || '');
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
};

/**
 * Validate a candidate resume file before reading it.
 * Returns { ok: true, extension } or { ok: false, error }.
 */
export const validateResumeFile = (file) => {
  if (!file) return { ok: false, error: 'No file selected.' };

  const extension = getResumeExtension(file.name);
  if (!RESUME_ALLOWED_EXTENSIONS.includes(extension)) {
    return { ok: false, error: 'Only PDF and TXT resumes are supported.' };
  }
  if (!file.size || Number(file.size) <= 0) {
    return { ok: false, error: 'The selected file is empty.' };
  }
  if (Number(file.size) > RESUME_MAX_BYTES) {
    return { ok: false, error: 'Resume must be 20 MB or smaller.' };
  }

  return { ok: true, extension };
};

/**
 * Heuristic check that extracted text actually looks like a resume rather than
 * a random document, image dump, or arbitrary file renamed to .txt/.pdf.
 */
export const looksLikeResume = (rawText = '') => {
  const text = String(rawText || '').trim();
  if (!text) return false;

  const lower = text.toLowerCase();
  const letters = (text.match(/[a-z]/gi) || []).length;
  if (text.length < 120 || letters / text.length < 0.35) return false;

  let signals = 0;
  if (/\b(summary|objective|profile|about me)\b/.test(lower)) signals += 1;
  if (/\b(experience|employment|work history|internship|professional experience)\b/.test(lower)) signals += 1;
  if (/\b(education|bachelor|master|degree|university|college|b\.?tech|b\.?e\b|bsc|msc|mba)\b/.test(lower)) signals += 1;
  if (/\b(skills?|technologies|tech stack|technical proficienc|competenc)\b/.test(lower)) signals += 1;
  if (/\b(projects?|portfolio|achievements?)\b/.test(lower)) signals += 1;
  if (/[\w.+-]+@[\w-]+\.[\w.-]+/.test(lower) || /(\+?\d[\d\s-]{8,}\d)/.test(lower) || /\blinkedin\b/.test(lower)) signals += 1;

  return signals >= 3;
};

const scoreResumeContent = (text, wordCount) => {
  const lower = text.toLowerCase();
  let score = 0;

  if (wordCount >= 120) score += 30;
  else if (wordCount >= 60) score += 22;
  else if (wordCount >= 30) score += 12;
  else return 0;

  if (/[\w.+-]+@[\w-]+\.[\w.-]+/.test(lower) || /(\+?\d[\d\s-]{8,}\d)/.test(lower) || /\blinkedin\b/.test(lower)) score += 12;
  if (/\b(experience|employment|work history|internship)\b/.test(lower)) score += 12;
  if (/\b(education|bachelor|master|degree|university|college)\b/.test(lower)) score += 12;
  if (/\b(skills?|technologies|tech stack|technical proficienc)\b/.test(lower)) score += 14;
  if (/\b(projects?|portfolio|achievements?)\b/.test(lower)) score += 20;

  return Math.min(100, score);
};

const skillInList = (skill, candidateLower) =>
  candidateLower.some(c => c === skill.toLowerCase() || c.includes(skill.toLowerCase()) || skill.toLowerCase().includes(c));

/**
 * Analyzes candidate skills against the target role's core & advanced skill benchmark.
 * Returns matched skills, missing skills (skills to cover), and a skill-based score.
 *
 * The score is deliberately content-driven: an empty or skill-less resume scores 0,
 * never a fixed floor. There is no hardcoded minimum.
 */
export const analyzeRoleSkillGaps = (candidateSkills = [], targetRole = 'Software Engineer') => {
  const category = getRoleCategory(targetRole);
  const benchmark = ROLE_BENCHMARK_SKILLS[category] || ROLE_BENCHMARK_SKILLS.fullstack;
  const candidateLower = (candidateSkills || []).map(s => String(s).toLowerCase());

  const matchedCore = benchmark.coreSkills.filter(s => skillInList(s, candidateLower));
  const missingCore = benchmark.coreSkills.filter(s => !skillInList(s, candidateLower));
  const matchedAdvanced = benchmark.advancedSkills.filter(s => skillInList(s, candidateLower));
  const recommendedAdvanced = benchmark.advancedSkills
    .filter(s => !skillInList(s, candidateLower))
    .slice(0, 4);

  const coreRatio = benchmark.coreSkills.length > 0
    ? matchedCore.length / benchmark.coreSkills.length
    : 0;
  const advancedRatio = benchmark.advancedSkills.length > 0
    ? matchedAdvanced.length / benchmark.advancedSkills.length
    : 0;
  const breadthRatio = Math.min(1, candidateLower.length / 10);

  // Weighted skill score (0-100). No floor: no detected skills => 0.
  const atsScore = Math.round(
    (coreRatio * 0.7 + advancedRatio * 0.15 + breadthRatio * 0.15) * 100
  );

  return {
    matchedCore,
    missingCore,
    skillsToCover: [...missingCore, ...recommendedAdvanced.slice(0, 2)],
    recommendedAdvanced,
    atsScore,
    matchPercentage: Math.round(coreRatio * 100)
  };
};

/**
 * Parse raw resume text and extract candidate info, detected skills, projects, and ATS score.
 */
export const parseResumeText = (rawText, targetRole = 'Software Engineer') => {
  const text = (rawText || '').trim();
  if (!text) {
    return {
      candidateName: 'Candidate',
      atsScore: 0,
      skills: [],
      featuredProject: '',
      targetRole,
      skillGaps: {
        matchedCore: [],
        missingCore: [],
        skillsToCover: [],
        recommendedAdvanced: [],
        atsScore: 0,
        matchPercentage: 0
      },
      wordCount: 0
    };
  }

  const roleDefaults = getRoleDefaults(targetRole);

  // 1. Extract Detected Skills present on the resume text
  const detectedSkills = [];
  KNOWN_SKILLS.forEach((skill) => {
    const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'i');
    if (regex.test(text)) {
      if (!detectedSkills.includes(skill)) {
        detectedSkills.push(skill);
      }
    }
  });

  // 2. Extract Candidate Name (First non-empty line or default)
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  let candidateName = 'Candidate';
  if (lines.length > 0 && lines[0].length < 40 && !lines[0].toLowerCase().includes('resume') && !lines[0].toLowerCase().includes('curriculum')) {
    candidateName = lines[0].replace(/^[#\*\s]+/, '').trim();
  }

  // 3. Extract Project Highlights
  const projectKeywords = ['project', 'developed', 'architected', 'built', 'created', 'implemented', 'engine', 'platform', 'app', 'model', 'pipeline', 'system'];
  const projectLines = lines.filter((line) => {
    const lower = line.toLowerCase();
    return projectKeywords.some((kw) => lower.includes(kw)) && line.length > 20 && line.length < 160;
  });

  const featuredProject = projectLines.length > 0
    ? projectLines[0].replace(/^[•\-\*\d\.\s]+/, '').trim()
    : roleDefaults.featuredProject;

  // 4. Calculate Role-Aware Skill Gap & ATS Score.
  // The final score blends detected skill match with actual resume structure
  // (summary, experience, education, projects, contact details). It is fully
  // content-driven and has no hardcoded minimum.
  const skillGaps = analyzeRoleSkillGaps(detectedSkills, targetRole);
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const contentScore = scoreResumeContent(text, wordCount);
  const atsScore = Math.round(skillGaps.atsScore * 0.8 + contentScore * 0.2);
  skillGaps.atsScore = atsScore;

  return {
    candidateName,
    atsScore,
    skills: detectedSkills,
    featuredProject,
    targetRole,
    skillGaps,
    wordCount
  };
};

/**
 * Generate up to 4 targeted interview questions.
 *
 * - With an uploaded resume: questions reference the candidate's detected
 *   skills and featured project.
 * - Without a resume: questions are generic but tailored to the selected role.
 *
 * The caller slices to the admin-configured count (3 or 4).
 */
export const generateResumeQuestions = (resumeData = {}, targetRole = 'Software Engineer') => {
  const role = (targetRole || '').trim() || 'Software Engineer';
  const category = getRoleCategory(role);
  const defaults = getRoleDefaults(role);
  const detected = Array.isArray(resumeData?.skills) ? resumeData.skills.filter(Boolean) : [];
  const hasResume = Boolean(
    Number(resumeData?.wordCount) > 0 ||
    detected.length > 0 ||
    (resumeData?.featuredProject && resumeData.featuredProject !== defaults.featuredProject)
  );

  const skills = (hasResume && detected.length > 0) ? detected : defaults.skills;
  const topSkills = skills.slice(0, 3);
  const topSkillsText = topSkills.join(', ') || 'your core technical skills';
  // Only use a project that actually came from the resume. The parser uses a
  // role default when it cannot find one, and we must not present that as the
  // candidate's own project.
  const resumeProject = hasResume &&
    resumeData?.featuredProject &&
    resumeData.featuredProject !== defaults.featuredProject
    ? resumeData.featuredProject
    : '';
  const projectRef = resumeProject ? `"${resumeProject}"` : 'a project listed on your resume';

  const rolePrompts = {
    ml: {
      core: `Walk me through how you train and evaluate a machine learning model, from data preparation through choosing the right metric.`,
      problem: `Describe a model that underperformed. How did you determine whether the issue was data quality, feature selection, or overfitting?`,
      growth: `Which machine learning skills are you strengthening next, and how are you practicing them?`,
      resume: `In ${projectRef}, how did you prepare the data, train the model, and evaluate it? Which of ${topSkillsText} did you use?`,
    },
    data: {
      core: `How do you approach exploratory data analysis and decide which metrics or visualisations best answer a business question?`,
      problem: `Tell me about a time you found a data-quality issue or unexpected trend. How did you investigate and communicate it?`,
      growth: `Which data skills are you currently improving for a ${role} role, and what are you doing to practise them?`,
      resume: `In ${projectRef}, what data did you analyse, which ${topSkillsText} tools did you use, and what insight or decision came out of it?`,
    },
    frontend: {
      core: `How do you structure a frontend application so components, state, and API calls stay maintainable as it grows?`,
      problem: `Describe a frontend bug or performance issue you diagnosed and fixed. What was the root cause, and what did you change?`,
      growth: `Which frontend skills are you strengthening for a ${role} role, and how are you practising them?`,
      resume: `In ${projectRef}, how did you structure the UI and state? Which of ${topSkillsText} did you use, and what trade-offs did you make?`,
    },
    backend: {
      core: `How do you design a backend API, including database modelling, validation, and error handling?`,
      problem: `Tell me about an API or database issue you diagnosed. How did you trace the root cause, and what fixed it?`,
      growth: `Which backend skills are you building next for a ${role} role, and how are you practising them?`,
      resume: `Which parts of ${projectRef} did you build on the backend? How did you handle data modelling, authentication, or scale with ${topSkillsText}?`,
    },
    devops: {
      core: `How do you design a CI/CD pipeline from build and test through deployment, and how do you keep it reliable?`,
      problem: `Describe a deployment or infrastructure incident you handled. How did you detect it, and what did you change afterwards?`,
      growth: `Which DevOps or cloud skills are you strengthening next, and how are you practising them?`,
      resume: `In ${projectRef}, how did you automate build, test, or deployment with ${topSkillsText}? What would you improve today?`,
    },
    mobile: {
      core: `How do you structure a mobile app so navigation, state, and offline behaviour stay reliable?`,
      problem: `Tell me about a mobile performance or device-compatibility issue you diagnosed and fixed.`,
      growth: `Which mobile development skills are you strengthening next, and how are you practising them?`,
      resume: `In ${projectRef}, how did you build the mobile experience? How did ${topSkillsText} help with navigation, state, or performance?`,
    },
    fullstack: {
      core: `How do you connect a frontend to a backend API end to end, including data modelling, authentication, and error handling?`,
      problem: `Describe a full-stack issue that spanned both frontend and backend. How did you isolate and fix it?`,
      growth: `Which full-stack skills are you strengthening next, and how are you practising them?`,
      resume: `In ${projectRef}, what did you build on the frontend and backend? How did ${topSkillsText} support the implementation?`,
    },
  };

  const prompts = rolePrompts[category] || rolePrompts.fullstack;

  if (hasResume) {
    return [
      {
        id: 'q-intro-1',
        questionNumber: 1,
        category: 'INTRODUCTION & RESUME',
        questionText: `Tell me about yourself, and how your experience with ${topSkillsText} led you toward ${role} roles.`,
      },
      {
        id: 'q-proj-2',
        questionNumber: 2,
        category: 'RESUME PROJECT DEEP DIVE',
        questionText: `Walk me through ${projectRef}. What problem did it solve, what was your specific contribution, and how was it built?`,
      },
      {
        id: 'q-chal-3',
        questionNumber: 3,
        category: 'RESUME PROJECT CHALLENGES',
        questionText: `What was the hardest technical or delivery challenge you faced while working on ${projectRef}, and how did you resolve it?`,
      },
      {
        id: 'q-skill-4',
        questionNumber: 4,
        category: 'ROLE-SPECIFIC SKILLS',
        questionText: prompts.resume,
      },
    ];
  }

  return [
    {
      id: 'q-intro-1',
      questionNumber: 1,
      category: 'INTRODUCTION & ROLE FIT',
      questionText: `Tell me about yourself and why you are interested in a ${role} role.`,
    },
    {
      id: 'q-core-2',
      questionNumber: 2,
      category: 'ROLE FUNDAMENTALS',
      questionText: prompts.core,
    },
    {
      id: 'q-prob-3',
      questionNumber: 3,
      category: 'PROBLEM SOLVING',
      questionText: prompts.problem,
    },
    {
      id: 'q-growth-4',
      questionNumber: 4,
      category: 'LEARNING & GROWTH',
      questionText: prompts.growth,
    },
  ];
};

/**
 * Extract plain text from PDF ArrayBuffer via client-side pdfjs-dist.
 */
export const extractTextFromPdf = async (arrayBuffer) => {
  try {
    const pdfjsLib = await import('pdfjs-dist/build/pdf.js');
    if (pdfjsLib.GlobalWorkerOptions && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;
    }
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(arrayBuffer),
      useSystemFonts: true,
      disableFontFace: true
    });
    const pdf = await loadingTask.promise;
    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item) => item.str).join(' ');
      fullText += pageText + '\n';
    }
    if (fullText.trim().length > 10) {
      return fullText;
    }
  } catch (err) {
    console.warn('PDF extraction notice:', err);
  }
  return '';
};

/**
 * Validate and read a resume file into plain text. Throws a user-facing error
 * when the file is the wrong type, too large, corrupt, or has no readable text.
 */
export const readResumeFile = async (file) => {
  const validation = validateResumeFile(file);
  if (!validation.ok) {
    throw new Error(validation.error);
  }

  if (validation.extension === '.pdf') {
    const buffer = await file.arrayBuffer();
    const headerBytes = new Uint8Array(buffer.slice(0, 5));
    const header = String.fromCharCode(...headerBytes);
    if (header !== '%PDF-') {
      throw new Error('The file is not a valid PDF. Please upload a real PDF or TXT resume.');
    }

    const text = await extractTextFromPdf(buffer);
    if (!text || text.trim().length < 40) {
      throw new Error('No readable text found in this PDF. Scanned/image-only PDFs are not supported.');
    }
    return text;
  }

  const text = await file.text();
  if (!text || !text.trim()) {
    throw new Error('The selected text file is empty.');
  }
  return text;
};
