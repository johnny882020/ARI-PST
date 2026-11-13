import type { Ctx, SampleRecord, SampleRepo, SampleInput, SamplePatch } from '@ari/domain';
import { iso, type Q } from './db.js';
import { etagOf } from '../../lib/util.js';

const COLS = `s.id, s.source_center_id, s.diagnosis_code, s.age_band_at_diagnosis::text AS age_band, s.sex::text AS sex, s.sample_type::text AS sample_type,
  s.availability::text AS availability, s.quantity_class::text AS quantity_class, s.clinical_timepoint::text AS timepoint, s.collection_month,
  s.attached_data::text[] AS attached_data, s.consent_status::text AS consent_status, e.approval_ref AS ethics_ref, s.contact_ref,
  s.created_at, s.updated_at, s.last_verified_at, st.staleness`;
const FROM = `FROM portal.samples s LEFT JOIN portal.ethics_approvals e ON e.id = s.ethics_approval_id LEFT JOIN portal.v_sample_staleness st ON st.sample_id = s.id`;
const rec = (r: any): SampleRecord => ({
  sampleCode: r.id, sourceCenterId: r.source_center_id, diagnosisCode: r.diagnosis_code, ageBandAtDiagnosis: r.age_band, sex: r.sex, sampleType: r.sample_type,
  availability: r.availability, quantityClass: r.quantity_class ?? null, clinicalTimepoint: r.timepoint, collectionMonth: r.collection_month,
  attachedData: (r.attached_data ?? []) as SampleRecord['attachedData'], consentStatus: r.consent_status, ethicsApprovalRef: r.ethics_ref ?? null, contactRef: r.contact_ref,
  staleness: (r.staleness ?? 'fresh') as SampleRecord['staleness'], createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at)!, lastVerifiedAt: iso(r.last_verified_at)!,
});
const COLMAP: Record<string, string> = {
  diagnosisCode: 'diagnosis_code', ageBandAtDiagnosis: 'age_band_at_diagnosis', sex: 'sex', sampleType: 'sample_type', availability: 'availability',
  quantityClass: 'quantity_class', clinicalTimepoint: 'clinical_timepoint', collectionMonth: 'collection_month', consentStatus: 'consent_status', ethicsApprovalId: 'ethics_approval_id',
};
const ENUMCAST: Record<string, string> = { age_band_at_diagnosis: 'portal.age_band', sex: 'portal.sex', sample_type: 'portal.sample_type', availability: 'portal.availability', quantity_class: 'portal.quantity_class', clinical_timepoint: 'portal.clinical_timepoint', consent_status: 'portal.consent_status' };

export function makeSampleRepo(q: Q, _ctx: Ctx): SampleRepo {
  const get = async (id: string) => { const r = await q.query(`SELECT ${COLS} ${FROM} WHERE s.id = $1 AND s.deleted_at IS NULL`, [id]); return r.rows[0] ? rec(r.rows[0]) : null; };
  const setAttached = async (id: string, list: string[]) => {
    await q.query('DELETE FROM portal.sample_attached_data WHERE sample_id = $1 AND NOT (data_type::text = ANY($2::text[]))', [id, list]);
    for (const t of list) await q.query('INSERT INTO portal.sample_attached_data (sample_id, data_type) VALUES ($1,$2::portal.attached_data_type) ON CONFLICT (sample_id, data_type) DO UPDATE SET is_available = true', [id, t]);
  };
  return {
    async insert(id, i: SampleInput, createdBy, source = 'portal_entry') {
      const c = await q.query('SELECT contact_role FROM portal.centers WHERE id = $1', [i.sourceCenterId]);
      await q.query(`INSERT INTO portal.samples (id, source_center_id, diagnosis_code, age_band_at_diagnosis, sex, sample_type, availability, quantity_class, clinical_timepoint,
          collection_month, consent_status, ethics_approval_id, contact_ref, source_system, created_by)
        VALUES ($1,$2,$3,$4::portal.age_band,$5::portal.sex,$6::portal.sample_type,$7::portal.availability,$8::portal.quantity_class,$9::portal.clinical_timepoint,$10,$11::portal.consent_status,$12,$13,$14,$15)`,
        [id, i.sourceCenterId, i.diagnosisCode, i.ageBandAtDiagnosis, i.sex, i.sampleType, i.availability, i.quantityClass ?? null, i.clinicalTimepoint, i.collectionMonth,
         i.consentStatus ?? 'unknown', i.ethicsApprovalId ?? null, c.rows[0]?.contact_role ?? 'Center research coordinator', source, createdBy]);
      if (i.attachedData?.length) await setAttached(id, i.attachedData);
      return (await get(id))!;
    },
    async get(id) { const s = await get(id); return s ? { sample: s, etag: etagOf(s.updatedAt) } : null; },
    async update(id, patch: SamplePatch, ifMatch) {
      const cur = await get(id); if (!cur) return null;
      if (ifMatch && ifMatch !== etagOf(cur.updatedAt)) return 'etag_mismatch';
      const sets: string[] = []; const params: unknown[] = [id];
      for (const [k, v] of Object.entries(patch)) {
        const col = COLMAP[k]; if (!col || v === undefined) continue;
        params.push(v); sets.push(`${col} = $${params.length}${ENUMCAST[col] ? '::' + ENUMCAST[col] : ''}`);
      }
      if (sets.length) {
        const r = await q.query(`UPDATE portal.samples SET ${sets.join(', ')} WHERE id = $1 AND deleted_at IS NULL`, params);
        if (!r.rowCount) return null;
      }
      if (patch.attachedData) await setAttached(id, patch.attachedData);
      const s = (await get(id))!; return { sample: s, etag: etagOf(s.updatedAt) };
    },
    async list(p) {
      const params: unknown[] = []; const w: string[] = ['s.deleted_at IS NULL'];
      const add = (cond: string, v: unknown) => { params.push(v); w.push(cond.replace('?', `$${params.length}`)); };
      if (p.centerId) add('s.source_center_id = ?', p.centerId);
      if (p.diagnosisCode) add('s.diagnosis_code = ?', p.diagnosisCode);
      if (p.sampleType) add('s.sample_type = ?::portal.sample_type', p.sampleType);
      if (p.availability) add('s.availability = ?::portal.availability', p.availability);
      if (p.staleness) add('st.staleness = ?', p.staleness);
      if (p.cursor) { try { const c = JSON.parse(Buffer.from(p.cursor, 'base64url').toString()); params.push(c.c, c.i); w.push(`(s.created_at, s.id) < ($${params.length - 1}::timestamptz, $${params.length})`); } catch { /* bad cursor ignored */ } }
      params.push(p.limit + 1);
      const r = await q.query(`SELECT ${COLS} ${FROM} WHERE ${w.join(' AND ')} ORDER BY s.created_at DESC, s.id DESC LIMIT $${params.length}`, params);
      const rows = r.rows.slice(0, p.limit); const last = rows[rows.length - 1];
      return { items: rows.map(rec), nextCursor: r.rows.length > p.limit && last ? Buffer.from(JSON.stringify({ c: iso(last.created_at), i: last.id })).toString('base64url') : null };
    },
    async verify(id) {
      await q.query('SELECT portal.sample_verify($1)', [id]);
      return get(id);
    },
    async flag() { return true; },     // no table: the flag is an audit event plus a notification (see service)
    async retire(id) {
      const r = await q.query(`UPDATE portal.samples SET deleted_at = now(), availability = 'depleted' WHERE id = $1 AND deleted_at IS NULL`, [id]);
      return (r.rowCount ?? 0) > 0;
    },
    async diagnosisExists(code) { return (await q.query('SELECT 1 FROM portal.diagnosis_terms WHERE diagnosis_code = $1 AND is_selectable', [code])).rows.length > 0; },
    async mapDiagnosis(v) {
      const exact = await q.query('SELECT diagnosis_code FROM portal.diagnosis_terms WHERE is_selectable AND (diagnosis_code = $1 OR lower(label_en) = lower($1) OR label_he = $1) LIMIT 1', [v]);
      if (exact.rows[0]) return exact.rows[0].diagnosis_code;
      const e = await q.query(`SELECT diagnosis_code FROM search.expand_query($1, 1) WHERE matched_via = 'exact' LIMIT 1`, [v]);
      return e.rows[0]?.diagnosis_code ?? null;
    },
  };
}
