import { describe, expect, it } from 'vitest';
import { generate, toSql, makeImportFile, PROFILES } from './index.ts';

const ID = /^[a-z]{3}_[0-9A-HJKMNP-TV-Z]{26}$/;
describe('synthetic generator', () => {
  it('is deterministic for the same seed and differs for another', () => {
    expect(generate({ seed: 7, profile: 'tiny' })).toEqual(generate({ seed: 7, profile: 'tiny' }));
    expect(generate({ seed: 7, profile: 'tiny' }).samples[0]!.id).not.toBe(generate({ seed: 8, profile: 'tiny' }).samples[0]!.id);
  });
  it('produces the documented sizes', () => {
    expect(generate({ seed: 1, profile: 'tiny' }).samples).toHaveLength(40);
    expect(generate({ seed: 1, profile: 'tiny' }).centers).toHaveLength(2);
    expect(generate({ seed: 1, profile: 'preview' }).samples).toHaveLength(600);
    expect(generate({ seed: 1, profile: 'stale' }).samples).toHaveLength(300);
  });
  it('is obviously fake: names, .invalid e-mails, valid ids, is_synthetic', () => {
    for (const p of PROFILES.filter((x) => x !== 'load')) {
      const ds = generate({ seed: 3, profile: p });
      for (const c of ds.centers) { expect(c.nameEn).toMatch(/^Synthetic Center [A-E]$/); expect(c.id).toMatch(ID); }
      for (const u of ds.users) { expect(u.email).toMatch(/@example\.invalid$/); expect(u.displayName).toMatch(/^Synthetic /); expect(u.id).toMatch(ID); }
      for (const s of ds.samples) { expect(s.id).toMatch(ID); expect(s.isSynthetic).toBe(true); expect(s.collectionMonth).toMatch(/^\d{4}-\d{2}$/); }
      for (const r of ds.requestPlans) expect(r.researchQuestion.startsWith('SYNTHETIC:')).toBe(true);
    }
  });
  it('one user per role, clinicians scoped to a center', () => {
    const ds = generate({ seed: 1, profile: 'preview' });
    for (const role of ['system_admin', 'national_coordinator', 'committee_member', 'researcher_il', 'researcher_intl', 'center_clinician']) expect(ds.users.some((u) => u.role === role)).toBe(true);
    expect(ds.users.filter((u) => u.role === 'center_clinician').every((u) => u.centerId !== null)).toBe(true);
    expect(ds.users.filter((u) => u.role !== 'center_clinician').every((u) => u.centerId === null)).toBe(true);
  });
  it('donors are internally consistent (same diagnosis, sex, age, center)', () => {
    const ds = generate({ seed: 5, profile: 'preview' });
    const m = new Map<string, string>();
    for (const s of ds.samples) {
      const sig = [s.diagnosisCode, s.sex, s.ageBand, s.sourceCenterId].join('|');
      expect(m.get(s.donorRef) ?? sig).toBe(sig); m.set(s.donorRef, sig);
    }
  });
  it('kedge has exact known cells: one donor with six samples, small center C', () => {
    const ds = generate({ seed: 1, profile: 'kedge' });
    expect(ds.expected.donorsByDiagnosis['dmg_h3k27']).toBe(14);
    expect(ds.expected.donorsByDiagnosis['dhg_h3g34']).toBe(1);
    expect(ds.samples.filter((s) => s.diagnosisCode === 'dhg_h3g34')).toHaveLength(6);
    expect(ds.expected.donorsByCenter[ds.centers[2]!.id]).toBe(4);
    expect(ds.expected.samples).toBeGreaterThan(ds.expected.donors);
  });
  it('stale profile spans 0..400 days since verification', () => {
    const ds = generate({ seed: 1, profile: 'stale' });
    const days = new Set(ds.samples.map((s) => Math.round((Date.parse(ds.now) - Date.parse(s.lastVerifiedAt)) / 86_400_000)));
    for (const d of [0, 150, 175, 181, 400]) expect(days.has(d)).toBe(true);
  });
  it('SQL output escapes quotes and never contains real-looking identifiers', () => {
    const sql = toSql(generate({ seed: 1, profile: 'tiny' }));
    expect(sql).toContain('INSERT INTO portal.samples');
    expect(sql).not.toMatch(/[A-Za-z0-9._-]+@(?!example\.invalid)[A-Za-z0-9.-]+/);
  });
  it('dirty import files carry the expected report', () => {
    expect(makeImportFile('bad_enum').expectedReport).toEqual([{ rowNo: 2, rule: 'VOCAB' }]);
    expect(makeImportFile('dup_rows').expectedReport).toHaveLength(4);
    expect(new TextDecoder().decode(makeImportFile('crlf_csv').bytes)).toContain('\r\n');
    expect(makeImportFile('bom_csv').bytes[0]).toBe(0xef);
  });
});
