import { mulberry32, makeId, hex32, type Rng } from './prng.ts';
import {
  AGE_BANDS, ATTACHED, AVAILABILITIES, CONSENTS, DIAGNOSIS_CODES, SAMPLE_TYPES, SEXES, TIMEPOINTS,
  type Profile, type RequestPlan, type SyntheticCenter, type SyntheticDataset, type SyntheticEthics, type SyntheticSample, type SyntheticUser,
} from './types.ts';

const LETTERS = ['A', 'B', 'C', 'D', 'E'] as const;
const HE_LETTERS = ['א', 'ב', 'ג', 'ד', 'ה'] as const;
const PROFILE_SHAPE: Record<Profile, { samples: number; centers: number }> = {
  tiny: { samples: 40, centers: 2 }, preview: { samples: 600, centers: 3 }, load: { samples: 50000, centers: 5 },
  kedge: { samples: 0, centers: 3 }, stale: { samples: 300, centers: 3 },
};
const DAY = 86_400_000;

export interface GenerateOptions { seed: number; profile: Profile; now?: string }

function centers(rng: Rng, n: number): SyntheticCenter[] {
  return Array.from({ length: n }, (_, i) => ({
    id: makeId(rng, 'ctr'), code: `synth_${LETTERS[i]!.toLowerCase()}`, nameEn: `Synthetic Center ${LETTERS[i]}`,
    nameHe: `מרכז סינתטי ${HE_LETTERS[i]}`, contactRole: 'Center research coordinator', feedsRegularly: i < 2,
  }));
}
function users(rng: Rng, cs: SyntheticCenter[]): SyntheticUser[] {
  const mk = (role: SyntheticUser['role'], slug: string, name: string, centerId: string | null = null): SyntheticUser => ({
    id: makeId(rng, 'usr'), email: `synthetic.${slug}@example.invalid`, displayName: name, locale: 'en', role, centerId,
  });
  const out: SyntheticUser[] = [
    mk('system_admin', 'admin.a', 'Synthetic Admin A'), mk('system_admin', 'admin.b', 'Synthetic Admin B'),
    mk('national_coordinator', 'coordinator.a', 'Synthetic Coordinator A'), mk('national_coordinator', 'coordinator.b', 'Synthetic Coordinator B'),
    mk('committee_member', 'committee.a', 'Synthetic Committee Member A'), mk('committee_member', 'committee.b', 'Synthetic Committee Member B'),
    mk('committee_member', 'committee.c', 'Synthetic Committee Member C'),
    mk('researcher_il', 'researcher.a', 'Synthetic Researcher A'), mk('researcher_il', 'researcher.b', 'Synthetic Researcher B'),
    mk('researcher_il', 'researcher.c', 'Synthetic Researcher C'), mk('researcher_intl', 'intl.a', 'Synthetic International Researcher A'),
  ];
  for (const c of cs) out.push(mk('center_clinician', `clinician.${c.code.slice(-1)}`, `Synthetic Clinician ${c.code.slice(-1).toUpperCase()}`, c.id));
  return out;
}
function ethics(rng: Rng, cs: SyntheticCenter[]): SyntheticEthics[] {
  const out: SyntheticEthics[] = [];
  cs.forEach((c, ci) => {
    const n = 1 + (ci % 3);
    for (let i = 1; i <= n; i++) {
      const expired = ci === 0 && i === n && n > 1;
      out.push({ id: makeId(rng, 'eth'), centerId: c.id, approvalRef: `SYNTH-ETH-${LETTERS[ci]}-${String(i).padStart(3, '0')}`,
        status: expired ? 'expired' : 'active', validFrom: '2020-01-01', validTo: expired ? '2023-12-31' : null });
    }
  });
  return out;
}

interface Donor { ref: string; centerId: string; dx: string; age: string; sex: string; nSamples: number }
function buildSample(rng: Rng, d: Donor, eth: SyntheticEthics[], now: number, verifiedDaysAgo: number | null, forceType?: string): SyntheticSample {
  const own = eth.filter((e) => e.centerId === d.centerId && e.status === 'active');
  const att = ATTACHED.filter(() => rng.chance(0.3));
  const ageDays = verifiedDaysAgo ?? rng.int(120);
  return {
    id: makeId(rng, 'smp'), donorRef: d.ref, sourceCenterId: d.centerId, diagnosisCode: d.dx, ageBand: d.age, sex: d.sex,
    sampleType: forceType ?? rng.weighted([['ffpe', 5], ['frozen', 3], ['csf', 1], ['plasma_or_liquid_biopsy', 1], ['isolated_dna_rna', 1]]),
    availability: rng.weighted([['available', 8], ['limited', 2], ['depleted', 1]]),
    quantityClass: rng.chance(0.8) ? rng.pick(['small', 'medium', 'large']) : null,
    clinicalTimepoint: rng.weighted([['diagnosis', 70], ['during_treatment', 20], ['relapse', 10]]),
    collectionMonth: `${2015 + rng.int(11)}-${String(1 + rng.int(12)).padStart(2, '0')}`,
    attachedData: att, consentStatus: rng.pick(CONSENTS),
    ethicsApprovalId: rng.chance(0.95) && own.length ? rng.pick(own).id : null,
    contactRef: 'Center research coordinator', lastVerifiedAt: new Date(now - ageDays * DAY).toISOString(), isSynthetic: true,
  };
}

/** kedge: exact donor cell counts so k-rule tests have known answers. */
function kedge(rng: Rng, cs: SyntheticCenter[], eth: SyntheticEthics[], now: number): SyntheticSample[] {
  const [A, B, C] = cs as [SyntheticCenter, SyntheticCenter, SyntheticCenter];
  const out: SyntheticSample[] = [];
  const cell = (center: SyntheticCenter, dx: string, donors: number, opts: { female?: number; samplesPer?: number; age?: string } = {}): void => {
    for (let i = 0; i < donors; i++) {
      const d: Donor = { ref: hex32(rng), centerId: center.id, dx, age: opts.age ?? AGE_BANDS[(i % 3) + 1]!,
        sex: i < (opts.female ?? Math.ceil(donors / 2)) ? 'female' : 'male', nSamples: opts.samplesPer ?? 1 };
      for (let s = 0; s < d.nSamples; s++) out.push(buildSample(rng, d, eth, now, null, SAMPLE_TYPES[s % SAMPLE_TYPES.length]));
    }
  };
  cell(A, 'dmg_h3k27', 14, { female: 9 });                 // visible cell, uneven sex split (rest 5)
  cell(A, 'dhg_h3g34', 1, { samplesPer: 6 });              // ONE donor with SIX samples: must stay hidden
  cell(A, 'cns_tumour_nos', 6);                            // 5..9 band
  cell(B, 'pilocytic_astrocytoma', 12, { female: 8 });     // rest 4 on sex split: differencing target
  cell(B, 'ped_diffuse_lgg_family', 11);
  cell(B, 'mb_wnt', 2); cell(B, 'mb_shh', 2);              // family sum 4 < k: rolls to group level
  cell(B, 'mb_non_wnt_non_shh', 5);                        // exactly k
  cell(B, 'ependymoma_supratentorial', 3);                 // family sum 3: group level
  cell(C, 'ependymoma_posterior_fossa', 4);                // center C is small
  return out;
}

function randomSamples(rng: Rng, cs: SyntheticCenter[], eth: SyntheticEthics[], n: number, now: number, profile: Profile): SyntheticSample[] {
  const out: SyntheticSample[] = [];
  const weights = cs.map((c, i) => [c, i === 0 ? 5 : i === cs.length - 1 && cs.length === 3 ? 1 : 3] as const);
  const staleOffsets = [0, 150, 175, 181, 400];
  while (out.length < n) {
    const c = rng.weighted(weights);
    const d: Donor = { ref: hex32(rng), centerId: c.id, dx: rng.weighted(DIAGNOSIS_CODES.map((x, i) => [x, 12 - i] as const)),
      age: rng.pick(AGE_BANDS), sex: rng.weighted([['female', 48], ['male', 50], ['other_or_unknown', 2]]), nSamples: rng.chance(0.2) ? 1 + rng.int(3) : 1 };
    for (let s = 0; s < d.nSamples && out.length < n; s++) {
      out.push(buildSample(rng, d, eth, now, profile === 'stale' ? staleOffsets[out.length % staleOffsets.length]! : null));
    }
  }
  return out;
}

const TXT = 'SYNTHETIC: ';
function requestPlans(): RequestPlan[] {
  const base = { researchQuestion: `${TXT}placeholder research question`, plannedUse: `${TXT}placeholder planned use`, fundingSources: `${TXT}placeholder funding`, ethicsRef: 'SYNTH-APPLICANT-001' };
  const crit = { diagnosis: ['dmg_h3k27'] };
  return [
    { key: 'req-draft', applicantEmail: 'synthetic.researcher.a@example.invalid', target: 'draft', criteria: crit, ...base },
    { key: 'req-precheck', applicantEmail: 'synthetic.researcher.a@example.invalid', target: 'precheck', criteria: crit, ...base },
    { key: 'req-needs-info', applicantEmail: 'synthetic.researcher.b@example.invalid', target: 'needs_info', criteria: crit, ...base },
    { key: 'req-committee', applicantEmail: 'synthetic.researcher.b@example.invalid', target: 'committee_review', criteria: crit, ...base },
    { key: 'req-quorum-not-met', applicantEmail: 'synthetic.researcher.c@example.invalid', target: 'quorum_not_met', criteria: crit, ...base },
    { key: 'req-approved', applicantEmail: 'synthetic.researcher.c@example.invalid', target: 'approved', criteria: crit, ...base },
    { key: 'req-rejected', applicantEmail: 'synthetic.researcher.a@example.invalid', target: 'rejected', criteria: crit, ...base },
    { key: 'req-delivered', applicantEmail: 'synthetic.researcher.b@example.invalid', target: 'delivered', criteria: crit, ...base },
    { key: 'req-withdrawn', applicantEmail: 'synthetic.researcher.c@example.invalid', target: 'withdrawn', criteria: crit, ...base },
  ];
}

export function generate(opts: GenerateOptions): SyntheticDataset {
  const now = opts.now ?? '2026-11-13T10:00:00Z';
  const nowMs = Date.parse(now);
  const rng = mulberry32(opts.seed);
  const shape = PROFILE_SHAPE[opts.profile];
  const cs = centers(rng, shape.centers);
  const us = users(rng, cs);
  const eth = ethics(rng, cs);
  const samples = opts.profile === 'kedge' ? kedge(rng, cs, eth, nowMs) : randomSamples(rng, cs, eth, shape.samples, nowMs, opts.profile);
  const donors = new Set(samples.map((s) => s.donorRef));
  const dd: Record<string, Set<string>> = {}; const dc: Record<string, Set<string>> = {};
  for (const s of samples) { (dd[s.diagnosisCode] ??= new Set()).add(s.donorRef); (dc[s.sourceCenterId] ??= new Set()).add(s.donorRef); }
  const count = (m: Record<string, Set<string>>): Record<string, number> => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.size]));
  return { seed: opts.seed, profile: opts.profile, now, isSynthetic: true, centers: cs, users: us, ethics: eth, samples, requestPlans: requestPlans(),
    expected: { donors: donors.size, samples: samples.length, donorsByDiagnosis: count(dd), donorsByCenter: count(dc) } };
}
