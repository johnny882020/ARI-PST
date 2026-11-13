// Import row validation (plan/03-data-integration/05-ingestion.md). Pure. Issues carry field + rule only, never cell values.
import { scanValue } from './identifier-guard.js';
import {
  AGE_BANDS, ATTACHED_DATA, AVAILABILITY, CONSENT_STATUSES, COLLECTION_MONTH_RE, ETHICS_REF_RE, QUANTITY_CLASSES,
  SAMPLE_TYPES, SEXES, TIMEPOINTS, type SampleInput,
} from './sample.js';
import type { ImportIssue, ImportRowRecord } from './ports.js';

export const IMPORT_COLUMNS = [
  'sample_code', 'source_center_code', 'diagnosis_source_value', 'age_band_at_diagnosis', 'sex', 'sample_type', 'availability',
  'quantity_class', 'clinical_timepoint', 'collection_month', 'attached_data', 'consent_status', 'ethics_approval_ref', 'verified',
] as const;
export const REQUIRED_COLUMNS = ['source_center_code', 'diagnosis_source_value', 'age_band_at_diagnosis', 'sex', 'sample_type', 'availability', 'clinical_timepoint', 'collection_month'] as const;
export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 20_000;
const SAMPLE_CODE_RE = /^smp_[0-9A-HJKMNP-TV-Z]{26}$/;

/** Header check. Any column outside the allow-list fails the whole file (UNKNOWN_COLUMN). Returns issues (field = column position, not the name). */
export function validateHeader(headers: string[]): ImportIssue[] {
  const issues: ImportIssue[] = [];
  const seen = new Set<string>();
  headers.forEach((h, i) => {
    const n = h.trim().toLowerCase();
    if (!(IMPORT_COLUMNS as readonly string[]).includes(n)) issues.push({ field: `column_${i + 1}`, rule: 'UNKNOWN_COLUMN', severity: 'error' });
    if (seen.has(n)) issues.push({ field: `column_${i + 1}`, rule: 'DUPLICATE_ROW', severity: 'error' });
    seen.add(n);
  });
  for (const r of REQUIRED_COLUMNS) if (!seen.has(r)) issues.push({ field: r, rule: 'REQUIRED', severity: 'error' });
  return issues;
}

export interface ImportLookups {
  centerByCode(code: string): { id: string } | null;
  mapDiagnosis(sourceValue: string): string | null;
  ethics(centerId: string, ref: string): { id: string; status: 'active' | 'expired' | 'revoked' } | null;
  existingSample(code: string): { centerId: string } | null;
  allowedCenterId: string | null;      // null = any center
  strict: boolean;
}
export interface ValidatedRow {
  row: ImportRowRecord;
  create?: SampleInput;
  update?: { code: string; patch: Partial<SampleInput> };
  verify: boolean;
  signature: string;
}
function oneOf(v: string, set: readonly string[]): boolean { return set.includes(v); }

export function validateImportRow(rowNo: number, raw: Record<string, string>, lk: ImportLookups): ValidatedRow {
  const issues: ImportIssue[] = [];
  const err = (field: string, rule: string) => issues.push({ field, rule, severity: 'error' });
  const warn = (field: string, rule: string) => issues.push({ field, rule: lk.strict ? rule : rule, severity: lk.strict ? 'error' : 'warning' });
  const get = (k: string) => (raw[k] ?? '').trim();

  // S2 identifier guards on every cell except sample_code (pattern checked below).
  for (const k of IMPORT_COLUMNS) {
    if (k === 'sample_code') continue;
    if (scanValue(get(k)) !== null) err(k, 'IDENTIFIER_SUSPECTED');
  }
  for (const k of REQUIRED_COLUMNS) if (get(k) === '') err(k, 'REQUIRED');

  const code = get('sample_code');
  if (code && !SAMPLE_CODE_RE.test(code)) err('sample_code', 'FORMAT');
  const ageBand = get('age_band_at_diagnosis'); if (ageBand && !oneOf(ageBand, AGE_BANDS)) err('age_band_at_diagnosis', 'VOCAB');
  const sex = get('sex'); if (sex && !oneOf(sex, SEXES)) err('sex', 'VOCAB');
  const st = get('sample_type'); if (st && !oneOf(st, SAMPLE_TYPES)) err('sample_type', 'VOCAB');
  const av = get('availability'); if (av && !oneOf(av, AVAILABILITY)) err('availability', 'VOCAB');
  const qc = get('quantity_class'); if (qc && !oneOf(qc, QUANTITY_CLASSES)) err('quantity_class', 'VOCAB');
  const tp = get('clinical_timepoint'); if (tp && !oneOf(tp, TIMEPOINTS)) err('clinical_timepoint', 'VOCAB');
  const cm = get('collection_month'); if (cm && !COLLECTION_MONTH_RE.test(cm)) err('collection_month', 'FORMAT');
  const cs = get('consent_status') || 'unknown'; if (!oneOf(cs, CONSENT_STATUSES)) err('consent_status', 'VOCAB');
  const adRaw = get('attached_data');
  const ad = adRaw ? adRaw.split(';').map((s) => s.trim()).filter(Boolean) : [];
  if (ad.some((a) => !oneOf(a, ATTACHED_DATA)) || new Set(ad).size !== ad.length) err('attached_data', 'VOCAB');
  const verifiedRaw = get('verified').toLowerCase();
  if (verifiedRaw && !['true', 'false', '1', '0', 'yes', 'no'].includes(verifiedRaw)) err('verified', 'FORMAT');
  const verify = ['true', '1', 'yes'].includes(verifiedRaw);

  const center = get('source_center_code') ? lk.centerByCode(get('source_center_code')) : null;
  if (get('source_center_code') && !center) err('source_center_code', 'VOCAB');
  if (center && lk.allowedCenterId && center.id !== lk.allowedCenterId) err('source_center_code', 'CENTER_MISMATCH');
  const dx = get('diagnosis_source_value') ? lk.mapDiagnosis(get('diagnosis_source_value')) : null;
  if (get('diagnosis_source_value') && !dx) err('diagnosis_source_value', 'VOCAB');

  let ethicsId: string | null = null;
  const er = get('ethics_approval_ref');
  if (er) {
    if (!ETHICS_REF_RE.test(er)) err('ethics_approval_ref', 'FORMAT');
    else if (center) {
      const e = lk.ethics(center.id, er);
      if (!e) warn('ethics_approval_ref', 'ETHICS_MISSING');
      else { ethicsId = e.id; if (e.status !== 'active') warn('ethics_approval_ref', 'ETHICS_EXPIRED'); }
    }
  } else warn('ethics_approval_ref', 'ETHICS_MISSING');

  let action: ImportRowRecord['action'] = 'create';
  const existing = code && SAMPLE_CODE_RE.test(code) ? lk.existingSample(code) : null;
  if (code && SAMPLE_CODE_RE.test(code)) {
    if (!existing) err('sample_code', 'NOT_FOUND');
    else if (center && existing.centerId !== center.id) err('source_center_code', 'CENTER_MISMATCH');
    else action = 'update';
  }
  const hasError = issues.some((i) => i.severity === 'error');
  const sig = [code, get('source_center_code'), dx ?? '', ageBand, sex, st, av, qc, tp, cm, ad.slice().sort().join(';'), cs, er, verify].join('|');
  const row: ImportRowRecord = {
    rowNo, outcome: hasError ? 'rejected' : issues.length ? 'warning' : 'accepted',
    action: hasError ? 'none' : action, sampleCode: action === 'update' && existing ? code : null, issues,
  };
  const out: ValidatedRow = { row, verify, signature: sig };
  if (!hasError && center && dx) {
    const base = {
      diagnosisCode: dx, ageBandAtDiagnosis: ageBand, sex, sampleType: st, availability: av, clinicalTimepoint: tp,
      collectionMonth: cm, attachedData: ad, consentStatus: cs, ethicsApprovalId: ethicsId, ...(qc ? { quantityClass: qc } : {}),
    } as unknown as Omit<SampleInput, 'sourceCenterId'>;
    if (action === 'create') out.create = { ...base, sourceCenterId: center.id } as SampleInput;
    else out.update = { code, patch: base };
  }
  return out;
}
/** File-level duplicate detection: more than 3 identical rows gets a warning; conflicting updates to one code are rejected. */
export function crossRowChecks(rows: ValidatedRow[]): void {
  const bySig = new Map<string, ValidatedRow[]>();
  const byCode = new Map<string, ValidatedRow[]>();
  for (const r of rows) {
    if (r.row.outcome === 'rejected') continue;
    (bySig.get(r.signature) ?? bySig.set(r.signature, []).get(r.signature)!).push(r);
    if (r.update) (byCode.get(r.update.code) ?? byCode.set(r.update.code, []).get(r.update.code)!).push(r);
  }
  for (const group of bySig.values()) {
    if (group.length > 3) for (const g of group) { g.row.issues.push({ field: 'row', rule: 'DUPLICATE_ROW', severity: 'warning' }); if (g.row.outcome === 'accepted') g.row.outcome = 'warning'; }
  }
  for (const group of byCode.values()) {
    if (group.length > 1 && new Set(group.map((g) => g.signature)).size > 1) {
      for (const g of group) { g.row.issues.push({ field: 'sample_code', rule: 'DUPLICATE_ROW', severity: 'error' }); g.row.outcome = 'rejected'; g.row.action = 'none'; delete g.update; }
    }
  }
}
/** Rejection report CSV. Columns: row_no, outcome, field, rule, severity. No cell values. */
export function rejectionReportCsv(rows: ImportRowRecord[]): string {
  const lines = ['row_no,outcome,field,rule,severity'];
  for (const r of rows) {
    if (r.outcome === 'accepted') continue;
    for (const i of r.issues) lines.push([r.rowNo, r.outcome, i.field, i.rule, i.severity].join(','));
  }
  return lines.join('\n') + '\n';
}
export function resultMapCsv(rows: Array<{ rowNo: number; sampleCode: string }>): string {
  return ['row_no,sample_code', ...rows.map((r) => `${r.rowNo},${r.sampleCode}`)].join('\n') + '\n';
}
