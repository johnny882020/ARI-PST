// Canonical roles. Source: plan/00-contract-pack.md section 5.
export const ROLES = [
  'anonymous', 'researcher_il', 'researcher_intl', 'center_clinician',
  'national_coordinator', 'committee_member', 'system_admin',
] as const;
export type Role = (typeof ROLES)[number];
