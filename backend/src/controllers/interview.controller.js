import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import prisma from '../db/prisma.js';
import { pool } from '../db/pool.js';
import { canReadCandidate } from '../middleware/ownership.js';

/**
 * Interview session ownership: a session belongs to a candidate user. Access is
 * allowed for the owner, a platform admin, or a college admin whose college owns
 * the candidate. Unattributed (guest) sessions have no owner and stay readable.
 */
const sessionAccessDenied = async (req, sessionUserId) => {
  if (!sessionUserId) return false; // guest / unattributed session
  const { ok } = await canReadCandidate(req, sessionUserId);
  return !ok;
};

// Fallback questions used only when the client does not supply its own
// resume/role-aware set. Four well-formed questions max.
const DEFAULT_QUESTIONS = [
  {
    questionNumber: 1,
    category: 'INTRODUCTION & ROLE FIT',
    questionText: 'Tell me about yourself, and why are you interested in this role?'
  },
  {
    questionNumber: 2,
    category: 'ROLE FUNDAMENTALS',
    questionText: 'Which core technical skills do you rely on most, and how have you applied them in a real project?'
  },
  {
    questionNumber: 3,
    category: 'PROBLEM SOLVING',
    questionText: 'Describe a difficult technical problem you faced. How did you diagnose the cause, and what did you change to resolve it?'
  },
  {
    questionNumber: 4,
    category: 'LEARNING & GROWTH',
    questionText: 'How do you keep your skills current, and what would you like to improve next?'
  }
];

// Helper to sanitize numeric decimals to 2 decimal places
const round2 = (num) => Math.round((Number(num) || 0) * 100) / 100;

// ─── Strict, content-driven interview scoring ───────────────────────────────
// Scores start at 0. Technical credit is only awarded for technical concepts
// that the candidate actually says; merely speaking does not earn a baseline.
const CORE_TECH_KEYWORDS = [
  'algorithm', 'api', 'architecture', 'backend', 'cache', 'classification', 'cloud',
  'component', 'concurrency', 'database', 'data structure', 'debugging', 'deployment',
  'docker', 'frontend', 'git', 'java', 'javascript', 'kubernetes', 'machine learning',
  'microservice', 'model', 'node', 'optimization', 'performance', 'pipeline', 'python',
  'query', 'react', 'regression', 'rest', 'scalable', 'security', 'service', 'sql',
  'state', 'system', 'testing', 'trade-off', 'typescript'
];

const ROLE_TECH_KEYWORDS = {
  ml: ['machine learning', 'model', 'training', 'evaluation', 'overfitting', 'features', 'dataset', 'python', 'pandas', 'numpy', 'scikit', 'pytorch', 'tensorflow', 'classification', 'regression', 'metric', 'precision', 'recall', 'data preprocessing'],
  data: ['sql', 'data', 'dataset', 'analysis', 'analytics', 'visualization', 'dashboard', 'etl', 'statistics', 'pandas', 'python', 'excel', 'tableau', 'power bi', 'metric', 'a/b test', 'data cleaning'],
  frontend: ['react', 'javascript', 'typescript', 'html', 'css', 'component', 'state', 'props', 'hooks', 'redux', 'ui', 'ux', 'responsive', 'accessibility', 'rendering', 'browser', 'dom', 'api'],
  backend: ['api', 'server', 'database', 'sql', 'postgresql', 'mysql', 'mongodb', 'authentication', 'authorization', 'cache', 'redis', 'microservice', 'scalable', 'endpoint', 'rest', 'node', 'express', 'java', 'spring', 'transaction', 'queue'],
  devops: ['docker', 'kubernetes', 'ci/cd', 'pipeline', 'deployment', 'cloud', 'aws', 'azure', 'gcp', 'terraform', 'monitoring', 'logging', 'linux', 'bash', 'infrastructure', 'container', 'helm', 'prometheus'],
  mobile: ['android', 'ios', 'mobile', 'react native', 'flutter', 'swift', 'kotlin', 'navigation', 'offline', 'state', 'api', 'performance', 'app store', 'play store'],
  fullstack: ['frontend', 'backend', 'api', 'database', 'react', 'node', 'javascript', 'typescript', 'sql', 'state', 'component', 'deployment', 'authentication', 'rest']
};

const DEPTH_SIGNALS = [
  'because', 'therefore', 'trade-off', 'tradeoff', 'measured', 'result', 'for example',
  'for instance', 'first', 'then', 'however', 'challenge', 'solution', 'impact',
  'latency', 'throughput', 'scale', 'percent', 'root cause'
];

const FILLER_WORDS = ['um', 'uh', 'like', 'basically', 'actually', 'you know', 'sort of', 'kind of', 'i mean'];

const inferRoleCategory = (role = '') => {
  const r = String(role || '').toLowerCase();
  if (r.includes('ml') || r.includes('machine learning') || r.includes('ai engineer') || r.includes('artificial intelligence') || r.includes('deep learning') || r.includes('computer vision') || r.includes('nlp')) return 'ml';
  if (r.includes('data science') || r.includes('data scientist') || r.includes('data analyst') || r.includes('analytics') || r.includes('bi analyst') || r.includes('business intelligence')) return 'data';
  if (r.includes('frontend') || r.includes('front-end') || r.includes('react') || r.includes('ui') || r.includes('web developer')) return 'frontend';
  if (r.includes('backend') || r.includes('back-end') || r.includes('node') || r.includes('java') || r.includes('api') || r.includes('spring') || r.includes('django')) return 'backend';
  if (r.includes('devops') || r.includes('cloud') || r.includes('docker') || r.includes('kubernetes') || r.includes('platform') || r.includes('sre') || r.includes('reliability') || r.includes('infrastructure')) return 'devops';
  if (r.includes('mobile') || r.includes('android') || r.includes('ios') || r.includes('flutter') || r.includes('react native')) return 'mobile';
  return 'fullstack';
};

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const hasKeyword = (text, keyword) => {
  const kw = String(keyword || '').toLowerCase();
  if (!kw) return false;
  if (!/^[a-z0-9 +#./-]+$/.test(kw)) return text.includes(kw);
  return new RegExp(`(^|[^a-z0-9])${escapeRegex(kw)}([^a-z0-9]|$)`, 'i').test(text);
};

const countKeywordHits = (text, keywords) => {
  const lower = String(text || '').toLowerCase();
  return [...new Set((keywords || []).filter((kw) => hasKeyword(lower, kw)))];
};

// ─── Interview attempt policy ────────────────────────────────────────────────
// INTERVIEW_MAX_ATTEMPTS controls how many AI mock interviews a candidate may
// complete:
//   1 (default)      -> single attempt
//   N                -> N attempts
//   0 / "unlimited"  -> no limit
// A session counts as a used attempt once it reaches one of the terminal
// statuses below. In-progress sessions do not consume an attempt, so a browser
// crash or refresh does not lock the candidate out.
const COMPLETED_ATTEMPT_STATUSES = ['COMPLETED', 'TERMINATED_VIOLATION'];

export const getInterviewAttemptPolicy = () => {
  const raw = String(process.env.INTERVIEW_MAX_ATTEMPTS ?? '').trim().toLowerCase();
  if (raw === '') return { unlimited: false, maxAttempts: 1 };
  if (['unlimited', 'inf', 'infinite', '0'].includes(raw)) {
    return { unlimited: true, maxAttempts: 0 };
  }
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return { unlimited: false, maxAttempts: 1 };
  return { unlimited: false, maxAttempts: parsed };
};

const countCompletedAttempts = async (userId) => {
  if (!userId) return 0;
  try {
    const result = await pool.query(
      `SELECT COUNT(*)::int AS used
       FROM interview_sessions
       WHERE user_id = $1 AND status = ANY($2::text[])`,
      [userId, COMPLETED_ATTEMPT_STATUSES]
    );
    return Number(result.rows[0]?.used) || 0;
  } catch (err) {
    // Offline / DB unavailable: fall back to the in-memory session store.
    let used = 0;
    for (const session of memorySessions.values()) {
      if (session.userId === userId && COMPLETED_ATTEMPT_STATUSES.includes(session.status)) used += 1;
    }
    return used;
  }
};

/**
 * GET /api/interview/attempts
 * Per-candidate attempt status used by the UI to lock the start button.
 */
export const getInterviewAttempts = async (req, res) => {
  try {
    const userId = req.user?.id || null;
    const isPrivileged = req.user?.role === 'admin' || req.user?.role === 'college_admin';
    const policy = getInterviewAttemptPolicy();
    const attemptsUsed = isPrivileged ? 0 : await countCompletedAttempts(userId);
    const canStart = isPrivileged || policy.unlimited || attemptsUsed < policy.maxAttempts;

    return res.json({
      success: true,
      unlimited: policy.unlimited,
      maxAttempts: policy.unlimited ? null : policy.maxAttempts,
      attemptsUsed,
      attemptsRemaining: policy.unlimited ? null : Math.max(0, policy.maxAttempts - attemptsUsed),
      canStart,
    });
  } catch (err) {
    console.error('Error getting interview attempt status:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to retrieve interview attempt status.' });
  }
};

// Resilient in-memory fallback store when PostgreSQL / cloud network is offline
const memorySessions = new Map();
const memoryAnswers = new Map();
const memoryTelemetry = new Map();
const memoryAnalysis = new Map();
const latestSessionByUser = new Map();
let lastCreatedSessionId = null;

/**
 * POST /api/interview/session
 * Create a new mock interview session with associated questions in a Prisma transaction.
 */
export const createSession = async (req, res) => {
  const { targetRole = 'Software Engineer', questions: customQuestions } = req.body;
  const userId = req.user?.id || null;

  // Enforce the configurable attempt cap before creating anything. Admins and
  // college admins bypass it so they can preview the interview.
  const isPrivileged = req.user?.role === 'admin' || req.user?.role === 'college_admin';
  const attemptPolicy = getInterviewAttemptPolicy();
  if (userId && !isPrivileged && !attemptPolicy.unlimited) {
    const attemptsUsed = await countCompletedAttempts(userId);
    if (attemptsUsed >= attemptPolicy.maxAttempts) {
      return res.status(403).json({
        success: false,
        code: 'INTERVIEW_ATTEMPT_LIMIT_REACHED',
        error: attemptPolicy.maxAttempts === 1
          ? 'You have already completed your AI mock interview. Only one attempt is allowed.'
          : `You have used all ${attemptPolicy.maxAttempts} AI mock interview attempts.`,
        attemptsUsed,
        maxAttempts: attemptPolicy.maxAttempts,
      });
    }
  }

  const sessionId = `isess-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const settings = loadSettingsFromDisk();
  const qLimit = Math.min(4, Math.max(3, Number(settings?.questionCount) || 3));

  const questionsToSeed = Array.isArray(customQuestions) && customQuestions.length > 0
    ? customQuestions.slice(0, qLimit).map((q, idx) => ({
        id: `iq-${Date.now()}-${idx}-${crypto.randomBytes(3).toString('hex')}`,
        questionNumber: idx + 1,
        category: q.category || 'INTRODUCTION & PROFILE',
        questionText: q.questionText || q.question || 'Tell me about yourself',
        answers: []
      }))
    : DEFAULT_QUESTIONS.slice(0, qLimit).map((q) => ({
        id: `iq-${Date.now()}-${q.questionNumber}-${crypto.randomBytes(3).toString('hex')}`,
        questionNumber: q.questionNumber,
        category: q.category,
        questionText: q.questionText,
        answers: []
      }));

  const fallbackSession = {
    id: sessionId,
    userId,
    status: 'IN_PROGRESS',
    targetRole,
    startedAt: new Date(),
    questions: questionsToSeed
  };

  // Always update memory store
  memorySessions.set(sessionId, fallbackSession);
  latestSessionByUser.set(userId || 'guest', fallbackSession);
  lastCreatedSessionId = sessionId;

  try {
    // Nested create is a single atomic statement. We deliberately avoid
    // prisma.$transaction here: interactive transactions time out over
    // managed connection poolers (e.g. Railway's public proxy), which silently
    // pushed sessions into the in-memory fallback.
    const session = await prisma.interviewSession.create({
      data: {
        id: sessionId,
        userId,
        status: 'IN_PROGRESS',
        targetRole,
        startedAt: new Date(),
        questions: {
          create: questionsToSeed.map((q) => ({
            id: q.id,
            questionNumber: q.questionNumber,
            category: q.category,
            questionText: q.questionText,
            askedAt: new Date()
          }))
        }
      },
      include: {
        questions: {
          orderBy: { questionNumber: 'asc' }
        }
      }
    });

    memorySessions.set(sessionId, session);
    latestSessionByUser.set(userId || 'guest', session);

    return res.status(201).json({
      success: true,
      message: 'Interview session created successfully.',
      session
    });
  } catch (error) {
    console.warn('Prisma createSession warning (using in-memory fallback):', error.message);
    return res.status(201).json({
      success: true,
      message: 'Interview session initialized successfully.',
      session: fallbackSession
    });
  }
};

/**
 * GET /api/interview/session/:id
 * Retrieve a specific interview session with questions, answers, and analysis.
 */
export const getSession = async (req, res) => {
  try {
    const { id } = req.params;
    let session = null;
    try {
      session = await prisma.interviewSession.findUnique({
        where: { id },
        include: {
          questions: {
            orderBy: { questionNumber: 'asc' },
            include: {
              answers: {
                orderBy: { startedAt: 'asc' }
              }
            }
          },
          analysis: true
        }
      });
    } catch (dbErr) {
      console.warn('Prisma getSession notice:', dbErr.message);
    }

    if (!session) {
      session = memorySessions.get(id);
    }

    if (!session) {
      return res.status(404).json({ success: false, error: 'Interview session not found.' });
    }

    if (await sessionAccessDenied(req, session.userId)) {
      return res.status(403).json({ success: false, error: 'Access denied: this interview session belongs to another candidate.' });
    }

    const analysis = session.analysis || memoryAnalysis.get(id) || null;
    return res.json({ success: true, session, analysis });
  } catch (error) {
    console.error('Error fetching interview session:', error);
    const session = memorySessions.get(req.params.id);
    if (session) {
      const analysis = session.analysis || memoryAnalysis.get(session.id) || null;
      return res.json({ success: true, session, analysis });
    }
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * GET /api/interview/session/latest/user
 * Get candidate's latest session.
 */
export const getLatestSession = async (req, res) => {
  try {
    const requester = req.user;
    const isAdmin = requester?.role === 'admin';
    const isCollegeAdmin = requester?.role === 'college_admin';

    let userId;
    if (isAdmin) {
      userId = req.query.userId || undefined; // platform admin: any target, or global latest
    } else if (isCollegeAdmin) {
      if (!req.query.userId) {
        return res.status(400).json({ success: false, error: 'userId is required to look up a candidate session.' });
      }
      const { ok } = await canReadCandidate(req, req.query.userId);
      if (!ok) {
        return res.status(403).json({ success: false, error: 'Access denied: candidate is outside your college.' });
      }
      userId = req.query.userId;
    } else if (requester?.id) {
      userId = requester.id; // candidates: always scoped to themselves
    }

    // Scoped query: admin unfiltered -> any; everyone else -> own id or guest-only
    const whereClause = userId ? { userId } : (isAdmin ? {} : { userId: null });

    let session = null;
    try {
      session = await prisma.interviewSession.findFirst({
        where: whereClause,
        orderBy: { startedAt: 'desc' },
        include: {
          questions: {
            orderBy: { questionNumber: 'asc' },
            include: { answers: true }
          },
          analysis: true
        }
      });
    } catch (dbErr) {
      console.warn('Prisma getLatestSession notice:', dbErr.message);
    }

    if (!session) {
      session = latestSessionByUser.get(userId || 'guest') ||
        (isAdmin && lastCreatedSessionId ? memorySessions.get(lastCreatedSessionId) : null);
    }

    if (!session) {
      return res.status(404).json({ success: false, error: 'No interview session found.' });
    }

    if (await sessionAccessDenied(req, session.userId)) {
      return res.status(403).json({ success: false, error: 'Access denied: this interview session belongs to another candidate.' });
    }

    const analysis = session.analysis || memoryAnalysis.get(session.id) || null;
    return res.json({ success: true, session, analysis });
  } catch (error) {
    console.error('Error fetching latest interview session:', error);
    const session = latestSessionByUser.get(req.user?.id || 'guest') ||
      (req.user?.role === 'admin' && lastCreatedSessionId ? memorySessions.get(lastCreatedSessionId) : null);
    if (session && !(await sessionAccessDenied(req, session.userId))) {
      const analysis = session.analysis || memoryAnalysis.get(session.id) || null;
      return res.json({ success: true, session, analysis });
    }
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * GET /api/interview/session/:id/questions
 * Get all questions for a specific session.
 */
export const getSessionQuestions = async (req, res) => {
  try {
    const { id } = req.params;

    let ownerId = null;
    try {
      const s = await prisma.interviewSession.findUnique({ where: { id }, select: { userId: true } });
      ownerId = s?.userId ?? null;
    } catch { /* fall through to memory */ }
    if (ownerId === null && memorySessions.has(id)) ownerId = memorySessions.get(id).userId ?? null;
    if (await sessionAccessDenied(req, ownerId)) {
      return res.status(403).json({ success: false, error: 'Access denied: this interview session belongs to another candidate.' });
    }

    const questions = await prisma.interviewQuestion.findMany({
      where: { sessionId: id },
      orderBy: { questionNumber: 'asc' },
      include: {
        answers: true
      }
    });

    return res.json({ success: true, questions });
  } catch (error) {
    console.error('Error fetching session questions:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * POST /api/interview/session/:id/telemetry
 * Real-time telemetry batch persistence.
 * Batches incoming telemetry samples into PostgreSQL using Prisma.
 */
export const saveTelemetryBatch = async (req, res) => {
  try {
    const { id: sessionId } = req.params;
    const { samples, questionId } = req.body;

    // Support single sample or array of samples
    const sampleList = Array.isArray(samples) ? samples : (req.body.sample ? [req.body.sample] : [req.body]);

    if (!sampleList || sampleList.length === 0) {
      return res.status(400).json({ success: false, error: 'No telemetry samples provided.' });
    }

    // Verify session existence
    const session = await prisma.interviewSession.findUnique({
      where: { id: sessionId },
      select: { id: true, userId: true }
    });

    if (!session) {
      return res.status(404).json({ success: false, error: 'Interview session not found.' });
    }

    if (await sessionAccessDenied(req, session.userId)) {
      return res.status(403).json({ success: false, error: 'Access denied: this interview session belongs to another candidate.' });
    }

    // Format records for batch insert
    const records = sampleList.map((s) => ({
      id: `telem-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      sessionId,
      questionId: s.questionId || questionId || null,
      timestamp: s.timestamp ? new Date(s.timestamp) : new Date(),
      faceDetected: s.faceDetected !== false,
      eyeContact: round2(s.eyeContact ?? s.eye_contact ?? 0),
      gazeDirection: s.gazeDirection || s.headPose || null,
      blinkRate: s.blinkRate ? round2(s.blinkRate) : null,
      emotion: s.emotion || 'Neutral',
      emotionConfidence: s.emotionConfidence ? round2(s.emotionConfidence) : null,
      attention: round2(s.attention ?? s.attention_score ?? 0),
      confidence: round2(s.confidence ?? s.confidence_score ?? 0),
      pitch: s.pitch ? round2(s.pitch) : null,
      yaw: s.yaw ? round2(s.yaw) : null,
      roll: s.roll ? round2(s.roll) : null,
      speechRate: s.speechRate ? round2(s.speechRate) : null,
      lipSync: s.lipSync ? round2(s.lipSync) : null,
      expressionStability: s.expressionStability ? round2(s.expressionStability) : null
    }));

    const result = await prisma.interviewTelemetry.createMany({
      data: records
    });

    return res.status(201).json({
      success: true,
      insertedCount: result.count
    });
  } catch (error) {
    console.error('Error saving telemetry batch:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * POST /api/interview/question/:id/answer
 * Record and evaluate a candidate's answer for a question.
 */
export const saveQuestionAnswer = async (req, res) => {
  try {
    const { id: questionId } = req.params;
    const {
      transcript = '',
      duration = 0,
      startedAt,
      completedAt,
      telemetry = {}
    } = req.body;

    // Single round-trip: resolve the question's owning session user without
    // loading the entire session row (Prisma's include costs two queries here).
    const lookup = await pool.query(
      `SELECT q.id AS question_id, q.category, s.user_id, s.target_role
       FROM interview_questions q
       JOIN interview_sessions s ON s.id = q.session_id
       WHERE q.id = $1`,
      [questionId]
    );
    const found = lookup.rows[0];

    if (!found) {
      return res.status(404).json({ success: false, error: 'Interview question not found.' });
    }

    if (await sessionAccessDenied(req, found.user_id)) {
      return res.status(403).json({ success: false, error: 'Access denied: this interview session belongs to another candidate.' });
    }

    // Evaluate answer content based on transcript length, vocabulary & structure
    const words = transcript.trim().split(/\s+/).filter(Boolean);
    const wordCount = words.length;
    const isAnswerEmpty = wordCount < 4 || transcript.toLowerCase().includes('candidate provided verbal answer') || transcript.toLowerCase().includes('no response');

    let commScore = 0;
    let techScore = 0;
    let overallQScore = 0;
    let relevanceScore = 0;
    let answerQuality = 'No Response';
    let aiFeedback = 'Candidate did not provide a verbal or typed response to this question. Score: 0/100.';
    let speechRateVal = 0;
    let matchedKeywords = [];
    const durationMinutes = Math.max(duration / 60, 0.2);

    // Metrics must come from the client's measured telemetry. If telemetry is
    // missing we score 0 rather than inventing a favourable baseline.
    const eyeContactVal = isAnswerEmpty ? 0 : round2(telemetry.eyeContact ?? 0);
    const attentionVal = isAnswerEmpty ? 0 : round2(telemetry.attention ?? 0);
    // Confidence is computed from delivery + camera behaviour below. The
    // client's `confidence` field is camera presence, not confidence, and is
    // deliberately not used as the score.
    let confidenceVal = 0;
    const dominantEmotion = isAnswerEmpty ? 'Neutral' : (telemetry.emotion || 'Neutral');

    if (!isAnswerEmpty) {
      speechRateVal = Math.min(220, Math.max(60, Math.round(wordCount / durationMinutes)));
      const lowerTranscript = transcript.toLowerCase();
      const roleCategory = inferRoleCategory(found.target_role);
      const roleKeywords = ROLE_TECH_KEYWORDS[roleCategory] || [];

      const coreHits = countKeywordHits(lowerTranscript, CORE_TECH_KEYWORDS);
      const roleHits = countKeywordHits(lowerTranscript, roleKeywords);
      const coreOnlyHits = coreHits.filter((kw) => !roleHits.includes(kw));
      const depthHits = countKeywordHits(lowerTranscript, DEPTH_SIGNALS);
      const fillerHits = countKeywordHits(lowerTranscript, FILLER_WORDS);
      const allTechnicalHits = [...new Set([...roleHits, ...coreHits])];
      const sentenceCount = (transcript.match(/[.!?]+/g) || []).length;
      const hasNumbers = /\d/.test(lowerTranscript);

      // Fluency/communication is earned through pacing, filler control,
      // sentence structure, lexical variety, and sufficient substance.
      const uniqueWords = new Set(
        words.map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, '')).filter(Boolean)
      );
      const lexicalDiversity = uniqueWords.size / Math.max(1, wordCount);
      const fillerRatio = fillerHits.length / Math.max(1, wordCount);

      let fluency = 0;
      if (speechRateVal >= 110 && speechRateVal <= 160) fluency += 30;
      else if (speechRateVal >= 90 && speechRateVal <= 190) fluency += 20;
      else if (speechRateVal >= 70 && speechRateVal <= 210) fluency += 10;

      if (fillerRatio === 0) fluency += 25;
      else if (fillerRatio <= 0.02) fluency += 20;
      else if (fillerRatio <= 0.05) fluency += 12;
      else if (fillerRatio <= 0.10) fluency += 5;

      if (sentenceCount >= 4) fluency += 20;
      else if (sentenceCount >= 2) fluency += 12;
      else if (sentenceCount === 1) fluency += 5;

      if (lexicalDiversity >= 0.75) fluency += 15;
      else if (lexicalDiversity >= 0.60) fluency += 10;
      else if (lexicalDiversity >= 0.45) fluency += 5;

      if (wordCount >= 80) fluency += 10;
      else if (wordCount >= 40) fluency += 6;
      else if (wordCount >= 20) fluency += 3;

      commScore = Math.min(95, Math.max(0, Math.round(fluency)));

      // Confidence combines visible behaviour (eye contact, attention) with
      // actual delivery quality (fluency, substance, structure). It will vary
      // widely instead of sitting at a generic camera-presence percentage.
      const substanceScore = wordCount >= 80 ? 100 : wordCount >= 40 ? 80 : wordCount >= 20 ? 55 : wordCount >= 10 ? 30 : 0;
      const structureScore = sentenceCount >= 4 ? 100 : sentenceCount >= 2 ? 75 : sentenceCount === 1 ? 45 : 0;
      confidenceVal = Math.min(95, Math.max(0, Math.round(
        eyeContactVal * 0.20 +
        attentionVal * 0.20 +
        commScore * 0.35 +
        substanceScore * 0.15 +
        structureScore * 0.10
      )));

      // Technical is strictly content-driven. There is no baseline: an answer
      // with no technical concepts scores 0 regardless of its length.
      techScore = 0;
      techScore += Math.min(45, roleHits.length * 10);
      techScore += Math.min(20, coreOnlyHits.length * 5);
      techScore += Math.min(20, depthHits.length * 5);
      if (allTechnicalHits.length > 0) {
        if (hasNumbers) techScore += 5;
        if (wordCount >= 40) techScore += 5;
        if (wordCount >= 80) techScore += 5;
      }
      techScore = Math.min(95, Math.max(0, Math.round(techScore)));

      relevanceScore = allTechnicalHits.length === 0
        ? 0
        : Math.min(95, Math.round(coreOnlyHits.length * 8 + roleHits.length * 10 + depthHits.length * 6));
      matchedKeywords = allTechnicalHits;

      overallQScore = round2(
        techScore * 0.50 + commScore * 0.25 + confidenceVal * 0.15 + eyeContactVal * 0.10
      );

      if (overallQScore >= 85) answerQuality = 'Excellent';
      else if (overallQScore >= 70) answerQuality = 'Proficient';
      else if (overallQScore >= 50) answerQuality = 'Developing';
      else answerQuality = 'Needs Improvement';

      aiFeedback = `Candidate spoke ${wordCount} words at ~${speechRateVal} WPM with a ${dominantEmotion.toLowerCase()} engagement state. ${
        allTechnicalHits.length > 0
          ? `Detected technical concepts: ${allTechnicalHits.slice(0, 5).join(', ')}.`
          : 'No technical concepts were detected in this answer.'
      }`;
    }

    const answerId = `ans-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;

    const answer = {
      id: answerId,
      questionId,
      transcript,
      startedAt: startedAt ? new Date(startedAt) : new Date(Date.now() - duration * 1000),
      completedAt: completedAt ? new Date(completedAt) : new Date(),
      duration: Number(duration) || 0,
      overallScore: overallQScore,
      communicationScore: commScore,
      technicalScore: techScore,
      confidenceScore: confidenceVal,
      eyeContactScore: eyeContactVal,
      attentionScore: attentionVal,
      relevanceScore: relevanceScore,
      dominantEmotion,
      speechRate: speechRateVal,
      answerQuality,
      aiFeedback
    };

    // Store in memory
    memoryAnswers.set(questionId, answer);
    for (const s of memorySessions.values()) {
      const q = (s.questions || []).find((item) => item.id === questionId);
      if (q) {
        if (!q.answers) q.answers = [];
        q.answers.push(answer);
      }
    }

    try {
      // The answer insert and the question completion update are independent;
      // run them concurrently to save a full database round-trip.
      await Promise.all([
        prisma.interviewAnswer.create({
          data: {
            id: answerId,
            questionId,
            transcript,
            startedAt: startedAt ? new Date(startedAt) : new Date(Date.now() - duration * 1000),
            completedAt: completedAt ? new Date(completedAt) : new Date(),
            duration: Number(duration) || 0,
            overallScore: overallQScore,
            communicationScore: commScore,
            technicalScore: techScore,
            confidenceScore: confidenceVal,
            eyeContactScore: eyeContactVal,
            attentionScore: attentionVal,
            relevanceScore: relevanceScore,
            dominantEmotion,
            speechRate: speechRateVal,
            answerQuality,
            aiFeedback
          }
        }),
        // Mark question completed
        prisma.interviewQuestion.update({
          where: { id: questionId },
          data: { completedAt: new Date() }
        }),
      ]);
    } catch (dbErr) {
      console.warn('Prisma saveQuestionAnswer notice:', dbErr.message);
    }

    return res.status(201).json({
      success: true,
      answer
    });
  } catch (error) {
    console.error('Error saving question answer:', error);
    return res.status(200).json({ success: true, message: 'Answer logged' });
  }
};

/**
 * POST /api/interview/session/:id/complete
 * Completes the interview session, aggregates all real telemetry and answer evaluations,
 * and saves InterviewAnalysis in a safe Prisma transaction.
 */
export const completeInterview = async (req, res) => {
  try {
    const { id: sessionId } = req.params;

    let session = null;
    try {
      session = await prisma.interviewSession.findUnique({
        where: { id: sessionId },
        include: {
          questions: {
            include: { answers: true }
          },
          telemetry: true
        }
      });
    } catch (dbErr) {
      console.warn('Prisma lookup notice in completeInterview:', dbErr.message);
    }

    if (!session) {
      session = memorySessions.get(sessionId);
    }

    if (!session) {
      return res.status(404).json({ success: false, error: 'Interview session not found.' });
    }

    if (await sessionAccessDenied(req, session.userId)) {
      return res.status(403).json({ success: false, error: 'Access denied: this interview session belongs to another candidate.' });
    }

    const telemetry = session.telemetry || [];
    const questions = session.questions || [];
    const answers = questions.flatMap((q) => q.answers || []);

    // 1. Calculate Real Telemetry Averages (0 when no telemetry exists)
    let avgEyeContact = 0;
    let avgAttention = 0;
    let avgConfidence = 0;
    const emotionCounts = {};

    if (telemetry.length > 0) {
      const sumEye = telemetry.reduce((acc, t) => acc + Number(t.eyeContact || 0), 0);
      const sumAtt = telemetry.reduce((acc, t) => acc + Number(t.attention || 0), 0);
      const sumConf = telemetry.reduce((acc, t) => acc + Number(t.confidence || 0), 0);

      avgEyeContact = round2(sumEye / telemetry.length);
      avgAttention = round2(sumAtt / telemetry.length);
      avgConfidence = round2(sumConf / telemetry.length);

      telemetry.forEach((t) => {
        const em = t.emotion || 'Neutral';
        emotionCounts[em] = (emotionCounts[em] || 0) + 1;
      });
    }

    // Dominant observed state (not a fabricated emotional label)
    let dominantEmotion = 'Neutral';
    let maxEmotionCount = 0;
    Object.entries(emotionCounts).forEach(([em, count]) => {
      if (count > maxEmotionCount) {
        maxEmotionCount = count;
        dominantEmotion = em;
      }
    });

    // State stability (% of frames matching dominant state)
    const emotionStability = telemetry.length > 0
      ? round2((maxEmotionCount / telemetry.length) * 100)
      : 0;

    // 2. Calculate Answer Averages (Strict 0 when candidate was silent / gave no answers)
    let avgTechnical = 0;
    let avgComm = 0;
    let avgSpeechRate = 0;
    let validAnswersCount = 0;

    if (answers.length > 0) {
      const validAnswers = answers.filter(a => {
        const text = (a.transcript || '').trim().toLowerCase();
        return text.length > 10 && !text.includes('candidate provided verbal answer') && !text.includes('no response');
      });
      validAnswersCount = validAnswers.length;

      if (validAnswersCount > 0) {
        const sumTech = validAnswers.reduce((acc, a) => acc + Number(a.technicalScore || 0), 0);
        const sumComm = validAnswers.reduce((acc, a) => acc + Number(a.communicationScore || 0), 0);
        const sumRate = validAnswers.reduce((acc, a) => acc + Number(a.speechRate || 0), 0);

        avgTechnical = round2(sumTech / answers.length);
        avgComm = round2(sumComm / answers.length);
        avgSpeechRate = round2(sumRate / validAnswersCount);
      }
    }

    // If no batch telemetry was uploaded, derive camera metrics from the
    // per-answer telemetry that the client actually measured. This keeps the
    // report consistent with the answer-level scores instead of defaulting to
    // a fabricated baseline.
    if (answers.length > 0) {
      const sumConf = answers.reduce((acc, a) => acc + Number(a.confidenceScore || 0), 0);
      // Confidence is always the answer-level delivery score, never the
      // camera-presence telemetry value.
      avgConfidence = round2(sumConf / answers.length);

      if (telemetry.length === 0) {
        const sumEye = answers.reduce((acc, a) => acc + Number(a.eyeContactScore || 0), 0);
        const sumAtt = answers.reduce((acc, a) => acc + Number(a.attentionScore || 0), 0);
        avgEyeContact = round2(sumEye / answers.length);
        avgAttention = round2(sumAtt / answers.length);
      }

      dominantEmotion = validAnswersCount > 0
        ? (avgAttention >= 70 ? 'Focused' : avgAttention >= 40 ? 'Neutral' : 'Distracted')
        : 'Neutral';
    }

    // 3. Consolidated Overall Score (0% if no verbal or typed answers were provided!)
    const overallScore = validAnswersCount > 0
      ? round2(
          avgTechnical * 0.50 +
          avgComm * 0.25 +
          avgConfidence * 0.15 +
          avgEyeContact * 0.10
        )
      : 0;

    const expressionScore = round2((avgAttention + avgConfidence) / 2);
    const speechScore = round2(avgComm);
    const totalDuration = Math.round((Date.now() - new Date(session.startedAt).getTime()) / 1000);

    // 4. Question Breakdown (Strict 0 when answer is missing)
    const questionBreakdown = questions.map((q) => {
      const ans = q.answers?.[0];
      const hasAnswer = ans && (ans.transcript || '').trim().length > 10 && !ans.transcript.toLowerCase().includes('candidate provided verbal answer');
      return {
        questionNumber: q.questionNumber,
        category: q.category,
        questionText: q.questionText,
        transcript: hasAnswer ? ans.transcript : '',
        overallScore: hasAnswer ? Number(ans.overallScore || 0) : 0,
        technicalScore: hasAnswer ? Number(ans.technicalScore || 0) : 0,
        communicationScore: hasAnswer ? Number(ans.communicationScore || 0) : 0,
        confidenceScore: Number(ans?.confidenceScore ?? avgConfidence),
        eyeContactScore: Number(ans?.eyeContactScore ?? avgEyeContact),
        dominantEmotion: ans?.dominantEmotion || dominantEmotion,
        aiFeedback: hasAnswer
          ? (ans.aiFeedback || 'Answer recorded and analyzed.')
          : 'Candidate did not provide a verbal or typed response to this question. Score: 0/100.'
      };
    });

    // 5. Dynamic Strengths, Weaknesses & Recommendations
    const strengths = [];
    const weaknesses = [];
    const recommendations = [];

    if (avgEyeContact >= 70) strengths.push('Maintained steady eye contact with the camera throughout responses.');
    else weaknesses.push('Gaze wandered away from the camera during responses.');

    if (avgConfidence >= 70) strengths.push('Remained consistently visible and centered in the camera frame.');
    else weaknesses.push('Camera presence was intermittent or the candidate was frequently outside the frame.');

    if (avgTechnical >= 75) strengths.push('Articulated core engineering fundamentals and architectural trade-offs clearly.');
    else weaknesses.push('Responses lacked specific architectural terminology and measurable metrics.');

    if (avgSpeechRate >= 110 && avgSpeechRate <= 165) strengths.push(`Optimal vocal pacing measured at ${avgSpeechRate} words per minute.`);
    else weaknesses.push(`Pacing was ${avgSpeechRate < 110 ? 'too slow with hesitation' : 'overly rapid'} during explanations.`);

    // Fallbacks if lists are sparse
    if (strengths.length === 0) strengths.push('Successfully completed all structured interview questions.');
    if (weaknesses.length === 0) weaknesses.push('Could expand on scalability bottlenecks and distributed caching.');

    recommendations.push('Structure complex answers using the STAR method (Situation, Task, Action, Result).');
    recommendations.push('Maintain direct camera eye-contact during introductory thesis sentences.');
    recommendations.push('Elaborate on production failure modes, rollback mechanisms, and monitoring dashboards.');

    const aiFeedback = `Candidate completed a mock interview for ${session.targetRole || 'Software Engineer'}. Overall readiness score ${overallScore}%, ${dominantEmotion.toLowerCase()} engagement state, and ${avgTechnical}% technical depth.`;

    const analysisId = `ianal-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;

    const fallbackAnalysis = {
      id: analysisId,
      sessionId,
      overallScore,
      communicationScore: avgComm,
      confidenceScore: avgConfidence,
      eyeContactScore: avgEyeContact,
      attentionScore: avgAttention,
      expressionScore,
      technicalScore: avgTechnical,
      speechScore,
      dominantEmotion,
      emotionStability,
      strengths,
      weaknesses,
      recommendations,
      aiFeedback,
      questionBreakdown
    };

    const updatedMemorySession = {
      ...session,
      status: 'COMPLETED',
      completedAt: new Date(),
      duration: totalDuration,
      overallScore,
      interviewScore: overallScore,
      communicationScore: avgComm,
      confidenceScore: avgConfidence,
      eyeContactScore: avgEyeContact,
      attentionScore: avgAttention,
      technicalScore: avgTechnical,
      expressionScore,
      speechScore,
      analysis: fallbackAnalysis
    };

    memorySessions.set(sessionId, updatedMemorySession);
    memoryAnalysis.set(sessionId, fallbackAnalysis);

    // 6. Persist session completion and analysis (sequential writes, no
    // interactive transaction) if the DB is online.
    try {
      const updatedSession = await prisma.interviewSession.update({
        where: { id: sessionId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          duration: totalDuration,
          overallScore,
          interviewScore: overallScore,
          communicationScore: avgComm,
          confidenceScore: avgConfidence,
          eyeContactScore: avgEyeContact,
          attentionScore: avgAttention,
          technicalScore: avgTechnical,
          expressionScore,
          speechScore
        }
      });

      const analysis = await prisma.interviewAnalysis.upsert({
        where: { sessionId },
        create: {
          id: analysisId,
          sessionId,
          overallScore,
          communicationScore: avgComm,
          confidenceScore: avgConfidence,
          eyeContactScore: avgEyeContact,
          attentionScore: avgAttention,
          expressionScore,
          technicalScore: avgTechnical,
          speechScore,
          dominantEmotion,
          emotionStability,
          strengths,
          weaknesses,
          recommendations,
          aiFeedback,
          questionBreakdown
        },
        update: {
          overallScore,
          communicationScore: avgComm,
          confidenceScore: avgConfidence,
          eyeContactScore: avgEyeContact,
          attentionScore: avgAttention,
          expressionScore,
          technicalScore: avgTechnical,
          speechScore,
          dominantEmotion,
          emotionStability,
          strengths,
          weaknesses,
          recommendations,
          aiFeedback,
          questionBreakdown,
          updatedAt: new Date()
        }
      });

      memorySessions.set(sessionId, updatedSession);
      memoryAnalysis.set(sessionId, analysis);

      const result = { session: updatedSession, analysis };

      return res.json({
        success: true,
        message: 'Interview completed and analyzed successfully.',
        session: result.session,
        analysis: result.analysis
      });
    } catch (dbErr) {
      console.warn('Prisma completeInterview notice (returning memory store):', dbErr.message);
      return res.json({
        success: true,
        message: 'Interview completed and analyzed successfully (offline store).',
        session: updatedMemorySession,
        analysis: fallbackAnalysis
      });
    }
  } catch (error) {
    console.warn('Prisma completeInterview notice (offline resilient):', error.message);
    const session = memorySessions.get(sessionId) || { id: sessionId, targetRole: 'Software Engineer', questions: [] };
    const questions = session.questions || [];
    const answers = questions.flatMap((q) => q.answers || []);

    const validAnswers = answers.filter((a) => Number(a.overallScore || 0) > 0);
    const hasSpoken = validAnswers.length > 0;
    const avgScore = hasSpoken ? Math.round(answers.reduce((acc, a) => acc + (a.overallScore || 0), 0) / (answers.length || 1)) : 0;
    const avgTech = hasSpoken ? Math.round(answers.reduce((acc, a) => acc + (a.technicalScore || 0), 0) / (answers.length || 1)) : 0;
    const avgComm = hasSpoken ? Math.round(answers.reduce((acc, a) => acc + (a.communicationScore || 0), 0) / (answers.length || 1)) : 0;
    // Use only telemetry that was actually recorded for this session.
    const recordedTelemetry = Array.isArray(session.telemetry) ? session.telemetry : [];
    const telemetryAvg = (key) => recordedTelemetry.length
      ? Math.round(recordedTelemetry.reduce((acc, t) => acc + Number(t?.[key] || 0), 0) / recordedTelemetry.length)
      : 0;
    const avgEye = telemetryAvg('eyeContact');
    const avgAtt = telemetryAvg('attention');
    // Confidence comes from per-answer delivery scoring, not camera presence.
    const avgConf = hasSpoken
      ? Math.round(answers.reduce((acc, a) => acc + Number(a.confidenceScore || 0), 0) / (answers.length || 1))
      : 0;

    const measuredStrengths = [];
    if (avgEye >= 70) measuredStrengths.push('Sustained eye contact with the camera');
    if (avgTech >= 65) measuredStrengths.push('Structured technical explanations');
    if (avgComm >= 65) measuredStrengths.push('Clear verbal communication');
    if (measuredStrengths.length === 0) measuredStrengths.push('Completed the interview session');

    const measuredWeaknesses = [];
    if (avgEye < 60) measuredWeaknesses.push('Frequent gaze diversion or distraction detected');
    if (avgTech < 60) measuredWeaknesses.push('Technical depth needs more concrete examples');
    if (avgComm < 60) measuredWeaknesses.push('Responses were brief; expand with more detail');
    if (!measuredWeaknesses.length) measuredWeaknesses.push('Continue practicing timed interview answers');

    const fallbackAnalysis = {
      id: `ana-${Date.now()}`,
      sessionId,
      overallScore: avgScore,
      communicationScore: avgComm,
      confidenceScore: avgConf,
      eyeContactScore: avgEye,
      attentionScore: avgAtt,
      expressionScore: 0,
      technicalScore: avgTech,
      speechScore: 0,
      dominantEmotion: hasSpoken ? (avgAtt >= 70 ? 'Focused' : avgAtt >= 40 ? 'Neutral' : 'Distracted') : 'Neutral',
      emotionStability: 0,
      strengths: measuredStrengths,
      weaknesses: measuredWeaknesses,
      recommendations: ['Practice timed mock answers'],
      aiFeedback: hasSpoken ? 'Interview completed using recorded answers and measured camera telemetry.' : 'No verbal answers detected.',
      questionBreakdown: questions.map((q, idx) => {
        const ans = (q.answers || [])[0];
        return {
          questionNumber: q.questionNumber || idx + 1,
          category: q.category || 'TECHNICAL',
          questionText: q.questionText || 'Interview question',
          transcript: ans?.transcript || '',
          overallScore: ans?.overallScore || 0,
          technicalScore: ans?.technicalScore || 0,
          communicationScore: ans?.communicationScore || 0,
          confidenceScore: ans?.confidenceScore || 0,
          eyeContactScore: ans?.eyeContactScore || 0,
          dominantEmotion: ans?.dominantEmotion || 'Neutral',
          aiFeedback: ans?.aiFeedback || 'Answer evaluated.'
        };
      })
    };

    session.status = 'COMPLETED';
    session.completedAt = new Date();
    session.analysis = fallbackAnalysis;
    memorySessions.set(sessionId, session);
    memoryAnalysis.set(sessionId, fallbackAnalysis);

    return res.json({
      success: true,
      message: 'Interview completed and analyzed successfully (offline store).',
      session,
      analysis: fallbackAnalysis
    });
  }
};

/**
 * GET /api/interview/session/:id/analysis
 * Returns the final calculated metrics stored in PostgreSQL.
 */
export const getSessionAnalysis = async (req, res) => {
  try {
    const { id: sessionId } = req.params;

    let analysis = null;
    try {
      analysis = await prisma.interviewAnalysis.findUnique({
        where: { sessionId },
        include: {
          session: {
            include: {
              questions: {
                include: { answers: true },
                orderBy: { questionNumber: 'asc' }
              }
            }
          }
        }
      });
    } catch (dbErr) {
      console.warn('Prisma getSessionAnalysis notice:', dbErr.message);
    }

    if (!analysis) {
      analysis = memoryAnalysis.get(sessionId);
      if (analysis) {
        const session = memorySessions.get(sessionId) || analysis.session || { id: sessionId };
        if (await sessionAccessDenied(req, session.userId)) {
          return res.status(403).json({ success: false, error: 'Access denied: this interview session belongs to another candidate.' });
        }
        return res.json({
          success: true,
          analysis,
          session
        });
      }
    }

    if (!analysis) {
      return res.status(404).json({ success: false, error: 'Interview session analysis not found.' });
    }

    if (await sessionAccessDenied(req, analysis.session?.userId)) {
      return res.status(403).json({ success: false, error: 'Access denied: this interview session belongs to another candidate.' });
    }

    return res.json({
      success: true,
      analysis,
      session: analysis.session
    });
  } catch (error) {
    console.error('Error fetching interview analysis:', error);
    const analysis = memoryAnalysis.get(req.params.id);
    if (analysis) {
      return res.json({
        success: true,
        analysis,
        session: memorySessions.get(req.params.id) || analysis.session || null
      });
    }
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * POST /api/interview/analyze-frame
 * Returns face/attention heuristics for a candidate video frame.
 * Real proctoring runs client-side via MediaPipe; this is a stateless fallback.
 */
export const analyzeFrame = async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) {
      return res.status(400).json({ success: false, error: 'Image data required.' });
    }

    // This route has no access to a vision model, so it must not fabricate a
    // score. Real frame analysis runs client-side via MediaPipe.
    return res.status(501).json({
      success: false,
      error: 'Frame analysis is performed client-side. This endpoint does not score frames.'
    });
  } catch (error) {
    console.error('Frame analysis error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Admin: Retrieve all candidate AI mock interview sessions with telemetry & scores
 */
export const getAdminSessions = async (req, res) => {
  try {
    const sessions = await prisma.interviewSession.findMany({
      include: {
        user: {
          select: { id: true, name: true, email: true }
        },
        questions: {
          include: {
            answers: true
          }
        },
        telemetry: {
          take: 5,
          orderBy: { timestamp: 'desc' }
        }
      },
      orderBy: { startedAt: 'desc' },
      take: 50
    });

    const formatted = sessions.map((s) => {
      const qCount = s.questions.length;
      const answeredCount = s.questions.filter((q) => q.answers.length > 0).length;
      return {
        id: s.id,
        candidateName: s.user?.name || 'Candidate',
        candidateEmail: s.user?.email || 'guest@candidate.edu',
        targetRole: s.targetRole || 'Software Engineer',
        status: s.status,
        overallScore: Number(s.overallScore || 0),
        technicalScore: Number(s.technicalScore || 0),
        communicationScore: Number(s.communicationScore || 0),
        eyeContactScore: Number(s.eyeContactScore || 0),
        confidenceScore: Number(s.confidenceScore || 0),
        duration: s.duration || 0,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
        questionsCount: qCount,
        answeredCount: answeredCount,
        warningCount: s.status === 'TERMINATED_VIOLATION' ? 3 : 0
      };
    });

    return res.json({
      success: true,
      count: formatted.length,
      sessions: formatted
    });
  } catch (err) {
    console.warn('Prisma getAdminSessions warning, falling back to memory sessions:', err.message);
    const sessions = Array.from(memorySessions.values()).reverse();
    const formatted = sessions.map((s) => {
      const qCount = (s.questions || []).length;
      const answeredCount = (s.questions || []).filter((q) => (q.answers || []).length > 0).length;
      return {
        id: s.id,
        userId: s.userId || s.user?.id || null,
        candidateName: s.user?.name || s.candidateName || 'Candidate',
        candidateEmail: s.user?.email || s.candidateEmail || 'candidate@readysetjob.edu',
        targetRole: s.targetRole || 'Not specified',
        status: s.status,
        overallScore: Number(s.overallScore || s.analysis?.overallScore || 0),
        technicalScore: Number(s.technicalScore || s.analysis?.technicalScore || 0),
        communicationScore: Number(s.communicationScore || s.analysis?.communicationScore || 0),
        eyeContactScore: Number(s.eyeContactScore || s.analysis?.eyeContactScore || 0),
        confidenceScore: Number(s.confidenceScore || s.analysis?.confidenceScore || 0),
        dominantEmotion: s.analysis?.dominantEmotion || s.dominantEmotion || 'Neutral',
        duration: s.duration || 0,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
        questionsCount: qCount,
        answeredCount: answeredCount,
        warningCount: s.status === 'TERMINATED_VIOLATION' ? 3 : 0
      };
    });
    return res.json({
      success: true,
      count: formatted.length,
      sessions: formatted
    });
  }
};

/**
 * Interview Settings Persistence
 */
const SETTINGS_FILE_PATH = path.join(process.cwd(), 'src', 'config', 'interview_settings.json');

const loadSettingsFromDisk = () => {
  try {
    if (fs.existsSync(SETTINGS_FILE_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE_PATH, 'utf8'));
      // Enforce the 3-4 question policy even if an older settings file exists.
      parsed.questionCount = Math.min(4, Math.max(3, Number(parsed.questionCount) || 3));
      // Per-question answer window; 15s-5min. Sarvam-safe chunking handles any
      // value above 29s automatically on the client.
      parsed.answerTimeSeconds = Math.min(300, Math.max(15, Number(parsed.answerTimeSeconds) || 30));
      return parsed;
    }
  } catch (err) {
    console.error('Error reading interview settings file:', err);
  }
  return {
    isLocked: false,
    lockReason: 'AI Mock Interview sessions are currently locked by the recruitment administrator.',
    questionCount: 3,
    answerTimeSeconds: 30,
    difficulty: 'Moderate',
    maxWarnings: 3,
    strictProctoring: true,
    cameraRequired: true,
    multiFaceDetection: true,
    objectDetection: true,
    audioProctoring: true,
    audioProctoringStrikes: false,
    requireAssessmentFirst: true,
    updatedAt: new Date().toISOString()
  };
};

export const getInterviewSettings = async (req, res) => {
  try {
    const settings = loadSettingsFromDisk();
    return res.json({ success: true, settings });
  } catch (err) {
    console.error('Error getting interview settings:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve settings' });
  }
};

export const updateInterviewSettings = async (req, res) => {
  try {
    const current = loadSettingsFromDisk();
    const updated = {
      ...current,
      ...req.body,
      questionCount: req.body.questionCount ? Math.min(4, Math.max(3, Number(req.body.questionCount))) : current.questionCount,
      answerTimeSeconds: req.body.answerTimeSeconds ? Math.min(300, Math.max(15, Number(req.body.answerTimeSeconds))) : current.answerTimeSeconds,
      maxWarnings: req.body.maxWarnings ? Math.min(10, Math.max(1, Number(req.body.maxWarnings))) : current.maxWarnings,
      isLocked: typeof req.body.isLocked === 'boolean' ? req.body.isLocked : current.isLocked,
      updatedAt: new Date().toISOString()
    };

    fs.writeFileSync(SETTINGS_FILE_PATH, JSON.stringify(updated, null, 2), 'utf8');
    console.log('Updated interview settings:', updated);
    return res.json({ success: true, settings: updated });
  } catch (err) {
    console.error('Error updating interview settings:', err);
    return res.status(500).json({ success: false, error: 'Failed to update settings' });
  }
};
