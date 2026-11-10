import { pool, getDbStatus } from '../db/pool.js';
import crypto from 'crypto';
import { fallbackAssessments, fallbackQuestions, getMySubmissionsFallback } from '../mockFallback.js';
import { serverError } from '../utils/httpError.js';
import { cacheGet, cacheSet } from '../utils/shortCache.js';

let assessmentsCache = null;
let lastAssessmentsFetch = 0;
const assessmentsScopedCache = new Map(); // scope key -> { value, expiresAt }
const CACHE_TTL_MS = Math.max(0, parseInt(process.env.ASSESSMENTS_CACHE_TTL_MS || '120000', 10));

// A single assessment can carry up to three interchangeable question-paper sets.
// Set A is the admin-authored paper; B/C are generated from the bank with the
// same category/topic mix. Each candidate is assigned one set at attempt start.
export const ASSESSMENT_SET_CODES = ['A', 'B', 'C'];
export const clampSetCount = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(ASSESSMENT_SET_CODES.length, Math.max(1, Math.floor(n)));
};
const normalizeSetCode = (value) => {
  const code = String(value || '').trim().toUpperCase();
  return ASSESSMENT_SET_CODES.includes(code) ? code : 'A';
};

export const clearAssessmentsCache = () => {
  assessmentsCache = null;
  lastAssessmentsFetch = 0;
  assessmentsScopedCache.clear();
};

/**
 * Resolve the college a candidate belongs to. The candidate access token does
 * not currently carry college_id, so fall back to candidate_profiles/users.
 */
export const resolveCollegeIdForUser = async (user) => {
  if (!user?.id || !pool || !getDbStatus()) return user?.college_id || null;
  if (user.college_id) return user.college_id;
  const memoKey = String(user.id);
  const cached = cacheGet('userCollege', memoKey);
  if (cached !== undefined) return cached;
  try {
    const res = await pool.query(
      `SELECT college_id FROM users WHERE id = $1
       UNION
       SELECT college_id FROM candidate_profiles WHERE id = $1 OR user_id = $1`,
      [user.id]
    );
    const collegeId = res.rows.map((r) => r.college_id).find(Boolean) || null;
    cacheSet('userCollege', memoKey, collegeId, 300000);
    return collegeId;
  } catch (err) {
    console.warn('[assessments] college lookup failed:', err.message);
    return null;
  }
};

/**
 * An assessment with no assessment_colleges rows is available to everyone.
 * Otherwise only candidates from a linked college may see or start it.
 */
export const candidateCanAccessAssessment = async (assessmentId, user, collegeIdOverride) => {
  if (!assessmentId || !pool || !getDbStatus()) return true;
  try {
    const links = await pool.query(
      'SELECT college_id FROM assessment_colleges WHERE assessment_id = $1',
      [assessmentId]
    );
    if (links.rows.length === 0) return true;
    const collegeId = collegeIdOverride !== undefined
      ? collegeIdOverride
      : await resolveCollegeIdForUser(user);
    if (!collegeId) return false;
    return links.rows.some((row) => String(row.college_id) === String(collegeId));
  } catch (err) {
    console.warn('[assessments] college access check failed:', err.message);
    return false;
  }
};

/**
 * Prefetch the candidate assessment list at startup. Mirrors the candidate
 * branch of getAllAssessments (archived assessments excluded, no college
 * filter) so the first dashboard load is served from memory.
 */
export const warmAssessmentsCache = async () => {
  if (!pool || !getDbStatus()) return false;
  try {
    const result = await pool.query(`
      SELECT 
        a.*,
        COALESCE(
          (SELECT COUNT(*) FROM assessment_questions aq WHERE aq.assessment_id = a.id AND aq.set_code = 'A'),
          a.total_questions,
          0
        )::int as total_questions,
        COALESCE(
          (SELECT json_agg(DISTINCT ac.college_id) FROM assessment_colleges ac WHERE ac.assessment_id = a.id),
          '[]'::json
        ) as college_ids,
        COALESCE(
          (SELECT json_agg(aq.question_id) FROM assessment_questions aq WHERE aq.assessment_id = a.id AND aq.set_code = 'A'),
          '[]'::json
        ) as selected_question_ids
      FROM assessments a
      WHERE 1=1 AND a.status IS DISTINCT FROM 'Archived'
      ORDER BY a.created_at DESC
    `);
    const rows = result.rows.map(r => {
      const setCount = clampSetCount(r.set_count);
      return {
        ...r,
        status: (!r.status || r.status === 'Draft') ? 'Available' : r.status,
        durationMinutes: Number(r.duration_minutes) || 10,
        totalQuestions: Number(r.total_questions) || 0,
        passingScore: Number(r.passing_score) || 70,
        totalMarks: Number(r.total_marks) || 100,
        setCount,
        // Candidates must not see another paper before their set is assigned.
        selected_question_ids: setCount > 1 ? [] : r.selected_question_ids,
        collegeIds: Array.isArray(r.college_ids) ? r.college_ids : [],
      };
    });
    assessmentsCache = { success: true, data: rows };
    lastAssessmentsFetch = Date.now();
    return true;
  } catch (err) {
    console.warn('[assessments] cache warm-up notice:', err.message);
    return false;
  }
};

// GET /api/assessments
export const getAllAssessments = async (req, res) => {
  try {
    if (!pool || !getDbStatus()) {
      return res.json({ success: true, data: [] });
    }

    // Archived assessments are hidden from candidates but still visible to admins
    const includeArchived = req.user?.role === 'admin';
    const isCollegeAdmin = req.user?.role === 'college_admin';
    const isCandidate = req.user?.role === 'candidate';
    let userCollegeId = req.user?.college_id || null;

    if (isCandidate && !userCollegeId) {
      userCollegeId = await resolveCollegeIdForUser(req.user);
    }

    const cacheKey = `${req.user?.role || 'anon'}|${userCollegeId || 'none'}|${includeArchived ? 1 : 0}`;
    if (CACHE_TTL_MS > 0) {
      const hit = assessmentsScopedCache.get(cacheKey);
      if (hit && hit.expiresAt > Date.now()) {
        return res.json(hit.value);
      }
    }

    // The previous global cache was not scoped by college, so it could leak
    // assessments across tenants. Always query with the requester's scope.
    const queryParams = [];

    if (isCollegeAdmin && !userCollegeId) {
      return res.json({ success: true, data: [] });
    }

    // Build college filter:
    // - college_admin: only assessments linked to their college
    // - candidate: global assessments (no college links) + assessments linked
    //   to their college
    let collegeFilter = '';
    if (isCollegeAdmin && userCollegeId) {
      collegeFilter = `AND EXISTS (
        SELECT 1 FROM assessment_colleges ac WHERE ac.assessment_id = a.id AND ac.college_id = $${queryParams.length + 1}
      )`;
      queryParams.push(userCollegeId);
    } else if (isCandidate) {
      queryParams.push(userCollegeId || null);
      collegeFilter = `AND (
        NOT EXISTS (
          SELECT 1 FROM assessment_colleges ac WHERE ac.assessment_id = a.id
        )
        OR (
          $${queryParams.length}::varchar IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM assessment_colleges ac
            WHERE ac.assessment_id = a.id AND ac.college_id = $${queryParams.length}
          )
        )
      )`;
    }

    const result = await pool.query(`
      SELECT 
        a.*,
        COALESCE(
          (SELECT COUNT(*) FROM assessment_questions aq WHERE aq.assessment_id = a.id AND aq.set_code = 'A'),
          a.total_questions,
          0
        )::int as total_questions,
        COALESCE(
          (SELECT json_agg(DISTINCT ac.college_id) FROM assessment_colleges ac WHERE ac.assessment_id = a.id),
          '[]'::json
        ) as college_ids,
        COALESCE(
          (SELECT json_agg(aq.question_id) FROM assessment_questions aq WHERE aq.assessment_id = a.id AND aq.set_code = 'A'),
          '[]'::json
        ) as selected_question_ids
      FROM assessments a
      WHERE 1=1 ${collegeFilter}
      ${includeArchived ? '' : "AND a.status IS DISTINCT FROM 'Archived'"}
      ORDER BY a.created_at DESC
    `, queryParams);
    const canSeeSetA = req.user?.role === 'admin' || req.user?.role === 'college_admin';
    const rows = result.rows.map(r => {
      const setCount = clampSetCount(r.set_count);
      return {
        ...r,
        status: (!r.status || r.status === 'Draft') ? 'Available' : r.status,
        durationMinutes: Number(r.duration_minutes) || 10,
        totalQuestions: Number(r.total_questions) || 0,
        passingScore: Number(r.passing_score) || 70,
        totalMarks: Number(r.total_marks) || 100,
        setCount,
        selected_question_ids: (canSeeSetA || setCount <= 1) ? r.selected_question_ids : [],
        collegeIds: Array.isArray(r.college_ids) ? r.college_ids : [],
      };
    });
    const payload = { success: true, data: rows };
    if (CACHE_TTL_MS > 0) {
      assessmentsScopedCache.set(cacheKey, { value: payload, expiresAt: Date.now() + CACHE_TTL_MS });
    }
    res.json(payload);
  } catch (err) {
    serverError(res, err, 'assessments.controller');
  }
};

// GET /api/assessments/:id
export const getAssessmentById = async (req, res) => {
  try {
    if (req.user?.role === 'candidate') {
      const allowed = await candidateCanAccessAssessment(req.params.id, req.user);
      if (!allowed) return res.status(404).json({ error: 'Assessment not found.' });
    }

    const result = await pool.query(`
      SELECT 
        a.*,
        COALESCE(
          (SELECT COUNT(*) FROM assessment_questions aq WHERE aq.assessment_id = a.id AND aq.set_code = 'A'),
          a.total_questions,
          0
        )::int as total_questions,
        COALESCE(
          (SELECT json_agg(DISTINCT ac.college_id) FROM assessment_colleges ac WHERE ac.assessment_id = a.id),
          '[]'::json
        ) as college_ids,
        COALESCE(
          (SELECT json_agg(aq.question_id) FROM assessment_questions aq WHERE aq.assessment_id = a.id AND aq.set_code = 'A'),
          '[]'::json
        ) as selected_question_ids
      FROM assessments a
      WHERE a.id = $1
    `, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Assessment not found.' });
    const row = result.rows[0];
    const setCount = clampSetCount(row.set_count);
    const canSeeSetA = req.user?.role === 'admin' || req.user?.role === 'college_admin';
    const formatted = {
      ...row,
      durationMinutes: Number(row.duration_minutes) || 10,
      totalQuestions: Number(row.total_questions) || 0,
      passingScore: Number(row.passing_score) || 70,
      totalMarks: Number(row.total_marks) || 100,
      setCount,
      selected_question_ids: (canSeeSetA || setCount <= 1) ? row.selected_question_ids : [],
      collegeIds: Array.isArray(row.college_ids) ? row.college_ids : [],
    };
    res.json({ success: true, data: formatted });
  } catch (err) {
    serverError(res, err, 'assessments.controller');
  }
};

// Persist one question snapshot for a specific paper set.
const insertAssessmentQuestionSnapshot = async (client, assessmentId, q, setCode) => {
  const aqId = `aq-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  await client.query(
    `INSERT INTO assessment_questions (id, assessment_id, question_id, set_code, category, topic, question, difficulty, options, correct_answer, marks, test_cases, starter_templates, constraints)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (assessment_id, set_code, question_id) DO UPDATE SET
       category = EXCLUDED.category,
       topic = EXCLUDED.topic,
       question = EXCLUDED.question,
       difficulty = EXCLUDED.difficulty,
       options = EXCLUDED.options,
       correct_answer = EXCLUDED.correct_answer,
       marks = EXCLUDED.marks,
       test_cases = EXCLUDED.test_cases,
       starter_templates = EXCLUDED.starter_templates,
       constraints = EXCLUDED.constraints`,
    [
      aqId,
      assessmentId,
      q.id,
      setCode,
      q.category,
      q.topic,
      q.question,
      q.difficulty,
      JSON.stringify(q.options || []),
      q.correct_answer,
      q.marks || 1,
      q.test_cases ? JSON.stringify(q.test_cases) : null,
      q.starter_templates ? JSON.stringify(q.starter_templates) : null,
      q.constraints != null ? JSON.stringify(q.constraints) : null
    ]
  );
};

const distributionKey = (row) =>
  `${String(row.category || '').trim().toLowerCase()}|${String(row.topic || '').trim().toLowerCase()}`;

const sameSetDistribution = (rows, targetRows) => {
  if (rows.length !== targetRows.length) return false;
  const countByKey = (list) => list.reduce((map, row) => {
    const key = distributionKey(row);
    map.set(key, (map.get(key) || 0) + 1);
    return map;
  }, new Map());
  const left = countByKey(rows);
  const right = countByKey(targetRows);
  if (left.size !== right.size) return false;
  for (const [key, count] of left.entries()) {
    if (right.get(key) !== count) return false;
  }
  return true;
};

// Build a paper set from the bank with the same category/topic mix as set A,
// preferring questions that are not already used by another set.
const generateAssessmentSet = async (client, assessmentId, setCode, targetRows, usedQuestionIds) => {
  const categories = [...new Set(
    targetRows.map(row => String(row.category || '').trim()).filter(Boolean)
  )];
  const pools = new Map();

  for (const category of categories) {
    const res = await client.query(
      `SELECT id, category, topic, question, difficulty, options, correct_answer, marks,
              test_cases, starter_templates, constraints
       FROM questions
       WHERE LOWER(category) = LOWER($1)
         AND (status IS NULL OR status = 'Active')
       ORDER BY created_at DESC`,
      [category]
    );
    pools.set(category.toLowerCase(), res.rows);
  }

  const used = new Set(usedQuestionIds);
  const picked = [];
  const pickedIds = new Set();

  for (const target of targetRows) {
    const categoryKey = String(target.category || '').trim().toLowerCase();
    const topicKey = String(target.topic || '').trim().toLowerCase();
    const difficultyKey = String(target.difficulty || '').trim().toLowerCase();
    const pool = pools.get(categoryKey) || [];
    const candidates = pool.filter(q => !used.has(q.id) && !pickedIds.has(q.id));

    const pick =
      candidates.find(q => String(q.topic || '').trim().toLowerCase() === topicKey &&
        String(q.difficulty || '').trim().toLowerCase() === difficultyKey) ||
      candidates.find(q => String(q.topic || '').trim().toLowerCase() === topicKey) ||
      candidates.find(q => String(q.difficulty || '').trim().toLowerCase() === difficultyKey) ||
      candidates[0];

    if (!pick) continue;
    picked.push(pick);
    pickedIds.add(pick.id);
    used.add(pick.id);
  }

  for (const q of picked) {
    await insertAssessmentQuestionSnapshot(client, assessmentId, q, setCode);
  }
  return picked.map(q => q.id);
};

// Keep B/C in sync with the current set A without disturbing an already-valid
// set (so in-progress attempts never have their paper swapped mid-exam).
export const ensureAssessmentSets = async (client, assessmentId, setCount = 1) => {
  const requested = clampSetCount(setCount);
  const allowedCodes = ASSESSMENT_SET_CODES.slice(0, requested);

  await client.query(
    `DELETE FROM assessment_questions
     WHERE assessment_id = $1 AND NOT (set_code = ANY($2::varchar[]))`,
    [assessmentId, allowedCodes]
  );

  const setARes = await client.query(
    `SELECT question_id, category, topic, difficulty
     FROM assessment_questions
     WHERE assessment_id = $1 AND set_code = 'A'
     ORDER BY created_at ASC, id ASC`,
    [assessmentId]
  );
  if (setARes.rows.length === 0) return;

  const used = new Set(setARes.rows.map(row => row.question_id));

  for (let i = 1; i < requested; i++) {
    const setCode = ASSESSMENT_SET_CODES[i];
    const existingRes = await client.query(
      `SELECT question_id, category, topic, difficulty
       FROM assessment_questions
       WHERE assessment_id = $1 AND set_code = $2
       ORDER BY created_at ASC, id ASC`,
      [assessmentId, setCode]
    );

    if (sameSetDistribution(existingRes.rows, setARes.rows)) {
      existingRes.rows.forEach(row => used.add(row.question_id));
      continue;
    }

    await client.query(
      'DELETE FROM assessment_questions WHERE assessment_id = $1 AND set_code = $2',
      [assessmentId, setCode]
    );
    const generatedIds = await generateAssessmentSet(client, assessmentId, setCode, setARes.rows, used);
    generatedIds.forEach(id => used.add(id));
  }
};

// Helper function to sync questions for an assessment in assessment_questions table
export const syncAssessmentQuestions = async (client, assessmentId, selectedQuestionIds = [], fallbackCategory = 'Technical', targetCount = 10, setCount = 1) => {
  let idsToLink = Array.isArray(selectedQuestionIds) ? selectedQuestionIds.filter(Boolean) : [];

  // If no explicit question IDs provided, auto-select matching questions from questions table
  if (idsToLink.length === 0) {
    const isAllMix = ['All', 'Full Length', 'All Mix (Combined)', 'All Mix'].some(
      m => m.toLowerCase() === (fallbackCategory || '').toLowerCase()
    );

    let qPoolRes;
    if (isAllMix) {
      qPoolRes = await client.query('SELECT id FROM questions ORDER BY created_at DESC LIMIT $1', [targetCount || 10]);
    } else {
      qPoolRes = await client.query('SELECT id FROM questions WHERE category ILIKE $1 ORDER BY created_at DESC LIMIT $2', [fallbackCategory, targetCount || 10]);
      if (qPoolRes.rows.length === 0) {
        qPoolRes = await client.query('SELECT id FROM questions ORDER BY created_at DESC LIMIT $1', [targetCount || 10]);
      }
    }
    idsToLink = qPoolRes.rows.map(r => r.id);
  }

  if (idsToLink.length > 0) {
    // 1. Remove set-A questions that are no longer selected. Other sets are
    // reconciled by ensureAssessmentSets below.
    await client.query(
      `DELETE FROM assessment_questions
       WHERE assessment_id = $1 AND set_code = 'A' AND NOT (question_id = ANY($2::varchar[]))`,
      [assessmentId, idsToLink]
    );

    // 2. Fetch question details from questions table
    const qDetailsRes = await client.query(
      `SELECT id, category, topic, question, difficulty, options, correct_answer, marks,
              test_cases, starter_templates, constraints
       FROM questions
       WHERE id = ANY($1::varchar[])`,
      [idsToLink]
    );

    // 2b. Auto-seed missing question IDs from fallbackQuestions into questions table if needed
    const foundIds = new Set(qDetailsRes.rows.map(r => r.id));
    const missingIds = idsToLink.filter(id => !foundIds.has(id));

    if (missingIds.length > 0 && Array.isArray(fallbackQuestions)) {
      for (const mId of missingIds) {
        const fallbackQ = fallbackQuestions.find(fq => fq.id === mId || String(fq.id).toLowerCase() === String(mId).toLowerCase());
        if (fallbackQ) {
          const isCoding = fallbackQ.type === 'Coding' || fallbackQ.category === 'Coding';
          try {
            const insQ = await client.query(
              `INSERT INTO questions (id, category, topic, difficulty, type, question, options, correct_answer, marks, test_cases, starter_templates, constraints)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
               ON CONFLICT (id) DO UPDATE SET
                 category = EXCLUDED.category,
                 question = EXCLUDED.question
               RETURNING id, category, topic, question, difficulty, options, correct_answer, marks, test_cases, starter_templates, constraints`,
              [
                fallbackQ.id,
                fallbackQ.category || fallbackCategory || 'Technical',
                fallbackQ.topic || 'General',
                fallbackQ.difficulty || 'Medium',
                fallbackQ.type || (isCoding ? 'Coding' : 'Single Choice'),
                fallbackQ.question,
                JSON.stringify(fallbackQ.options || []),
                fallbackQ.correctAnswer || fallbackQ.correct_answer || 'A',
                fallbackQ.marks || (isCoding ? 10 : 4),
                fallbackQ.test_cases ? JSON.stringify(fallbackQ.test_cases) : null,
                fallbackQ.starter_templates ? JSON.stringify(fallbackQ.starter_templates) : null,
                fallbackQ.constraints != null ? JSON.stringify(fallbackQ.constraints) : null
              ]
            );
            if (insQ.rows.length > 0) {
              qDetailsRes.rows.push(insQ.rows[0]);
            }
          } catch (e) {}
        }
      }
    }

    // 3. Upsert set A, then generate/refresh sets B and C from the bank
    for (const q of qDetailsRes.rows) {
      await insertAssessmentQuestionSnapshot(client, assessmentId, q, 'A');
    }
    await ensureAssessmentSets(client, assessmentId, setCount);
  } else {
    // If no questions, clear any existing assessment_questions for this assessment
    await client.query('DELETE FROM assessment_questions WHERE assessment_id = $1', [assessmentId]);
  }
};

// POST /api/assessments  (admin only)
export const createAssessment = async (req, res) => {
  const { id: customId, title, category, description, difficulty, durationMinutes, totalQuestions, passingScore, selectedQuestionIds, collegeIds } = req.body;
  const id = customId || `asm-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const client = await pool.connect();
  const setCount = clampSetCount(req.body.setCount ?? req.body.set_count ?? 1);

  const finalTotalQuestions = (Array.isArray(selectedQuestionIds) && selectedQuestionIds.length > 0)
    ? selectedQuestionIds.length
    : (Number(totalQuestions) > 0 ? Number(totalQuestions) : 10);

  try {
    await client.query('BEGIN');
    clearAssessmentsCache();

    let createdBy = req.user?.id || null;
    if (createdBy) {
      const uCheck = await client.query('SELECT id FROM users WHERE id = $1', [createdBy]);
      if (uCheck.rows.length === 0) {
        createdBy = null;
      }
    }

    const totalMarksVal = Number(req.body.totalMarks) || 100;
    const statusVal = req.body.status || 'Available';
    const result = await client.query(
      `INSERT INTO assessments (id, title, category, description, difficulty, duration_minutes, total_questions, total_marks, passing_score, status, created_by, set_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title,
         category = EXCLUDED.category,
         description = EXCLUDED.description,
         difficulty = EXCLUDED.difficulty,
         duration_minutes = EXCLUDED.duration_minutes,
         total_questions = EXCLUDED.total_questions,
         total_marks = EXCLUDED.total_marks,
         passing_score = EXCLUDED.passing_score,
         status = EXCLUDED.status,
         set_count = EXCLUDED.set_count,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [id, title, category || 'Technical', description || null, difficulty || 'Medium', Number(durationMinutes) || 30, finalTotalQuestions, totalMarksVal, Number(passingScore) || 65, statusVal, createdBy, setCount]
    );

    // Link assessment to colleges
    const collegeIdList = Array.isArray(collegeIds) ? collegeIds : [];
    if (collegeIdList.length > 0) {
      for (const cid of collegeIdList) {
        await client.query(
          `INSERT INTO assessment_colleges (id, assessment_id, college_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (assessment_id, college_id) DO NOTHING`,
          [`ac-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`, id, cid]
        );
      }
    }

    // Sync questions into assessment_questions table
    await syncAssessmentQuestions(client, id, selectedQuestionIds, category || 'Technical', finalTotalQuestions, setCount);

    await client.query('COMMIT');
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('createAssessment error:', err.message);
    serverError(res, err, 'assessments.controller');
  } finally {
    client.release();
  }
};

// PUT /api/assessments/:id
export const updateAssessment = async (req, res) => {
  const { title, category, description, difficulty, durationMinutes, totalQuestions, passingScore, status, selectedQuestionIds, collegeIds } = req.body;
  const client = await pool.connect();
  const rawSetCount = req.body.setCount ?? req.body.set_count;
  const setCountParam = rawSetCount != null ? clampSetCount(rawSetCount) : null;

  const finalTotalQuestions = (Array.isArray(selectedQuestionIds) && selectedQuestionIds.length > 0)
    ? selectedQuestionIds.length
    : (totalQuestions != null ? Number(totalQuestions) : null);

  try {
    await client.query('BEGIN');
    clearAssessmentsCache();

    const result = await client.query(
      `UPDATE assessments SET 
         title = COALESCE($1, title), 
         category = COALESCE($2, category), 
         description = COALESCE($3, description), 
         difficulty = COALESCE($4, difficulty),
         duration_minutes = COALESCE($5, duration_minutes), 
         total_questions = COALESCE($6, total_questions), 
         passing_score = COALESCE($7, passing_score), 
         status = COALESCE($8, status), 
         set_count = COALESCE($9, set_count),
         updated_at = CURRENT_TIMESTAMP 
       WHERE id=$10 RETURNING *`,
      [
        title ?? null,
        category ?? null,
        description ?? null,
        difficulty ?? null,
        durationMinutes != null ? Number(durationMinutes) : null,
        finalTotalQuestions,
        passingScore != null ? Number(passingScore) : null,
        status ?? null,
        setCountParam,
        req.params.id
      ]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Assessment not found.' });
    }

    const updatedAsm = result.rows[0];

    // Update college links if provided
    if (Array.isArray(collegeIds)) {
      await client.query('DELETE FROM assessment_colleges WHERE assessment_id = $1', [req.params.id]);
      for (const cid of collegeIds) {
        await client.query(
          `INSERT INTO assessment_colleges (id, assessment_id, college_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (assessment_id, college_id) DO NOTHING`,
          [`ac-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`, req.params.id, cid]
        );
      }
    }

    const effectiveSetCount = clampSetCount(setCountParam ?? updatedAsm.set_count);
    // If selectedQuestionIds are provided in the update, sync them. Otherwise a
    // set-count change alone still reconciles B/C from the existing set A.
    if (selectedQuestionIds !== undefined) {
      await syncAssessmentQuestions(
        client,
        req.params.id,
        selectedQuestionIds,
        updatedAsm.category,
        Number(updatedAsm.total_questions) || 10,
        effectiveSetCount
      );
    } else if (setCountParam != null) {
      await ensureAssessmentSets(client, req.params.id, effectiveSetCount);
    }

    await client.query('COMMIT');
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    serverError(res, err, 'assessments.controller');
  } finally {
    client.release();
  }
};

// DELETE /api/assessments/:id
export const deleteAssessment = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    clearAssessmentsCache();

    // Explicitly delete linked questions from assessment_questions table
    await client.query('DELETE FROM assessment_questions WHERE assessment_id=$1', [req.params.id]);

    // Delete the assessment itself
    const delRes = await client.query('DELETE FROM assessments WHERE id=$1 RETURNING id', [req.params.id]);
    
    await client.query('COMMIT');
    res.json({ success: true, message: 'Assessment and all associated questions deleted.', data: delRes.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    serverError(res, err, 'assessments.controller');
  } finally {
    client.release();
  }
};

// GET /api/assessments/:id/questions
export const getAssessmentQuestions = async (req, res) => {
  try {
    const isAdmin = req.user?.role === 'admin';
    const candidateId = req.user?.id;
    const candidateEmail = req.user?.email;

    const allowRetake = (req.query?.retake === 'true' && isAdmin) || 
                        (req.headers?.['x-allow-retake'] === 'true' && isAdmin) || 
                        (process.env.ALLOW_ASSESSMENT_RETAKE === 'true' && isAdmin) || 
                        isAdmin;

    if (req.user?.role === 'candidate') {
      const allowed = await candidateCanAccessAssessment(req.params.id, req.user);
      if (!allowed) {
        return res.status(404).json({ success: false, error: 'Assessment not available.' });
      }
    }

    // Hidden (Archived) assessments are not available to candidates. Admins
    // always can; a candidate already mid-attempt may continue (resume) so
    // hiding an assessment never interrupts a live exam.
    if (!isAdmin && pool && getDbStatus()) {
      const statusRes = await pool.query('SELECT status FROM assessments WHERE id = $1', [req.params.id]);
      if (statusRes.rows.length > 0 && String(statusRes.rows[0].status || '').toLowerCase() === 'archived') {
        const live = await pool.query(
          `SELECT 1 FROM test_attempts WHERE candidate_id = $1 AND assessment_id = $2 AND status = 'InProgress' LIMIT 1`,
          [candidateId, req.params.id]
        );
        if (live.rows.length === 0) {
          return res.status(404).json({ success: false, error: 'Assessment not available.' });
        }
      }
    }

    // Single Attempt Policy: If already completed and retakes are not allowed, block attempt
    if (!allowRetake && (candidateId || candidateEmail)) {
      if (!pool || !getDbStatus()) {
        const pastSub = getMySubmissionsFallback(candidateId, candidateEmail).find(
          s => String(s.assessment_id || s.assessmentId || '').toLowerCase() === String(req.params.id).toLowerCase()
        );
        if (pastSub) {
          return res.status(403).json({
            success: false,
            alreadyCompleted: true,
            submission: pastSub,
            error: 'Single-Attempt Policy Active: You have already completed this assessment. Retakes are not allowed.'
          });
        }
      } else {
        const existingCheck = await pool.query(
          `SELECT id, score, accuracy FROM assessment_submissions 
           WHERE (candidate_id = $1 OR (candidate_email IS NOT NULL AND LOWER(candidate_email) = LOWER($2))) AND assessment_id = $3 
           LIMIT 1`,
          [candidateId, candidateEmail || '', req.params.id]
        );
        if (existingCheck.rows.length > 0) {
          return res.status(403).json({
            success: false,
            alreadyCompleted: true,
            submission: existingCheck.rows[0],
            error: 'Single-Attempt Policy Active: You have already completed this assessment. Retakes are not allowed.'
          });
        }
      }
    }

    if (!pool || !getDbStatus()) {
      const asm = fallbackAssessments.find(a => String(a.id).toLowerCase() === String(req.params.id).toLowerCase());
      const cat = asm?.category || 'Technical';
      const isAll = ['All', 'Full Length', 'All Mix'].some(m => m.toLowerCase() === cat.toLowerCase());
      const matchingQuestions = isAll
        ? fallbackQuestions
        : fallbackQuestions.filter(q => String(q.category).toLowerCase() === cat.toLowerCase());
      return res.json({ success: true, data: matchingQuestions, total: matchingQuestions.length });
    }

    // Determine which paper set this requester should see.
    // Admins see set A (all sets if ?set_code=B/C is passed). Candidates see
    // only the set assigned to their in-progress attempt; if they haven't
    // started yet, they see set A as a preview (single-set assessments show A).
    let requesterSetCode = 'A';
    if (req.query?.set_code) {
      requesterSetCode = normalizeSetCode(req.query.set_code);
    } else if (!isAdmin && (candidateId || candidateEmail) && pool && getDbStatus()) {
      try {
        const attemptRes = await pool.query(
          `SELECT ta.set_code, a.set_count
           FROM test_attempts ta
           JOIN assessments a ON a.id = ta.assessment_id
           WHERE ta.assessment_id = $1
             AND (ta.candidate_id = $2 OR (ta.candidate_id IS NOT NULL AND ta.candidate_id = $2))
             AND ta.status = 'InProgress'
           ORDER BY ta.created_at DESC LIMIT 1`,
          [req.params.id, candidateId]
        );
        if (attemptRes.rows.length > 0 && attemptRes.rows[0].set_code) {
          requesterSetCode = attemptRes.rows[0].set_code;
        }
      } catch { /* fall back to set A */ }
    }

    const result = await pool.query(
      `SELECT aq.id, aq.question_id, aq.section_id, aq.category, aq.topic, aq.question, aq.difficulty, aq.options,
              COALESCE(q.type, 'Single Choice') as type,
              aq.test_cases, aq.starter_templates, aq.constraints,
              ${isAdmin ? 'aq.correct_answer,' : ''}
              aq.marks, aq.created_at
       FROM assessment_questions aq
       JOIN questions q ON q.id = aq.question_id
       WHERE aq.assessment_id = $1 AND aq.set_code = $2
       ORDER BY aq.created_at ASC, aq.id ASC`,
      [req.params.id, requesterSetCode]
    );

    let questionsList = result.rows;
    if (questionsList.length === 0) {
      const asmCheck = await pool.query('SELECT category, total_questions FROM assessments WHERE id = $1', [req.params.id]);
      if (asmCheck.rows.length > 0) {
        const asmCat = asmCheck.rows[0].category || 'Technical';
        const asmCount = Number(asmCheck.rows[0].total_questions) || 10;
        const autoQRes = await pool.query(
          `SELECT q.id, q.id as question_id, q.category, q.topic, q.question, q.difficulty, q.options,
                  COALESCE(q.type, 'Single Choice') as type,
                  q.test_cases, q.starter_templates, q.constraints,
                  ${isAdmin ? 'q.correct_answer,' : ''}
                  q.marks, q.created_at
           FROM questions q
           WHERE q.category ILIKE $1 OR $1 = 'All'
           ORDER BY q.created_at DESC LIMIT $2`,
          [asmCat, asmCount]
        );
        questionsList = autoQRes.rows;
      }
    }
    res.json({ success: true, data: questionsList, total: questionsList.length });
  } catch (err) {
    if (!pool || !getDbStatus()) {
      const asm = fallbackAssessments.find(a => String(a.id).toLowerCase() === String(req.params.id).toLowerCase());
      const cat = asm?.category || 'Technical';
      const isAll = ['All', 'Full Length', 'All Mix'].some(m => m.toLowerCase() === cat.toLowerCase());
      const matchingQuestions = isAll
        ? fallbackQuestions
        : fallbackQuestions.filter(q => String(q.category).toLowerCase() === cat.toLowerCase());
      return res.json({ success: true, data: matchingQuestions, total: matchingQuestions.length });
    }
    serverError(res, err, 'assessments.controller');
  }
};

// POST /api/assessments/:id/questions
export const addQuestionsToAssessment = async (req, res) => {
  const assessmentId = req.params.id;
  const { questionIds, questions: inputQuestions } = req.body;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Verify assessment exists
    const asmCheck = await client.query('SELECT id FROM assessments WHERE id = $1', [assessmentId]);
    if (asmCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Assessment not found.' });
    }

    const insertedRows = [];

    // Case A: questionIds array provided
    if (Array.isArray(questionIds) && questionIds.length > 0) {
      const qRes = await client.query(
        `SELECT id, category, topic, question, difficulty, options, correct_answer, marks
         FROM questions
         WHERE id = ANY($1::varchar[])`,
        [questionIds]
      );

      for (const q of qRes.rows) {
        const aqId = `aq-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
        const insRes = await client.query(
          `INSERT INTO assessment_questions (id, assessment_id, question_id, set_code, category, topic, question, difficulty, options, correct_answer, marks)
           VALUES ($1, $2, $3, 'A', $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (assessment_id, set_code, question_id) DO UPDATE SET
             category = EXCLUDED.category,
             topic = EXCLUDED.topic,
             question = EXCLUDED.question,
             difficulty = EXCLUDED.difficulty,
             options = EXCLUDED.options,
             correct_answer = EXCLUDED.correct_answer,
             marks = EXCLUDED.marks
           RETURNING *`,
          [aqId, assessmentId, q.id, q.category, q.topic, q.question, q.difficulty, JSON.stringify(q.options), q.correct_answer, q.marks || 1]
        );
        insertedRows.push(insRes.rows[0]);
      }
    }

    // Case B: full questions objects provided
    if (Array.isArray(inputQuestions) && inputQuestions.length > 0) {
      for (const q of inputQuestions) {
        if (!q.id && !q.question_id) continue;
        const qId = q.question_id || q.id;
        const aqId = `aq-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
        const insRes = await client.query(
          `INSERT INTO assessment_questions (id, assessment_id, question_id, set_code, category, topic, question, difficulty, options, correct_answer, marks)
           VALUES ($1, $2, $3, 'A', $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (assessment_id, set_code, question_id) DO UPDATE SET
             category = EXCLUDED.category,
             topic = EXCLUDED.topic,
             question = EXCLUDED.question,
             difficulty = EXCLUDED.difficulty,
             options = EXCLUDED.options,
             correct_answer = EXCLUDED.correct_answer,
             marks = EXCLUDED.marks
           RETURNING *`,
          [aqId, assessmentId, qId, q.category, q.topic, q.question, q.difficulty, JSON.stringify(q.options), q.correct_answer || q.correctAnswer, q.marks || 1]
        );
        insertedRows.push(insRes.rows[0]);
      }
    }

    await client.query('COMMIT');
    clearAssessmentsCache();
    res.status(201).json({ success: true, message: `Linked ${insertedRows.length} questions to assessment.`, data: insertedRows });
  } catch (err) {
    await client.query('ROLLBACK');
    serverError(res, err, 'assessments.controller');
  } finally {
    client.release();
  }
};

// DELETE /api/assessments/:id/questions/:questionId
export const removeQuestionFromAssessment = async (req, res) => {
  const { id: assessmentId, questionId } = req.params;
  try {
    await pool.query(
      'DELETE FROM assessment_questions WHERE assessment_id = $1 AND (question_id = $2 OR id = $2)',
      [assessmentId, questionId]
    );
    clearAssessmentsCache();
    res.json({ success: true, message: 'Question removed from assessment.' });
  } catch (err) {
    serverError(res, err, 'assessments.controller');
  }
};

