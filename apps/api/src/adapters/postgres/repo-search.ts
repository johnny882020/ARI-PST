import type { Ctx, SearchRepo, Filters } from '@ari/domain';
import { isUndefinedObject } from './errors.js';
import type { Q } from './db-types.js';

// Fallback budget log when ops.query_log is missing (single process only).
const mem: Array<{ userId: string; inst: string | null; key: string; cost: number; at: number }> = [];

export function makeSearchRepo(q: Q, ctx: Ctx): SearchRepo {
  void ctx;
  return {
    async total(f: Filters) {
      const r = await q.query('SELECT n, band, masked FROM agg.total_count($1::jsonb)', [JSON.stringify(f)]);
      const x = r.rows[0]; const k = 5;
      return x.masked ? { count: null, suppressed: true, k } : { count: x.n ?? null, suppressed: false, k, band: x.band ?? null };
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
    async spent(userId, inst, now) {
      try {
        await q.query('SAVEPOINT qb');
        const r = await q.query(`SELECT coalesce(sum(cost) FILTER (WHERE user_id = $1 AND at > $3::timestamptz - interval '24 hours'),0)::int AS d,
              coalesce(sum(cost) FILTER (WHERE user_id = $1 AND at > $3::timestamptz - interval '30 days'),0)::int AS m,
              coalesce(sum(cost) FILTER (WHERE institution IS NOT NULL AND institution = $2 AND at > $3::timestamptz - interval '30 days'),0)::int AS i
            FROM ops.query_log WHERE at > $3::timestamptz - interval '30 days'`, [userId, inst, now.toISOString()]);
        await q.query('RELEASE SAVEPOINT qb');
        return { spentDay: r.rows[0].d, spent30d: r.rows[0].m, spentInstitution30d: r.rows[0].i };
      } catch (e) {
        if (!isUndefinedObject(e)) throw e;
        await q.query('ROLLBACK TO SAVEPOINT qb');
        const t = now.getTime(); const mine = mem.filter((x) => x.userId === userId);
        return { spentDay: mine.filter((x) => t - x.at < 86_400_000).reduce((a, b) => a + b.cost, 0), spent30d: mine.reduce((a, b) => a + b.cost, 0), spentInstitution30d: mem.filter((x) => inst && x.inst === inst).reduce((a, b) => a + b.cost, 0) };
      }
    },
    async recordQuery(userId, inst, key, cost, now) {
      try {
        await q.query('SAVEPOINT qr');
        await q.query('INSERT INTO ops.query_log (user_id, institution, query_key, cost, at) VALUES ($1,$2,$3,$4,$5)', [userId, inst, key, cost, now.toISOString()]);
        await q.query('RELEASE SAVEPOINT qr');
      } catch (e) { if (!isUndefinedObject(e)) throw e; await q.query('ROLLBACK TO SAVEPOINT qr'); mem.push({ userId, inst, key, cost, at: now.getTime() }); }
    },
    async seenInEpoch(userId, key, since) {
      try {
        await q.query('SAVEPOINT qs');
        const r = await q.query('SELECT 1 FROM ops.query_log WHERE user_id = $1 AND query_key = $2 AND at >= $3 LIMIT 1', [userId, key, since.toISOString()]);
        await q.query('RELEASE SAVEPOINT qs');
        return r.rows.length > 0;
      } catch (e) { if (!isUndefinedObject(e)) throw e; await q.query('ROLLBACK TO SAVEPOINT qs'); return mem.some((x) => x.userId === userId && x.key === key && x.at >= since.getTime()); }
    },
  };
}
