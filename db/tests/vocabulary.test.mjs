// 0012: the definer role app_core can load the diagnosis vocabulary (review R-13, KNOWN-ISSUES L-1).
// Without this a real-data deployment (no synthetic seed) has an empty vocabulary: no sample can be created or imported,
// because every diagnosis code fails the vocabulary check. Runs as the real roles: app_migrator, then SET ROLE app_core.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { baseFixtures, closeAll, pool } from './helpers.mjs';

beforeAll(baseFixtures);
afterAll(closeAll);

describe('0012 vocabulary load as app_core', () => {
  it('app_core may execute search.norm(), which the vocabulary indexes call', async () => {
    const c = await pool('app_migrator').connect();
    try {
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE app_core');
      const r = await c.query(`SELECT has_function_privilege('search.norm(text)', 'EXECUTE') AS ok`);
      expect(r.rows[0].ok).toBe(true);
      // The same write path as scripts/render-predeploy.mjs (vocabulary step). Rolled back: no data stays.
      await c.query(`INSERT INTO portal.diagnosis_terms (diagnosis_code, parent_code, level, icdo3_morph, label_en, label_he, is_selectable)
        VALUES ('zz_vocab_probe', NULL, 'group', NULL, 'Synthetic probe term', 'מונח בדיקה סינתטי', true)`);
      await c.query(`INSERT INTO portal.diagnosis_synonyms (diagnosis_code, lang, term, kind) VALUES ('zz_vocab_probe','en','synthetic probe','abbreviation')`);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });
});
