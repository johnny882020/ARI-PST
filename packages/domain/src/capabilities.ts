// One role-capability table. It generates OpenAPI `x-roles`, the authz matrix test and the route guards (RT-07).
// 'public' = no session. 'auth' = any authenticated role. Otherwise the listed roles.
import { AUTHENTICATED_ROLES, type Role } from './roles.js';
export type Access = 'public' | 'auth' | readonly Role[];
const R = (...r: Role[]): readonly Role[] => r;
const COORD = R('national_coordinator');
const ALL_AUTH: Access = 'auth';

export const OPERATION_ACCESS: Record<string, Access> = {
  // health and meta
  livez: 'public', readyz: 'public', reportClientError: 'public', reportCsp: 'public', csrfBootstrap: 'public',
  submitPublicForm: 'public',
  // auth
  login: 'public', verifyMfa: 'public', webauthnOptions: 'public', register: 'public', verifyEmail: 'public',
  logout: ALL_AUTH, getAuthSession: ALL_AUTH, getSessionInfo: ALL_AUTH, extendSession: ALL_AUTH, getMe: ALL_AUTH, updateMe: ALL_AUTH, changePassword: ALL_AUTH,
  stepUp: ALL_AUTH, enrollTotpStart: ALL_AUTH, enrollTotpConfirm: ALL_AUTH, webauthnRegisterOptions: ALL_AUTH,
  webauthnRegisterVerify: ALL_AUTH, regenerateRecoveryCodes: ALL_AUTH,
  // samples
  listSamples: R('center_clinician', 'national_coordinator'),
  createSample: COORD,
  getSample: R('center_clinician', 'national_coordinator'),
  updateSample: COORD,
  verifySample: R('center_clinician', 'national_coordinator'),
  flagSample: R('center_clinician', 'national_coordinator'),
  retireSample: COORD,
  // search
  searchAggregate: R('researcher_il', 'researcher_intl', 'center_clinician', 'national_coordinator', 'committee_member'),
  searchFacets: R('researcher_il', 'researcher_intl', 'center_clinician', 'national_coordinator', 'committee_member'),
  suggestTerms: R('researcher_il', 'researcher_intl', 'center_clinician', 'national_coordinator', 'committee_member'),
  listDiagnoses: 'public',
  // requests
  listRequests: R('researcher_il', 'center_clinician', 'national_coordinator', 'committee_member'),
  createRequest: R('researcher_il'),
  getRequest: R('researcher_il', 'center_clinician', 'national_coordinator', 'committee_member'),
  updateRequestDraft: R('researcher_il'),
  addRequestItem: R('researcher_il'),
  removeRequestItem: R('researcher_il'),
  submitRequest: R('researcher_il'),
  transitionRequest: R('researcher_il', 'national_coordinator', 'committee_member'),
  listRequestSteps: R('researcher_il', 'center_clinician', 'national_coordinator', 'committee_member'),
  updateRequestStep: R('national_coordinator', 'center_clinician'),
  resolveRequestSamples: COORD,
  listResolvedSamples: R('national_coordinator', 'center_clinician'),
  listRequestAgreements: R('national_coordinator', 'committee_member', 'center_clinician'),
  castVote: R('committee_member'),
  listVotes: R('committee_member', 'national_coordinator'),
  listDecisions: R('researcher_il', 'national_coordinator', 'committee_member'),
  recordDecision: R('committee_member'),
  getRequestCart: R('researcher_il'),
  addCartItem: R('researcher_il'), removeCartItem: R('researcher_il'), startRequestFromCart: R('researcher_il'),
  precheckRequest: COORD, respondToInfoRequest: R('researcher_il'),
  getVoteTally: R('committee_member', 'national_coordinator'),
  recoverMfa: 'public', listAuthMethods: ALL_AUTH,
  decideRegistration: COORD,
  listKPolicies: R('system_admin', 'committee_member', 'national_coordinator'),
  proposeKPolicyChange: R('system_admin'),
  approveKPolicyChange: R('committee_member'),
  listRoleGrantRequests: R('system_admin', 'committee_member', 'national_coordinator'),
  createRoleGrantRequest: R('system_admin'),
  decideRoleGrantRequest: R('system_admin', 'committee_member', 'national_coordinator'),
  // import
  listImportJobs: COORD, createImportJob: COORD, getImportJob: COORD, listImportRows: COORD,
  downloadImportReport: COORD, downloadImportResultMap: COORD, commitImportJob: COORD, downloadImportTemplate: COORD,
  // audit
  queryAuditEvents: R('system_admin', 'national_coordinator', 'committee_member'),
  verifyAuditChain: R('system_admin'),
  // centers and staleness
  listCenters: ALL_AUTH, createCenter: R('system_admin'), getCenter: ALL_AUTH, updateCenter: R('system_admin'),
  getCenterStaleness: R('center_clinician', 'national_coordinator'),
  listStaleness: COORD,
  getMetrics: R('national_coordinator', 'committee_member', 'system_admin'),
  listEthicsApprovals: R('center_clinician', 'national_coordinator'),
  createEthicsApproval: COORD,
  // users and governance
  listUsers: R('system_admin', 'national_coordinator'),
  inviteUser: R('system_admin'),
  getUser: R('system_admin', 'national_coordinator'),
  updateUser: R('system_admin'),
  listPendingRegistrations: COORD,
  grantRole: R('system_admin'),
  revokeRole: R('system_admin'),
  listApprovals: R('system_admin', 'committee_member', 'national_coordinator'),
  approveGovernanceChange: R('system_admin', 'committee_member', 'national_coordinator'),
  getGovernanceConfig: R('system_admin', 'national_coordinator', 'committee_member'),
  proposeKChange: R('system_admin'),
  proposeCommitteeConfigChange: R('system_admin'),
  listOutbox: R('system_admin'),
};
export function rolesFor(operationId: string): readonly Role[] | 'public' {
  const a = OPERATION_ACCESS[operationId];
  if (a === undefined) return [];
  if (a === 'public') return 'public';
  if (a === 'auth') return AUTHENTICATED_ROLES;
  return a;
}
export function roleMayCall(operationId: string, role: Role): boolean {
  const a = rolesFor(operationId);
  return a === 'public' || a.includes(role);
}
