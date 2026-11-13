import { describe, expect, it } from 'vitest';
import {
  AUTHENTICATED_ROLES, OPERATION_ACCESS, QUERY_LIMITS, ROLES, TokenBucket, absoluteTimeoutMs, allowedOutcomes, canonicalizeFilters, checkTransition,
  classifyStaleness, crossRowChecks, evaluateBudget, evaluateSession, idleTimeoutMs, israeliIdChecksumOk, newId, queryCost, rejectionReportCsv, roleMayCall,
  scanObjectDeep, scanValue, stepForState, stepUpFresh, tally, validateHeader, validateImportRow, validateK, validateSample, violatesSeparationOfDuties,
  REQUEST_STATES, TRANSITIONS, canTransition, idPattern, displayLabel,
} from './index.js';

describe('identifier guards (REQ-042)', () => {
  it.each([['123456789', 'G1'], ['050-123-4567', 'G2'], ['a@b.co', 'G3'], ['12/03/2020', 'G4'], ['2020-03-12', 'G4'], ['1234567', 'G5'], ['x'.repeat(65), 'G6']])('%s -> %s', (v, g) => expect(scanValue(v)).toBe(g));
  it('lets safe values through', () => { for (const v of ['2024-05', 'mb_shh', 'HC-2024-0012', '3_lt6', 'ffpe']) expect(scanValue(v)).toBeNull(); });
  it('sees through unicode digits and zero-width characters', () => { expect(scanValue('١٢٣٤٥٦٧٨٩')).toBe('G1'); expect(scanValue('12​3456789')).toBe('G1'); });
  it('scans nested objects without echoing values', () => { const h = scanObjectDeep({ a: { b: ['ok', '050-123-4567'] } }); expect(h).toEqual([{ field: 'a.b[1]', guard: 'G2' }]); });
  it('checksum helper', () => { expect(israeliIdChecksumOk('000000018')).toBe(true); expect(israeliIdChecksumOk('123456789')).toBe(false); });
});
describe('sample validation', () => {
  const ok = { sourceCenterId: 'ctr_' + '0'.repeat(26), diagnosisCode: 'mb_shh', ageBandAtDiagnosis: '3_lt6', sex: 'male', sampleType: 'ffpe', availability: 'available', clinicalTimepoint: 'diagnosis', collectionMonth: '2024-05' };
  it('accepts a good record', () => expect(validateSample(ok, 'create')).toEqual([]));
  it('rejects exact dates, unknown fields, bad enums', () => {
    const r = validateSample({ ...ok, collectionMonth: '2024-05-17', sex: 'x', patientName: 'a' }, 'create').map((i) => `${i.field}:${i.rule}`);
    expect(r).toEqual(expect.arrayContaining(['collectionMonth:FORMAT', 'sex:VOCAB', 'patientName:UNKNOWN_FIELD']));
  });
});
describe('state machine and actors', () => {
  it('table covers every state and closed is terminal', () => { expect(Object.keys(TRANSITIONS).sort()).toEqual([...REQUEST_STATES].sort()); expect(TRANSITIONS.closed).toEqual([]); });
  it('applicant cannot approve or reopen; admin can do nothing; coordinator cannot mark delivered', () => {
    expect(checkTransition('committee_review', 'approved', 'researcher_il', true).ok).toBe(false);
    expect(checkTransition('closed', 'draft', 'researcher_il', true).ok).toBe(false);
    for (const to of REQUEST_STATES) for (const from of REQUEST_STATES) if (canTransition(from, to)) expect(checkTransition(from, to, 'system_admin', false).ok).toBe(false);
    expect(checkTransition('delivery', 'closed', 'national_coordinator', false, 'delivered').ok).toBe(false);
  });
  it('coordinator cannot pre-check own request', () => expect(checkTransition('submitted', 'precheck', 'national_coordinator', true, undefined, true).reason).toBe('self_precheck'));
  it('stepper has 8 steps mapped from 12 states', () => { expect(new Set(REQUEST_STATES.map(stepForState)).size).toBe(8); });
});
describe('N-of-M voting', () => {
  const cfg = { votesNeeded: 2, membersTotal: 3 };
  it('needs N matching votes', () => {
    expect(allowedOutcomes(tally([{ vote: 'approve' }]), cfg)).toEqual(['needs_info']);
    expect(allowedOutcomes(tally([{ vote: 'approve' }, { vote: 'approve' }]), cfg)).toContain('approved');
    expect(allowedOutcomes(tally([{ vote: 'approve' }, { vote: 'reject' }, { vote: 'abstain' }]), cfg)).not.toContain('approved');
  });
});
describe('roles, SoD, capabilities', () => {
  it('SoD', () => { expect(violatesSeparationOfDuties(['national_coordinator'], 'committee_member')).toBe(true); expect(violatesSeparationOfDuties(['system_admin'], 'center_clinician')).toBe(true); expect(violatesSeparationOfDuties(['researcher_il'], 'researcher_intl')).toBe(false); });
  it('external roles have no sample-row operation; admin has none of the data operations', () => {
    for (const op of ['listSamples', 'getSample', 'createSample', 'updateSample']) { expect(roleMayCall(op, 'researcher_il')).toBe(false); expect(roleMayCall(op, 'researcher_intl')).toBe(false); expect(roleMayCall(op, 'system_admin')).toBe(false); expect(roleMayCall(op, 'committee_member')).toBe(false); }
    for (const op of ['castVote', 'recordDecision', 'precheckRequest']) expect(roleMayCall(op, 'system_admin')).toBe(false);
    expect(roleMayCall('createRequest', 'researcher_intl')).toBe(false);          // C-decisions: intl is aggregate view only
    expect(roleMayCall('searchAggregate', 'anonymous')).toBe(false);
  });
  it('every operation has an access rule and authenticated list excludes anonymous', () => { expect(Object.keys(OPERATION_ACCESS).length).toBeGreaterThan(80); expect(AUTHENTICATED_ROLES).not.toContain('anonymous'); expect(ROLES).toHaveLength(7); });
});
describe('sessions (C-02)', () => {
  const t0 = 1_000_000_000_000;
  it('timeouts', () => {
    expect(idleTimeoutMs('researcher_il')).toBe(30 * 60_000); expect(idleTimeoutMs('national_coordinator')).toBe(15 * 60_000);
    expect(absoluteTimeoutMs('system_admin')).toBe(4 * 3_600_000); expect(absoluteTimeoutMs('researcher_il')).toBe(8 * 3_600_000);
    expect(evaluateSession({ createdAt: t0, lastSeenAt: t0, mfaAt: t0 }, ['center_clinician'], t0 + 16 * 60_000)).toBe('idle_expired');
    expect(evaluateSession({ createdAt: t0, lastSeenAt: t0 + 4 * 3_600_000 - 1000, mfaAt: t0 }, ['system_admin'], t0 + 4 * 3_600_000)).toBe('absolute_expired');
  });
  it('step-up age', () => { expect(stepUpFresh(t0, t0 + 299_000)).toBe(true); expect(stepUpFresh(t0, t0 + 301_000)).toBe(false); expect(stepUpFresh(null, t0)).toBe(false); });
});
describe('k and budget (privacy)', () => {
  it('k floor 5', () => { expect(validateK(4)).toBe(false); expect(validateK(5)).toBe(true); expect(displayLabel(3, 5, false)).toBe('too_few'); });
  it('canonical filters ignore order and duplicates; cost = 1 + predicates', () => {
    expect(canonicalizeFilters({ sex: ['male', 'female', 'male'] })).toEqual({ sex: ['female', 'male'] });
    expect(queryCost({ sex: ['male'], diagnosis: ['a'] })).toBe(3);
  });
  it('budget: the (c+1)th unit is denied, cache hit costs 0', () => {
    const l = QUERY_LIMITS; expect(evaluateBudget({ spentDay: l.dayCost - 2, spent30d: 0, spentInstitution30d: 0 }, 2, false).ok).toBe(true);
    expect(evaluateBudget({ spentDay: l.dayCost - 1, spent30d: 0, spentInstitution30d: 0 }, 2, false)).toEqual({ ok: false, reason: 'budget_day' });
    expect(evaluateBudget({ spentDay: l.dayCost, spent30d: l.cost30d, spentInstitution30d: 0 }, 5, true)).toEqual({ ok: true, cost: 0 });
  });
  it('token bucket', () => { const b = new TokenBucket(2, 1 / 1000, 0); expect(b.take(0).ok).toBe(true); expect(b.take(0).ok).toBe(true); expect(b.take(0).ok).toBe(false); expect(b.take(1000).ok).toBe(true); });
});
describe('import rules', () => {
  const lk = { centerByCode: (c: string) => (c === 'syn_a' ? { id: 'ctr_x' } : null), mapDiagnosis: (v: string) => (v === 'mb_shh' ? 'mb_shh' : null), ethics: () => null, existingSample: () => null, allowedCenterId: null, strict: false };
  const row = { source_center_code: 'syn_a', diagnosis_source_value: 'mb_shh', age_band_at_diagnosis: '3_lt6', sex: 'male', sample_type: 'ffpe', availability: 'available', clinical_timepoint: 'diagnosis', collection_month: '2024-05', ethics_approval_ref: 'HC-2024-1' };
  it('header allow-list', () => { expect(validateHeader(Object.keys(row))).toEqual([]); expect(validateHeader([...Object.keys(row), 'mrn']).map((i) => i.rule)).toContain('UNKNOWN_COLUMN'); });
  it('rejected rows carry field and rule only', () => {
    const r = validateImportRow(2, { ...row, sex: '123456789' }, { ...lk, ethics: () => ({ id: 'eth_x', status: 'active' as const }) });
    expect(r.row.outcome).toBe('rejected'); expect(JSON.stringify(r.row)).not.toContain('123456789');
    expect(rejectionReportCsv([r.row]).split('\n')[1]).toBe('2,rejected,sex,IDENTIFIER_SUSPECTED,error');
  });
  it('conflicting updates to one code are rejected', () => {
    const lk2 = { ...lk, existingSample: () => ({ centerId: 'ctr_x' }) };
    const code = 'smp_' + '1'.repeat(26);
    const a = validateImportRow(1, { ...row, sample_code: code }, lk2); const b = validateImportRow(2, { ...row, sample_code: code, sex: 'female' }, lk2);
    crossRowChecks([a, b]); expect([a.row.outcome, b.row.outcome]).toEqual(['rejected', 'rejected']);
  });
});
describe('misc', () => {
  it('ids', () => { const id = newId('sample', 1_700_000_000_000); expect(idPattern('sample').test(id)).toBe(true); expect(newId('sample', 1)).not.toBe(newId('sample', 1)); });
  it('staleness', () => { const now = new Date('2026-01-01'); expect(classifyStaleness(new Date('2025-12-01'), now)).toBe('fresh'); expect(classifyStaleness(new Date('2025-07-20'), now)).toBe('due_soon'); expect(classifyStaleness(new Date('2025-01-01'), now)).toBe('stale'); });
});
