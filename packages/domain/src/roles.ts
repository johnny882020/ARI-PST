// Canonical roles. Source: plan/00-contract-pack.md section 5.
export const ROLES = [
  'anonymous', 'researcher_il', 'researcher_intl', 'center_clinician',
  'national_coordinator', 'committee_member', 'system_admin',
] as const;
export type Role = (typeof ROLES)[number];

export const EXTERNAL_ROLES: readonly Role[] = ['anonymous', 'researcher_il', 'researcher_intl'];
export const STAFF_ROLES: readonly Role[] = ['center_clinician', 'national_coordinator', 'committee_member', 'system_admin'];
export const AUTHENTICATED_ROLES: readonly Role[] = ROLES.filter((r) => r !== 'anonymous');
/** Roles that must use a passkey or TOTP (REQ-044). All authenticated roles need a second factor. */
export const PASSKEY_REQUIRED_ROLES: readonly Role[] = ['system_admin', 'national_coordinator', 'committee_member'];

export const isRole = (v: unknown): v is Role => typeof v === 'string' && (ROLES as readonly string[]).includes(v);
export const isExternalRole = (r: Role): boolean => EXTERNAL_ROLES.includes(r);
export const isStaffRole = (r: Role): boolean => STAFF_ROLES.includes(r);

/** Roles that cannot be held together (separation of duties, contract pack section 5). */
export function violatesSeparationOfDuties(existing: readonly Role[], adding: Role): boolean {
  const data: readonly Role[] = ['committee_member', 'national_coordinator', 'center_clinician'];
  if (adding === 'system_admin') return existing.some((r) => data.includes(r));
  if (data.includes(adding) && existing.includes('system_admin')) return true;
  if (adding === 'committee_member' && existing.includes('national_coordinator')) return true;
  if (adding === 'national_coordinator' && existing.includes('committee_member')) return true;
  return false;
}
/** External roles never get a database role that can read sample rows. */
export function canReadSampleRows(role: Role): boolean {
  return role === 'national_coordinator' || role === 'center_clinician';
}
/** Role granted automatically after the coordinator approves a self-registration. */
export function researcherRoleFor(isIsraeliAcademic: boolean): Role {
  return isIsraeliAcademic ? 'researcher_il' : 'researcher_intl';
}
