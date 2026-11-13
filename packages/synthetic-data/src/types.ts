export const PROFILES = ['tiny', 'preview', 'load', 'kedge', 'stale'] as const;
export type Profile = (typeof PROFILES)[number];
export const ROLES = ['researcher_il', 'researcher_intl', 'center_clinician', 'national_coordinator', 'committee_member', 'system_admin'] as const;
export type RoleName = (typeof ROLES)[number];
export const AGE_BANDS = ['0_lt1', '1_lt3', '3_lt6', '6_lt10', '10_lt15', '15_lt18'] as const;
export const SEXES = ['female', 'male', 'other_or_unknown'] as const;
export const SAMPLE_TYPES = ['ffpe', 'frozen', 'csf', 'plasma_or_liquid_biopsy', 'isolated_dna_rna'] as const;
export const AVAILABILITIES = ['available', 'limited', 'depleted'] as const;
export const TIMEPOINTS = ['diagnosis', 'during_treatment', 'relapse'] as const;
export const ATTACHED = ['wes', 'wgs', 'rna_seq', 'mri', 'digital_pathology', 'redcap_clinical'] as const;
export const CONSENTS = ['consent_obtained', 'broad_consent', 'waiver_by_committee', 'restricted', 'unknown'] as const;
/** Codes that exist in db/seeds/010_diagnosis_vocabulary.sql and are selectable. */
export const DIAGNOSIS_CODES = [
  'dmg_h3k27', 'dhg_h3g34', 'pilocytic_astrocytoma', 'ped_diffuse_lgg_family', 'mb_wnt', 'mb_shh', 'mb_non_wnt_non_shh',
  'ependymoma_posterior_fossa', 'ependymoma_supratentorial', 'cns_tumour_nos', 'cns_tumour_pending_dx',
] as const;

export interface SyntheticCenter { id: string; code: string; nameEn: string; nameHe: string; contactRole: string; feedsRegularly: boolean }
export interface SyntheticUser { id: string; email: string; displayName: string; locale: 'he' | 'en'; role: RoleName; centerId: string | null }
export interface SyntheticEthics { id: string; centerId: string; approvalRef: string; status: 'active' | 'expired'; validFrom: string; validTo: string | null }
export interface SyntheticSample {
  id: string; donorRef: string; sourceCenterId: string; diagnosisCode: string; ageBand: string; sex: string; sampleType: string;
  availability: string; quantityClass: string | null; clinicalTimepoint: string; collectionMonth: string; attachedData: string[];
  consentStatus: string; ethicsApprovalId: string | null; contactRef: string; lastVerifiedAt: string; isSynthetic: true;
}
export type RequestTarget = 'draft' | 'precheck' | 'needs_info' | 'committee_review' | 'approved' | 'rejected' | 'delivered' | 'withdrawn' | 'quorum_not_met';
export interface RequestPlan {
  key: string; applicantEmail: string; target: RequestTarget; criteria: Record<string, string[]>;
  researchQuestion: string; plannedUse: string; fundingSources: string; ethicsRef: string;
}
export interface SyntheticDataset {
  seed: number; profile: Profile; now: string; isSynthetic: true;
  centers: SyntheticCenter[]; users: SyntheticUser[]; ethics: SyntheticEthics[]; samples: SyntheticSample[]; requestPlans: RequestPlan[];
  /** true donor counts per diagnosis code and per center (oracle for tests; NOT post-suppression). */
  expected: { donors: number; samples: number; donorsByDiagnosis: Record<string, number>; donorsByCenter: Record<string, number> };
}
