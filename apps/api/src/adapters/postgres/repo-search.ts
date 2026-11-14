import type { Ctx, SearchRepo, Filters } from '@ari/domain';
import type { Q } from './db-types.js';

// Budget accounting goes through ops.log_query / ops.budget_spent (no table grant for the runtime, B1 0010).

export function makeSearchRepo(q: Q, ctx: Ctx): SearchRepo {
  void ctx;
  return {
    async total(f: Filters) {
      const r = await q.query('SELECT n, band, masked FROM agg.total_count($1::jsonb)', [JSON.stringify(f)]);
      const x = r.rows[0];     // no k here (R-12): the threshold never travels with a count
      return x.masked ? { count: null, suppressed: true } : { count: x.n ?? null, suppressed: false, band: x.band ?? null };
    },
    async facet(f, facet) {
      const r = await q.query('SELECT bucket, bucket_level, n, band, masked FROM agg.facet_counts($1::jsonb, $2)', [JSON.stringify(f), facet]);
      return r.rows.map((x) => ({ bucket: x.bucket, level: x.bucket_level, count: x.masked ? null : (x.n ?? null), suppressed: Boolean(x.masked), ...(x.band ? { band: x.band } : {}) }));
    },
    async refreshSnapshot() { await q.query('SELECT agg.refresh_snapshot()'); },
    async k() { try { const r = await q.query(`SELECT k FROM portal.k_policies WHERE field_set = 'default'`); return r.rows[0]?.k ?? 5; } catch { return 5; } },
    async expand(text, limit) {
      const r = await q.query('SELECT diagnosis_code, score, matched_via FROM search.expand_query($1, $2)', [text, limit]);
      return r.rows.map((x) => ({ diagnosisCode: x.diagnosis_code, score: Number(x.score), matchedVia: x.matched_via }));
    },
    async diagnoses() {
      const r = await q.query('SELECT diagnosis_code, parent_code, level, icdo3_morph, label_he, label_en FROM portal.diagnosis_terms WHERE valid_to IS NULL OR valid_to > current_date ORDER BY level, diagnosis_code');
      return r.rows.map((x) => ({ diagnosisCode: x.diagnosis_code, parentCode: x.parent_code ?? null, level: x.level, icdo3Morph: x.icdo3_morph ?? null, labelHe: x.label_he, labelEn: x.label_en }));
    },
    async epoch() { return Number((await q.query('SELECT agg.current_epoch() AS e')).rows[0]?.e ?? 0); },
    async spent(inst) {
      const r = (await q.query('SELECT day_cost, d30_cost, inst_30d_cost FROM ops.budget_spent($1)', [inst])).rows[0];
      return { spentDay: r?.day_cost ?? 0, spent30d: r?.d30_cost ?? 0, spentInstitution30d: r?.inst_30d_cost ?? 0 };
    },
    async recordQuery(inst, key, cost) { await q.query('SELECT ops.log_query($1,$2,$3)', [key, inst, Math.max(0, Math.min(100, cost))]); },
  };
}
