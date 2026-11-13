import type { Harness, TestUser } from './harness.js';
export interface Fixture {
  centerA: string; centerB: string;
  coord: TestUser; clinA: TestUser; clinB: TestUser; committee: TestUser[]; admin1: TestUser; admin2: TestUser; resIl: TestUser; resIl2: TestUser; resIntl: TestUser;
}
export async function buildFixture(h: Harness): Promise<Fixture> {
  const centerA = await h.seedCenter('syn_a'); const centerB = await h.seedCenter('syn_b');
  return {
    centerA, centerB,
    coord: await h.seedUser('national_coordinator'),
    clinA: await h.seedUser('center_clinician', centerA, 'a'), clinB: await h.seedUser('center_clinician', centerB, 'b'),
    committee: [await h.seedUser('committee_member', null, 'c1'), await h.seedUser('committee_member', null, 'c2'), await h.seedUser('committee_member', null, 'c3')],
    admin1: await h.seedUser('system_admin', null, 'a1'), admin2: await h.seedUser('system_admin', null, 'a2'),
    resIl: await h.seedUser('researcher_il', null, 'il1'), resIl2: await h.seedUser('researcher_il', null, 'il2'), resIntl: await h.seedUser('researcher_intl'),
  };
}
export const sampleBody = (centerId: string, over: Record<string, unknown> = {}) => ({
  sourceCenterId: centerId, diagnosisCode: 'mb_shh', ageBandAtDiagnosis: '3_lt6', sex: 'female', sampleType: 'ffpe', availability: 'available',
  clinicalTimepoint: 'diagnosis', collectionMonth: '2024-05', attachedData: ['wes'], ...over,
});
