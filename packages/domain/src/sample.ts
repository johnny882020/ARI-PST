// Sample record v1 (contract pack section 4). Pure validation. No patient identifiers exist in this model.
import { scanValue } from './identifier-guard.js';
import type { FieldIssue } from './errors.js';

export const SAMPLE_TYPES = ['ffpe', 'frozen', 'csf', 'plasma_or_liquid_biopsy', 'isolated_dna_rna'] as const;
export const AVAILABILITY = ['available', 'limited', 'depleted'] as const;
export const QUANTITY_CLASSES = ['small', 'medium', 'large'] as const;
export const TIMEPOINTS = ['diagnosis', 'during_treatment', 'relapse'] as const;
export const AGE_BANDS = ['0_lt1', '1_lt3', '3_lt6', '6_lt10', '10_lt15', '15_lt18'] as const;
export const SEXES = ['female', 'male', 'other_or_unknown'] as const;
export const CONSENT_STATUSES = ['consent_obtained', 'broad_consent', 'waiver_by_committee', 'restricted', 'unknown'] as const;
export const ATTACHED_DATA = ['wes', 'wgs', 'rna_seq', 'mri', 'digital_pathology', 'redcap_clinical'] as const;
export type SampleType = (typeof SAMPLE_TYPES)[number];
export type Availability = (typeof AVAILABILITY)[number];
export type QuantityClass = (typeof QUANTITY_CLASSES)[number];
export type Timepoint = (typeof TIMEPOINTS)[number];
export type AgeBand = (typeof AGE_BANDS)[number];
export type Sex = (typeof SEXES)[number];
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];
export type AttachedData = (typeof ATTACHED_DATA)[number];

export const COLLECTION_MONTH_RE = /^(19[89][0-9]|20[0-9]{2})-(0[1-9]|1[0-2])$/;
export const ETHICS_REF_RE = /^[A-Za-z0-9._/-]{3,64}$/;
export const DIAGNOSIS_CODE_RE = /^[a-z][a-z0-9_]{2,63}$/;

export interface SampleInput {
  sourceCenterId: string; diagnosisCode: string; ageBandAtDiagnosis: AgeBand; sex: Sex; sampleType: SampleType;
  availability: Availability; quantityClass?: QuantityClass | null; clinicalTimepoint: Timepoint; collectionMonth: string;
  attachedData?: AttachedData[]; consentStatus?: ConsentStatus; ethicsApprovalId?: string | null;
}
export type SamplePatch = Partial<Omit<SampleInput, 'sourceCenterId'>>;
export const SAMPLE_CREATE_KEYS = ['sourceCenterId', 'diagnosisCode', 'ageBandAtDiagnosis', 'sex', 'sampleType', 'availability',
  'quantityClass', 'clinicalTimepoint', 'collectionMonth', 'attachedData', 'consentStatus', 'ethicsApprovalId'] as const;

const ENUMS: Record<string, readonly string[]> = {
  ageBandAtDiagnosis: AGE_BANDS, sex: SEXES, sampleType: SAMPLE_TYPES, availability: AVAILABILITY,
  quantityClass: QUANTITY_CLASSES, clinicalTimepoint: TIMEPOINTS, consentStatus: CONSENT_STATUSES,
};
const REQUIRED = ['sourceCenterId', 'diagnosisCode', 'ageBandAtDiagnosis', 'sex', 'sampleType', 'availability', 'clinicalTimepoint', 'collectionMonth'];

/** Validate a create body or a patch (patch = partial). Returns field issues. Rules: REQUIRED VOCAB FORMAT IDENTIFIER_SUSPECTED UNKNOWN_FIELD. */
export function validateSample(input: Record<string, unknown>, mode: 'create' | 'patch'): FieldIssue[] {
  const issues: FieldIssue[] = [];
  const allowed = new Set<string>(mode === 'create' ? SAMPLE_CREATE_KEYS : SAMPLE_CREATE_KEYS.filter((k) => k !== 'sourceCenterId'));
  for (const k of Object.keys(input)) if (!allowed.has(k)) issues.push({ field: k, rule: 'UNKNOWN_FIELD' });
  if (mode === 'create') for (const k of REQUIRED) if (input[k] === undefined || input[k] === null) issues.push({ field: k, rule: 'REQUIRED' });
  for (const [k, vals] of Object.entries(ENUMS)) {
    const v = input[k];
    if (v === undefined || (v === null && (k === 'quantityClass'))) continue;
    if (typeof v !== 'string' || !vals.includes(v)) issues.push({ field: k, rule: 'VOCAB' });
  }
  const cm = input.collectionMonth;
  if (cm !== undefined && (typeof cm !== 'string' || !COLLECTION_MONTH_RE.test(cm))) issues.push({ field: 'collectionMonth', rule: 'FORMAT' });
  const dc = input.diagnosisCode;
  if (dc !== undefined && (typeof dc !== 'string' || !DIAGNOSIS_CODE_RE.test(dc))) issues.push({ field: 'diagnosisCode', rule: 'FORMAT' });
  const ad = input.attachedData;
  if (ad !== undefined) {
    if (!Array.isArray(ad) || new Set(ad).size !== ad.length || ad.some((a) => !(ATTACHED_DATA as readonly string[]).includes(a as string))) {
      issues.push({ field: 'attachedData', rule: 'VOCAB' });
    }
  }
  const sc = input.sourceCenterId;
  if (sc !== undefined && (typeof sc !== 'string' || !/^ctr_[0-9A-HJKMNP-TV-Z]{26}$/.test(sc))) issues.push({ field: 'sourceCenterId', rule: 'FORMAT' });
  const ea = input.ethicsApprovalId;
  if (ea !== undefined && ea !== null && (typeof ea !== 'string' || !/^eth_[0-9A-HJKMNP-TV-Z]{26}$/.test(ea))) issues.push({ field: 'ethicsApprovalId', rule: 'FORMAT' });
  // Identifier guard on every string value (IDs are exempt from G5 by pattern above).
  for (const [k, v] of Object.entries(input)) {
    if (k === 'sourceCenterId' || k === 'ethicsApprovalId') continue;
    const vals = Array.isArray(v) ? v : [v];
    if (vals.some((x) => typeof x === 'string' && scanValue(x) !== null) && !issues.some((i) => i.field === k && i.rule === 'IDENTIFIER_SUSPECTED')) {
      issues.push({ field: k, rule: 'IDENTIFIER_SUSPECTED' });
    }
  }
  return issues;
}
export function validateEthicsRef(ref: unknown): boolean { return typeof ref === 'string' && ETHICS_REF_RE.test(ref) && scanValue(ref, { maxLength: 64 }) === null; }
