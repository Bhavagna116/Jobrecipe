/**
 * Repair reasoning questions whose text was truncated at an embedded
 * double quote when the JSON question bank was generated.
 *
 * Affected rows lost everything after the opening quote, e.g.:
 *   rea-0009: 'If '  ->  'If "LIGHT" is coded as "MJHIU", ...'
 *
 * The same text is stored twice: in `questions` (the bank) and in
 * `assessment_questions` (the per-assessment snapshot candidates see), so both
 * are updated. Idempotent: re-running only rewrites the same text.
 *
 * Usage: node scripts/fix_truncated_reasoning_questions.js
 */
import { pool } from '../src/db/pool.js';

const FIXES = {
  'rea-0003':
    'In a certain cipher code, "CAT" is coded as 24 and "DOG" is coded as 26. What is the code for "PIG"? (P=16, I=9, G=7)',
  'rea-0005':
    'Statement: "Adopting agile pair programming reduces software bugs by 40%." Which assumption is implicit?',
  'rea-0007':
    'Pointing to a photograph, Rohit says: "She is the daughter of my grandfather\'s only son." How is Rohit related to the girl?',
  'rea-0009':
    'If "LIGHT" is coded as "MJHIU", how is "FLAME" coded in that language?'
};

const run = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [id, question] of Object.entries(FIXES)) {
      const bank = await client.query(
        `UPDATE questions
            SET question = $2, updated_at = CURRENT_TIMESTAMP
          WHERE id = $1`,
        [id, question]
      );
      const snapshots = await client.query(
        `UPDATE assessment_questions SET question = $2 WHERE question_id = $1`,
        [id, question]
      );
      console.log(`${id}: questions=${bank.rowCount}, assessment snapshots=${snapshots.rowCount}`);
    }
    await client.query('COMMIT');
    console.log('Done.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
};

run().catch((err) => {
  console.error('Repair failed:', err.message);
  process.exit(1);
});
