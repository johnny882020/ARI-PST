import type { SyntheticDataset } from './types.ts';
import { SEXES, AVAILABILITIES, TIMEPOINTS, AGE_BANDS } from './types.ts';

const q = (v: string | null | undefined): string => (v == null ? 'NULL' : `'${v.replace(/'/g, "''")}'`);
const chunk = <T>(a: T[], n: number): T[][] => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

/** SQL statements in FK order. Run as an admin that bypasses RLS (seed/restore), never as the runtime role. */
export function toSqlStatements(ds: SyntheticDataset): string[] {
  const out: string[] = [];
  out.push(...chunk(ds.centers, 100).map((c) => `INSERT INTO portal.centers (id, code, name_en, name_he, contact_role, feeds_regularly) VALUES ${c.map((x) => `(${q(x.id)},${q(x.code)},${q(x.nameEn)},${q(x.nameHe)},${q(x.contactRole)},${x.feedsRegularly})`).join(',')} ON CONFLICT DO NOTHING`));
  out.push(`INSERT INTO portal.users (id, email, display_name, locale, status, email_verified_at) VALUES ${ds.users.map((u) => `(${q(u.id)},${q(u.email)},${q(u.displayName)},${q(u.locale)},'active',now())`).join(',')} ON CONFLICT DO NOTHING`);
  out.push(`INSERT INTO portal.ethics_approvals (id, center_id, approval_ref, status, valid_from, valid_to) VALUES ${ds.ethics.map((e) => `(${q(e.id)},${q(e.centerId)},${q(e.approvalRef)},${q(e.status)},${q(e.validFrom)},${q(e.validTo)})`).join(',')} ON CONFLICT DO NOTHING`);
  // role assignments are inserted with deterministic ids derived from the user id
  out.push(`INSERT INTO portal.role_assignments (id, user_id, role, center_id) VALUES ${ds.users.map((u) => `('rol_${u.id.slice(4)}',${q(u.id)},${q(u.role)},${q(u.centerId)})`).join(',')} ON CONFLICT DO NOTHING`);
  for (const part of chunk(ds.samples, 500)) {
    out.push(`INSERT INTO portal.samples (id, donor_ref, source_center_id, diagnosis_code, age_band_at_diagnosis, sex, sample_type, availability, quantity_class, clinical_timepoint, collection_month, consent_status, ethics_approval_id, contact_ref, last_verified_at, is_synthetic) VALUES ${part.map((s) => `(${q(s.id)},${q(s.donorRef)},${q(s.sourceCenterId)},${q(s.diagnosisCode)},${q(s.ageBand)},${q(s.sex)},${q(s.sampleType)},${q(s.availability)},${q(s.quantityClass)},${q(s.clinicalTimepoint)},${q(s.collectionMonth)},${q(s.consentStatus)},${q(s.ethicsApprovalId)},${q(s.contactRef)},${q(s.lastVerifiedAt)},true)`).join(',')} ON CONFLICT DO NOTHING`);
  }
  const flags = ds.samples.flatMap((s) => s.attachedData.map((t) => `(${q(s.id)},${q(t)},true)`));
  for (const part of chunk(flags, 1000)) out.push(`INSERT INTO portal.sample_attached_data (sample_id, data_type, is_available) VALUES ${part.join(',')} ON CONFLICT DO NOTHING`);
  return out;
}
export function toSql(ds: SyntheticDataset): string { return toSqlStatements(ds).join(';\n') + ';\n'; }

export function toNdjson(ds: SyntheticDataset): Record<string, string> {
  const nd = (rows: unknown[]): string => rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
  return { 'centers.ndjson': nd(ds.centers), 'users.ndjson': nd(ds.users), 'ethics.ndjson': nd(ds.ethics), 'samples.ndjson': nd(ds.samples), 'requests.ndjson': nd(ds.requestPlans) };
}

export type DirtyKind = 'unknown_column' | 'id_like' | 'email_like' | 'full_date' | 'bad_enum' | 'bad_month' | 'dup_rows' | 'bom_csv' | 'crlf_csv';
export interface ExpectedRow { rowNo: number; rule: string }
const HEADER = ['center_code', 'diagnosis_code', 'age_band_at_diagnosis', 'sex', 'sample_type', 'availability', 'clinical_timepoint', 'collection_month', 'consent_status'];
const goodRow = (i = 0): string[] => ['synth_a', 'dmg_h3k27', AGE_BANDS[i % 6]!, SEXES[i % 2]!, 'ffpe', AVAILABILITIES[0]!, TIMEPOINTS[0]!, '2024-05', 'broad_consent'];
/** Dirty CSV corpus. The "id-like" value is a fixed, obviously synthetic 9-digit string: 000000000. */
export function makeImportFile(kind: DirtyKind): { bytes: Uint8Array; format: 'csv'; expectedReport: ExpectedRow[] } {
  let header = [...HEADER]; let rows = [goodRow(0), goodRow(1), goodRow(2)]; let eol = '\n'; let bom = ''; const expected: ExpectedRow[] = [];
  switch (kind) {
    case 'unknown_column': header = [...header, 'patient_name']; rows = rows.map((r) => [...r, '']); expected.push({ rowNo: 0, rule: 'UNKNOWN_COLUMN' }); break;
    case 'id_like': rows[1]![8] = '000000000'; expected.push({ rowNo: 2, rule: 'IDENTIFIER_SUSPECTED' }); break;
    case 'email_like': rows[1]![8] = 'person@example.invalid'; expected.push({ rowNo: 2, rule: 'IDENTIFIER_SUSPECTED' }); break;
    case 'full_date': rows[1]![7] = '2024-05-17'; expected.push({ rowNo: 2, rule: 'IDENTIFIER_SUSPECTED' }); break;
    case 'bad_enum': rows[1]![3] = 'X'; expected.push({ rowNo: 2, rule: 'VOCAB' }); break;
    case 'bad_month': rows[1]![7] = '2024-13'; expected.push({ rowNo: 2, rule: 'FORMAT' }); break;
    case 'dup_rows': rows = Array.from({ length: 5 }, () => goodRow(0)); for (let i = 2; i <= 5; i++) expected.push({ rowNo: i, rule: 'DUPLICATE_ROW' }); break;
    case 'bom_csv': bom = '﻿'; break;
    case 'crlf_csv': eol = '\r\n'; break;
  }
  const text = bom + [header, ...rows].map((r) => r.join(',')).join(eol) + eol;
  return { bytes: new TextEncoder().encode(text), format: 'csv', expectedReport: expected };
}
