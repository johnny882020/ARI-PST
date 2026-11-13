// Ports (hexagonal core). Adapters live in apps/api/src/adapters. This file has no runtime imports of platform libraries.
import type { Role } from './roles.js';
import type { Filters } from './budget.js';
import type { RequestState, CloseReason } from './request-state.js';
import type { StepKey } from './request-flow.js';
import type { VoteValue, DecisionOutcome, CommitteeConfig } from './voting.js';
import type { SampleInput, SamplePatch, AgeBand, Sex, SampleType, Availability, Timepoint, AttachedData, ConsentStatus, QuantityClass } from './sample.js';
import type { Staleness } from './staleness.js';

// ---------- Clock ----------
export interface Clock { now(): Date }
export const systemClock: Clock = { now: () => new Date() };

// ---------- Actor and request context ----------
export interface Actor {
  userId: string | null;
  role: Role;                 // effective role for this request (highest-privilege held role that the route allows)
  roles: Role[];              // all active roles
  centerId: string | null;    // scope of center_clinician, from role assignments (never from the client)
  sessionId?: string | null;
}
export interface Ctx { actor: Actor; traceId: string; ipHash?: string | null }
export const ANON_ACTOR: Actor = { userId: null, role: 'anonymous', roles: ['anonymous'], centerId: null };

// ---------- Audit ----------
export type AuditOutcome = 'success' | 'denied' | 'error';
export interface AuditEvent {
  action: string;                       // catalog: plan/02-security-privacy/07-audit-log.md
  objectType?: string | null; objectId?: string | null; centerId?: string | null;
  outcome: AuditOutcome;
  details?: Record<string, string | number | boolean | null | string[]>;   // ids and codes only
}
export interface AuditRow extends AuditEvent {
  seq: number; id: string; occurredAt: string; actorUserId: string | null; actorRole: string | null; traceId: string | null; hash: string;
}
export interface AuditQuery { from?: string; to?: string; actorUserId?: string; action?: string; objectType?: string; objectId?: string; outcome?: AuditOutcome; cursor?: string; limit: number }
export interface AuditPort {
  /** Writes in the caller's transaction when `tx` is given. Fail-closed: errors propagate. */
  record(ctx: Ctx, ev: AuditEvent): Promise<void>;
}

// ---------- Records ----------
export interface UserRecord {
  id: string; email: string; displayName: string; locale: 'he' | 'en'; status: 'invited' | 'active' | 'suspended' | 'closed';
  emailVerifiedAt: string | null; lastLoginAt: string | null; createdAt: string;
  roles: RoleAssignmentRecord[]; institution?: string | null;
}
export interface RoleAssignmentRecord { id: string; role: Role; centerId: string | null; grantedAt: string }
export interface RegistrationRecord { id: string; email: string; displayName: string; institution: string; status: 'pending' | 'approved' | 'rejected'; requestedAt: string; isIsraeliAcademic: boolean }
export interface CenterRecord { id: string; code: string; nameEn: string; nameHe: string; isActive: boolean; contactRole: string; contactChannel: string | null; localSystemRef?: string | null; feedsRegularly: boolean }
export interface SampleRecord {
  sampleCode: string; sourceCenterId: string; diagnosisCode: string; ageBandAtDiagnosis: AgeBand; sex: Sex; sampleType: SampleType;
  availability: Availability; quantityClass: QuantityClass | null; clinicalTimepoint: Timepoint; collectionMonth: string;
  attachedData: AttachedData[]; consentStatus: ConsentStatus; ethicsApprovalRef: string | null; contactRef: string;
  staleness: Staleness; createdAt: string; updatedAt: string; lastVerifiedAt: string; flagged?: boolean;
}
export interface Page<T> { items: T[]; nextCursor: string | null }
export interface SampleListQuery { centerId?: string; diagnosisCode?: string; sampleType?: string; availability?: string; staleness?: Staleness; cursor?: string; limit: number }
export interface DiagnosisTermRecord { diagnosisCode: string; parentCode: string | null; level: 'group' | 'family' | 'type'; icdo3Morph: string | null; labelHe: string; labelEn: string }
export interface Bucket { bucket: string; level: string; count: number | null; suppressed: boolean; band?: string }
export interface AggregateCount { count: number | null; suppressed: boolean; k: number; band?: string | null }

export interface RequestItemRecord { createdAt?: string; id: string; criteria: Filters; requestedCount: number | null; shownCountBucket: string | null }
export interface RequestStepRecord { stepKey: StepKey; centerId: string | null; status: 'pending' | 'in_progress' | 'done' | 'skipped' | 'blocked'; publicNote: string | null; internalNote?: string | null; startedAt: string | null; completedAt: string | null }
export interface RequestRecord {
  id: string; status: RequestState; closeReason: CloseReason | null; applicantUserId: string;
  researchQuestion: string | null; applicantEthicsRef: string | null; plannedUse: string | null; fundingSources: string | null;
  items: RequestItemRecord[]; steps?: RequestStepRecord[];
  submittedAt: string | null; decidedAt: string | null; deliveredAt: string | null; createdAt: string; updatedAt: string; appealCount?: number;
}
export interface VoteRecord { requestId: string; voterUserId: string; vote: VoteValue; comment: string | null; votedAt: string }
export interface DecisionRecord { id: string; requestId: string; outcome: DecisionOutcome; rationale: string | null; decidedAt: string }

export interface ImportJobRecord {
  id: string; createdBy: string; centerId: string | null; mode: 'dry_run' | 'commit'; format: 'csv' | 'xlsx';
  status: 'uploaded' | 'validating' | 'validated' | 'rejected' | 'committing' | 'committed' | 'failed' | 'cancelled' | 'expired';
  parentJobId: string | null; fileSha256: string | null; stagingKey: string | null; totalRows: number | null; acceptedRows: number | null;
  warningRows: number | null; rejectedRows: number | null; createdAt: string; finishedAt: string | null; expiresAt: string;
}
export interface ImportIssue { field: string; rule: string; severity: 'error' | 'warning' }
export interface ImportRowRecord { rowNo: number; outcome: 'accepted' | 'warning' | 'rejected'; action: 'create' | 'update' | 'verify_only' | 'none'; sampleCode: string | null; issues: ImportIssue[] }
export interface EthicsApprovalRecord { id: string; centerId: string; approvalRef: string; kind: 'helsinki_committee' | 'irb_other'; status: 'active' | 'expired' | 'revoked'; validFrom: string | null; validTo: string | null }
export interface ApprovalRecord { reason?: string | null; id: string; kind: 'role_grant' | 'k_change' | 'committee_config'; payload: Record<string, unknown>; proposedBy: string; status: 'pending' | 'approved' | 'rejected'; approvedBy: string | null; createdAt: string }
export interface OutboxRecord { id: string; template: string; toUserId: string | null; status: 'pending' | 'sent' | 'failed'; attempts: number; createdAt: string; sentAt: string | null }
export interface CenterStaleness { centerId: string; samplesTotal: number; samplesAvailable: number; staleCount: number; dueSoonCount: number; missingEthicsLink: number; slaDays: number; lastUpdateAt: string | null; completeness: Record<string, number> }

// ---------- Repository (unit of work) ----------
export interface UserRepo {
  getById(id: string): Promise<UserRecord | null>;
  getByEmail(email: string): Promise<UserRecord | null>;
  list(q: { status?: string; role?: string; cursor?: string; limit: number; researchersOnly?: boolean }): Promise<Page<UserRecord>>;
  create(u: { email: string; displayName: string; locale: 'he' | 'en'; status: UserRecord['status']; institution?: string | null; isIsraeliAcademic?: boolean }): Promise<UserRecord>;
  update(id: string, p: { displayName?: string; status?: UserRecord['status'] }): Promise<UserRecord | null>;
  grantRole(a: { id: string; userId: string; role: Role; centerId: string | null; grantedBy: string; approvedBy?: string }): Promise<RoleAssignmentRecord>;
  registerResearcher(r: { email: string; displayName: string; institution: string; isIsraeliAcademic: boolean; locale: 'he' | 'en' }): Promise<{ userId: string; verificationToken: string } | null>;
  updateSelf(id: string, p: { displayName?: string; locale?: 'he' | 'en' }): Promise<void>;
  approveRegistration(userId: string): Promise<void>;
  rejectRegistration(userId: string): Promise<void>;
  revokeRole(userId: string, assignmentId: string): Promise<boolean>;
  activeRoles(userId: string): Promise<RoleAssignmentRecord[]>;
  registrations(limit: number): Promise<RegistrationRecord[]>;
  verifyEmail(userId: string, token: string): Promise<boolean>;
  registrationFlag(userId: string): Promise<{ institution: string | null; isIsraeliAcademic: boolean } | null>;
}
export interface CenterRepo {
  list(): Promise<CenterRecord[]>; get(id: string): Promise<CenterRecord | null>;
  create(c: Omit<CenterRecord, 'feedsRegularly'> & { feedsRegularly?: boolean }): Promise<CenterRecord>;
  update(id: string, p: Partial<Omit<CenterRecord, 'id'>>): Promise<CenterRecord | null>;
  byCode(code: string): Promise<CenterRecord | null>;
  staleness(centerId: string): Promise<CenterStaleness | null>;
  stalenessAll(): Promise<CenterStaleness[]>;
  ethicsList(centerId?: string): Promise<EthicsApprovalRecord[]>;
  ethicsCreate(e: Omit<EthicsApprovalRecord, 'status'> & { createdBy: string }): Promise<EthicsApprovalRecord>;
  ethicsByRef(centerId: string, ref: string): Promise<EthicsApprovalRecord | null>;
}
export interface SampleRepo {
  insert(id: string, input: SampleInput, createdBy: string, source?: 'portal_entry' | 'csv_import'): Promise<SampleRecord>;
  get(id: string): Promise<{ sample: SampleRecord; etag: string } | null>;
  update(id: string, patch: SamplePatch, ifMatch: string | null): Promise<{ sample: SampleRecord; etag: string } | 'etag_mismatch' | null>;
  list(q: SampleListQuery): Promise<Page<SampleRecord>>;
  verify(id: string): Promise<SampleRecord | null>;
  flag(id: string, by: string, reasonCode: string): Promise<boolean>;
  retire(id: string): Promise<boolean>;
  diagnosisExists(code: string): Promise<boolean>;
  mapDiagnosis(sourceValue: string): Promise<string | null>;
}
export interface SearchRepo {
  total(filters: Filters): Promise<AggregateCount>;
  facet(filters: Filters, facet: string): Promise<Bucket[]>;
  k(): Promise<number>;
  expand(q: string, limit: number): Promise<Array<{ diagnosisCode: string; score: number; matchedVia: 'exact' | 'fts' | 'trgm' }>>;
  diagnoses(): Promise<DiagnosisTermRecord[]>;
  /** Persistent query accounting (budget and cache). */
  spent(userId: string, institution: string | null, now: Date): Promise<{ spentDay: number; spent30d: number; spentInstitution30d: number }>;
  recordQuery(userId: string, institution: string | null, queryKey: string, cost: number, now: Date): Promise<void>;
  seenInEpoch(userId: string, queryKey: string, epochStart: Date): Promise<boolean>;
}
export interface RequestRepo {
  getDraftFor(userId: string): Promise<RequestRecord | null>;
  create(r: { id: string; applicantUserId: string; idempotencyKey: string | null; fields: { researchQuestion?: string; applicantEthicsRef?: string; plannedUse?: string; fundingSources?: string } }): Promise<RequestRecord>;
  get(id: string): Promise<RequestRecord | null>;
  list(q: { status?: RequestState; cursor?: string; limit: number }): Promise<Page<RequestRecord>>;
  updateFields(id: string, fields: { researchQuestion?: string; applicantEthicsRef?: string; plannedUse?: string; fundingSources?: string }): Promise<RequestRecord | null>;
  setItems(id: string, items: Array<{ id: string; criteria: Filters; requestedCount: number | null; shownCountBucket: string | null }>): Promise<void>;
  addItem(id: string, item: { id: string; criteria: Filters; requestedCount: number | null; shownCountBucket: string | null }): Promise<RequestItemRecord>;
  removeItem(requestId: string, itemId: string): Promise<boolean>;
  findByIdempotency(userId: string, key: string): Promise<{ requestHash: string; requestId: string | null } | null>;
  saveIdempotency(userId: string, key: string, methodPath: string, requestHash: string, status: number, requestId: string | null): Promise<void>;
  transition(id: string, to: RequestState, closeReason: CloseReason | null, extra?: { reasonCode?: string; note?: string; checklist?: Record<string, boolean>; idempotencyKey?: string }): Promise<RequestRecord | null>;
  steps(id: string, includeInternal: boolean): Promise<RequestStepRecord[]>;
  updateStep(id: string, key: StepKey, centerId: string, p: { accepted?: boolean; agreement?: { kind: 'mta' | 'dta'; docRef: string }; publicNote?: string; internalNote?: string }): Promise<RequestStepRecord>;
  resolveSamples(requestId: string, itemId: string, sampleIds: string[]): Promise<boolean>;
  castVote(requestId: string, voterUserId: string, vote: VoteValue, comment: string | null, rationaleCode: string | null): Promise<VoteRecord>;
  votes(requestId: string): Promise<VoteRecord[]>;
  tally(requestId: string, userId: string): Promise<{ approve: number; reject: number; abstain: number; myVote: VoteValue | null; conflictDeclared: boolean } | null>;
  committeeConfig(): Promise<CommitteeConfig>;
  latestDecision(requestId: string): Promise<DecisionRecord | null>;
  decisions(requestId: string, applicantView: boolean): Promise<DecisionRecord[]>;
  countsByStatus(): Promise<Record<string, number>>;
}
export interface ImportRepo {
  createJob(j: { id: string; createdBy: string; centerId: string | null; mode: 'dry_run' | 'commit'; format: 'csv' | 'xlsx'; fileName: string; stagingKey: string; fileSha256: string; parentJobId?: string | null }): Promise<ImportJobRecord>;
  getJob(id: string): Promise<ImportJobRecord | null>;
  listJobs(q: { cursor?: string; limit: number }): Promise<Page<ImportJobRecord>>;
  finishJob(id: string, p: { status: ImportJobRecord['status']; total: number; accepted: number; warnings: number; rejected: number }): Promise<void>;
  saveRows(jobId: string, rows: ImportRowRecord[]): Promise<void>;
  listRows(jobId: string, q: { outcome?: string; cursor?: string; limit: number }): Promise<Page<ImportRowRecord>>;
  allRows(jobId: string): Promise<ImportRowRecord[]>;
  hasCommitChild(parentId: string): Promise<boolean>;
}
export interface GovernanceRepo {
  propose(a: { id: string; kind: ApprovalRecord['kind']; payload: Record<string, unknown>; proposedBy: string }): Promise<ApprovalRecord>;
  getApproval(id: string): Promise<ApprovalRecord | null>;
  listApprovals(status?: string): Promise<ApprovalRecord[]>;
  decide(id: string, by: string, approve: boolean, stepUpAgeS: number): Promise<ApprovalRecord | null>;
  getKPolicies(): Promise<Array<{ fieldSet: string; k: number }>>;
  metrics(): Promise<{ samplesTotal: number; centersFeeding: number; registeredResearchers: number; searchesLast30d: number; coordinatorEnteredShare: number }>;
}
export interface OutboxRepo {
  enqueue(o: { id: string; template: string; toRole?: Role | null; toUserId: string | null; toEmail: string | null; locale: 'he' | 'en'; params: Record<string, string> }): Promise<void>;
  claimPending(limit: number): Promise<Array<{ id: string; template: string; toEmail: string | null; locale: 'he' | 'en'; params: Record<string, string>; attempts: number }>>;
  markSent(id: string): Promise<void>;
  markFailed(id: string, giveUp: boolean): Promise<void>;
  list(limit: number): Promise<OutboxRecord[]>;
}
export interface AuditRepo {
  query(q: AuditQuery): Promise<Page<AuditRow>>;
  verify(from?: number, to?: number): Promise<number | null>;
}
export interface Tx {
  users: UserRepo; centers: CenterRepo; samples: SampleRepo; search: SearchRepo; requests: RequestRepo;
  imports: ImportRepo; governance: GovernanceRepo; outbox: OutboxRepo; audit: AuditPort; auditLog: AuditRepo;
  readonly now: Date;
}
export interface Repository {
  /** Runs fn in one transaction with the DB context (user, role, center) set. Rolls back on throw. */
  tx<T>(ctx: Ctx, fn: (tx: Tx) => Promise<T>): Promise<T>;
  /** Writes an audit event in its own transaction (used for denials and logins, outside business transactions). */
  auditStandalone(ctx: Ctx, ev: AuditEvent): Promise<void>;
  ping(): Promise<{ ok: boolean; migrationsOk: boolean; latestMigration: string | null }>;
}

// ---------- Auth ----------
export interface SessionRecord {
  id: string; userId: string; createdAt: number; lastSeenAt: number; mfaAt: number | null; ipHash: string | null; csrfToken: string;
  /** Snapshot of active roles at login. Role changes and suspension revoke the user's sessions. */
  roles: RoleAssignmentRecord[]; displayName: string; locale: 'he' | 'en';
}
export type MfaFactor = 'totp' | 'webauthn';
export interface AuthPort {
  hashPassword(pw: string): Promise<string>;
  /** Constant-time. Returns null for unknown user and wrong password alike. Applies lockout. */
  verifyPassword(email: string, password: string): Promise<{ userId: string; mfaFactors: MfaFactor[]; locked: boolean } | { locked: true } | null>;
  setPassword(userId: string, pw: string): Promise<void>;
  checkPasswordPolicy(pw: string, email?: string): string | null;
  // TOTP
  totpBegin(userId: string, accountLabel: string): Promise<{ secretBase32: string; otpauthUri: string }>;
  totpConfirm(userId: string, code: string): Promise<boolean>;
  totpVerify(userId: string, code: string): Promise<boolean>;
  // Recovery codes
  issueRecoveryCodes(userId: string): Promise<string[]>;
  useRecoveryCode(userId: string, code: string): Promise<boolean>;
  // WebAuthn
  webauthnRegistrationOptions(userId: string, userName: string): Promise<Record<string, unknown>>;
  webauthnRegistrationVerify(userId: string, response: unknown, name?: string): Promise<boolean>;
  listMethods(userId: string): Promise<Array<{ id: string; kind: 'passkey' | 'totp'; name: string; addedAt: string; lastUsedAt: string | null }>>;
  saveRegistrationMeta(userId: string, institution: string, termsVersion: string | null): Promise<void>;
  webauthnAuthOptions(userId: string): Promise<Record<string, unknown>>;
  webauthnAuthVerify(userId: string, response: unknown): Promise<boolean>;
  // Login challenge (between password and second factor)
  createChallenge(userId: string): Promise<string>;
  consumeChallenge(token: string, peek?: boolean): Promise<{ userId: string; attempts: number } | null>;
  failChallenge(token: string): Promise<void>;
  // Sessions (server-side)
  createSession(userId: string, opts: { mfaAt: number | null; ipHash: string | null; roles: RoleAssignmentRecord[]; displayName: string; locale: 'he' | 'en' }): Promise<SessionRecord>;
  getSession(id: string): Promise<SessionRecord | null>;
  touchSession(id: string, now: number): Promise<void>;
  stepUpSession(id: string, now: number): Promise<void>;
  rotateSession(id: string): Promise<SessionRecord | null>;
  revokeSession(id: string): Promise<void>;
  revokeAllForUser(userId: string): Promise<void>;
  hasMfa(userId: string): Promise<boolean>;
  activeRolesFor(userId: string): Promise<RoleAssignmentRecord[]>;
  profileFor(userId: string): Promise<{ email: string; displayName: string; locale: 'he' | 'en' } | null>;
  markEmailVerified(userId: string, activate: boolean): Promise<void>;
  storePasswordHash(userId: string, hash: string): Promise<void>;
  mfaFactorsFor(userId: string): Promise<MfaFactor[]>;
  recordLoginSuccess(userId: string): Promise<void>;
  /** Email verification tokens. */
  issueEmailToken(userId: string, purpose: 'verify_email' | 'invite'): Promise<string>;
  consumeEmailToken(token: string, purpose: 'verify_email' | 'invite'): Promise<string | null>;
}

// ---------- Object store ----------
export interface ObjectStorePort {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

// ---------- Mailer ----------
export interface MailMessage { to: string; subject: string; text: string; html?: string }
export interface Mailer { send(m: MailMessage): Promise<void> }
export interface NotifyPort {
  enqueue(tx: Tx, n: { template: string; toRole?: Role; toUserId?: string | null; toEmail?: string | null; locale?: 'he' | 'en'; params?: Record<string, string> }): Promise<void>;
}
