import {
  DomainError, ANON_ACTOR, sessionExpiresAt, stepUpFresh, researcherRoleFor, type AuthPort, type Clock, type Ctx, type Repository,
  type RoleAssignmentRecord, type SessionRecord, type NotifyPort, type Role, type UserRecord, isRole, violatesSeparationOfDuties,
} from '@ari/domain';
import { nid, institutionOf } from '../../lib/util.js';
import { randomToken } from '../../lib/crypto.js';

export interface SessionView { userId: string; displayName: string; locale: 'he' | 'en'; roles: RoleAssignmentRecord[]; activeCenterId: string | null; expiresAt: string; csrfToken: string; stepUpFresh: boolean; mfaEnrolled: boolean }

export class IdentityService {
  constructor(private repo: Repository, private auth: AuthPort, private notify: NotifyPort, private clock: Clock, private origin: string) {}
  private sys(traceId: string, ipHash: string | null | undefined): Ctx { return { actor: ANON_ACTOR, traceId, ipHash: ipHash ?? null }; }

  async login(email: string, password: string, traceId: string, ipHash: string | null) {
    const ctx = this.sys(traceId, ipHash);
    const norm = email.trim().toLowerCase();
    const r = await this.auth.verifyPassword(norm, password);
    if (!r || 'locked' in r && r.locked && !('userId' in r)) {
      await this.repo.auditStandalone(ctx, { action: 'auth.login.fail', outcome: 'denied', details: { reason: r ? 'locked' : 'credentials' } });
      if (r) throw new DomainError('RATE_LIMITED');
      throw new DomainError('UNAUTHENTICATED');
    }
    const ok = r as { userId: string; mfaFactors: ('totp' | 'webauthn')[]; locked: boolean };
    const token = await this.auth.createChallenge(ok.userId);
    return { challengeToken: token, factors: ok.mfaFactors, enrollmentRequired: ok.mfaFactors.length === 0 };
  }
  async webauthnOptions(challengeToken: string) {
    const c = await this.auth.consumeChallenge(challengeToken, true);
    if (!c) throw new DomainError('UNAUTHENTICATED');
    return this.auth.webauthnAuthOptions(c.userId);
  }
  /** Completes login. Returns the new server-side session. Factor-less accounts get an enrolment-only session (mfaAt null). */
  async verifyMfa(b: { challengeToken: string; totpCode?: string; recoveryCode?: string; webauthnAssertion?: unknown }, traceId: string, ipHash: string | null): Promise<SessionRecord> {
    const ctx = this.sys(traceId, ipHash);
    const c = await this.auth.consumeChallenge(b.challengeToken, true);
    if (!c || c.attempts >= 5) throw new DomainError('UNAUTHENTICATED');
    const factors = await this.auth.mfaFactorsFor(c.userId);
    let ok = false;
    if (factors.length === 0) ok = !b.totpCode && !b.webauthnAssertion && !b.recoveryCode;
    else if (b.totpCode) ok = await this.auth.totpVerify(c.userId, b.totpCode);
    else if (b.webauthnAssertion) ok = await this.auth.webauthnAuthVerify(c.userId, b.webauthnAssertion);
    else if (b.recoveryCode) { ok = await this.auth.useRecoveryCode(c.userId, b.recoveryCode); if (ok) await this.repo.auditStandalone({ ...ctx, actor: { ...ANON_ACTOR, userId: c.userId } }, { action: 'auth.recovery.use', outcome: 'success' }); }
    if (!ok) {
      await this.auth.failChallenge(b.challengeToken);
      await this.repo.auditStandalone({ ...ctx, actor: { ...ANON_ACTOR, userId: c.userId } }, { action: 'auth.mfa.fail', outcome: 'denied' });
      throw new DomainError('UNAUTHENTICATED');
    }
    await this.auth.consumeChallenge(b.challengeToken);
    const roles = await this.auth.activeRolesFor(c.userId);
    if (roles.length === 0) throw new DomainError('UNAUTHENTICATED');
    const u = await this.auth.profileFor(c.userId);
    if (!u) throw new DomainError('UNAUTHENTICATED');
    const sess = await this.auth.createSession(c.userId, { mfaAt: factors.length ? this.clock.now().getTime() : null, ipHash, roles, displayName: u.displayName, locale: u.locale });
    await this.auth.recordLoginSuccess(c.userId);
    const role = roles[0]!.role;
    await this.repo.auditStandalone({ ...ctx, actor: { userId: c.userId, role, roles: roles.map((r) => r.role), centerId: roles[0]!.centerId } }, { action: 'auth.login.success', outcome: 'success' });
    return sess;
  }
  view(s: SessionRecord): SessionView {
    const now = this.clock.now().getTime();
    return {
      userId: s.userId, displayName: s.displayName, locale: s.locale, roles: s.roles, activeCenterId: s.roles.find((r) => r.role === 'center_clinician')?.centerId ?? null,
      expiresAt: new Date(sessionExpiresAt(s, s.roles.map((r) => r.role))).toISOString(), csrfToken: s.csrfToken, stepUpFresh: stepUpFresh(s.mfaAt, now), mfaEnrolled: s.mfaAt !== null,
    };
  }
  async register(b: { email: string; password: string; displayName: string; institution: string; isIsraeliAcademic: boolean; locale?: 'he' | 'en' }, traceId: string): Promise<void> {
    const email = b.email.trim().toLowerCase();
    const problem = this.auth.checkPasswordPolicy(b.password);
    if (problem) throw new DomainError('VALIDATION_FAILED', [{ field: 'password', rule: problem }]);
    const ctx = this.sys(traceId, null);
    const hash = await this.auth.hashPassword(b.password);     // always hash: same timing for known and unknown email
    const created = await this.repo.tx(ctx, async (tx) => {
      const r = await tx.users.registerResearcher({ email, displayName: b.displayName.trim(), institution: b.institution.trim(), isIsraeliAcademic: b.isIsraeliAcademic, locale: b.locale ?? 'he' });
      if (r) await this.notify.enqueue(tx, { template: 'verify_email', toEmail: email, locale: b.locale ?? 'he', params: { link: `${this.origin}/verify-email?token=${r.userId}.${r.verificationToken}` } });
      return r;
    });
    if (!created) return;
    await this.auth.storePasswordHash(created.userId, hash);
  }
  async verifyEmail(token: string, password: string | undefined, traceId: string): Promise<void> {
    const ctx = this.sys(traceId, null);
    let userId: string | null = null; let invite = false;
    if (token.startsWith('usr_')) {
      const [uid, raw] = token.split('.', 2);
      const ok = uid && raw ? await this.repo.tx(ctx, (tx) => tx.users.verifyEmail(uid, raw)) : false;
      userId = ok ? uid! : null;
    } else { userId = await this.auth.consumeEmailToken(token, 'invite'); invite = true; }
    if (!userId) throw new DomainError('VALIDATION_FAILED', [{ field: 'token', rule: 'FORMAT' }]);
    if (invite) {
      if (!password) throw new DomainError('VALIDATION_FAILED', [{ field: 'password', rule: 'REQUIRED' }]);
      const p = this.auth.checkPasswordPolicy(password); if (p) throw new DomainError('VALIDATION_FAILED', [{ field: 'password', rule: p }]);
      await this.auth.setPassword(userId, password);
    }
    if (invite) await this.auth.markEmailVerified(userId, true);
    await this.repo.auditStandalone({ ...ctx, actor: { ...ANON_ACTOR, userId } }, { action: 'auth.password.change', outcome: 'success', details: { via: invite ? 'invite' : 'verify' } });
  }
  async me(ctx: Ctx, s: SessionRecord) {
    const u = await this.repo.tx(ctx, (tx) => tx.users.getById(s.userId));
    if (!u) throw new DomainError('NOT_FOUND');
    const factors = await this.auth.mfaFactorsFor(s.userId);
    return { id: u.id, email: u.email, displayName: u.displayName, locale: u.locale, roles: s.roles, factors, mfaRequiredSetup: factors.length === 0 };
  }
  async updateMe(ctx: Ctx, s: SessionRecord, p: { displayName?: string; locale?: 'he' | 'en' }) {
    await this.repo.tx(ctx, (tx) => tx.users.updateSelf(s.userId, p));
    return this.me(ctx, s);
  }
  async changePassword(s: SessionRecord, current: string, next: string, traceId: string, ipHash: string | null): Promise<SessionRecord> {
    const profile = await this.auth.profileFor(s.userId); if (!profile) throw new DomainError('NOT_FOUND');
    const ok = await this.auth.verifyPassword(profile.email, current);
    if (!ok || !('userId' in ok)) throw new DomainError('VALIDATION_FAILED', [{ field: 'currentPassword', rule: 'FORMAT' }]);
    const p = this.auth.checkPasswordPolicy(next, profile.email); if (p) throw new DomainError('VALIDATION_FAILED', [{ field: 'newPassword', rule: p }]);
    await this.auth.setPassword(s.userId, next);
    await this.auth.revokeAllForUser(s.userId);
    const fresh = await this.auth.createSession(s.userId, { mfaAt: s.mfaAt, ipHash, roles: s.roles, displayName: s.displayName, locale: s.locale });
    await this.repo.auditStandalone({ ...this.sys(traceId, ipHash), actor: { ...ANON_ACTOR, userId: s.userId } }, { action: 'auth.password.change', outcome: 'success' });
    return fresh;
  }
  async stepUp(s: SessionRecord, b: { totpCode?: string; recoveryCode?: string; webauthnAssertion?: unknown }, traceId: string): Promise<SessionRecord> {
    let ok = false;
    if (b.totpCode) ok = await this.auth.totpVerify(s.userId, b.totpCode);
    else if (b.webauthnAssertion) ok = await this.auth.webauthnAuthVerify(s.userId, b.webauthnAssertion);
    else if (b.recoveryCode) ok = await this.auth.useRecoveryCode(s.userId, b.recoveryCode);
    if (!ok) {
      await this.repo.auditStandalone({ ...this.sys(traceId, null), actor: { ...ANON_ACTOR, userId: s.userId } }, { action: 'auth.mfa.fail', outcome: 'denied', details: { via: 'step_up' } });
      throw new DomainError('UNAUTHENTICATED');
    }
    await this.auth.stepUpSession(s.id, this.clock.now().getTime());
    return (await this.auth.getSession(s.id)) ?? s;
  }
  async enrollTotpStart(s: SessionRecord) {
    const p = await this.auth.profileFor(s.userId); if (!p) throw new DomainError('NOT_FOUND');
    return this.auth.totpBegin(s.userId, p.email);
  }
  async enrollTotpConfirm(s: SessionRecord, code: string, traceId: string): Promise<{ recoveryCodes: string[] }> {
    const first = (await this.auth.mfaFactorsFor(s.userId)).length === 0;
    if (!(await this.auth.totpConfirm(s.userId, code))) throw new DomainError('UNAUTHENTICATED');
    await this.auth.stepUpSession(s.id, this.clock.now().getTime());
    await this.repo.auditStandalone({ ...this.sys(traceId, null), actor: { ...ANON_ACTOR, userId: s.userId } }, { action: 'auth.mfa.enroll', outcome: 'success', details: { factor: 'totp' } });
    return { recoveryCodes: first ? await this.auth.issueRecoveryCodes(s.userId) : [] };
  }
  async webauthnRegisterOptions(s: SessionRecord) {
    const p = await this.auth.profileFor(s.userId); if (!p) throw new DomainError('NOT_FOUND');
    return this.auth.webauthnRegistrationOptions(s.userId, p.email);
  }
  async webauthnRegisterVerify(s: SessionRecord, response: unknown, traceId: string): Promise<{ recoveryCodes: string[] }> {
    const first = (await this.auth.mfaFactorsFor(s.userId)).length === 0;
    if (!(await this.auth.webauthnRegistrationVerify(s.userId, response))) throw new DomainError('UNAUTHENTICATED');
    await this.auth.stepUpSession(s.id, this.clock.now().getTime());
    await this.repo.auditStandalone({ ...this.sys(traceId, null), actor: { ...ANON_ACTOR, userId: s.userId } }, { action: 'auth.mfa.enroll', outcome: 'success', details: { factor: 'webauthn' } });
    return { recoveryCodes: first ? await this.auth.issueRecoveryCodes(s.userId) : [] };
  }
  async regenerateRecoveryCodes(s: SessionRecord): Promise<{ recoveryCodes: string[] }> {
    if (!stepUpFresh(s.mfaAt, this.clock.now().getTime())) throw new DomainError('STEP_UP_REQUIRED');
    return { recoveryCodes: await this.auth.issueRecoveryCodes(s.userId) };
  }
  async logout(ctx: Ctx, s: SessionRecord): Promise<void> {
    await this.auth.revokeSession(s.id);
    await this.repo.auditStandalone(ctx, { action: 'auth.logout', outcome: 'success' });
  }
  async extend(s: SessionRecord): Promise<SessionRecord> { await this.auth.touchSession(s.id, this.clock.now().getTime()); return (await this.auth.getSession(s.id)) ?? s; }

  // ----- registration approval (coordinator) -----
  async pendingRegistrations(ctx: Ctx) { return this.repo.tx(ctx, (tx) => tx.users.pendingRegistrations(100)); }
  async approveRegistration(ctx: Ctx, userId: string): Promise<UserRecord> {
    return this.repo.tx(ctx, async (tx) => {
      const reg = await tx.users.registrationFlag(userId);
      if (!reg) throw new DomainError('NOT_FOUND');
      const u = await tx.users.getById(userId); if (!u) throw new DomainError('NOT_FOUND');
      if (!u.emailVerifiedAt || u.status !== 'invited') throw new DomainError('CONFLICT');
      const role = researcherRoleFor(reg.isIsraeliAcademic);
      await tx.users.approveRegistration(userId);      // grants the researcher role, activates the user, audits (database function)
      await this.notify.enqueue(tx, { template: 'registration_approved', toUserId: userId, locale: u.locale });
      return (await tx.users.getById(userId))!;
    });
  }
  async rejectRegistration(ctx: Ctx, userId: string): Promise<void> {
    await this.repo.tx(ctx, async (tx) => {
      const u = await tx.users.getById(userId); if (!u || !(await tx.users.registrationFlag(userId))) throw new DomainError('NOT_FOUND');
      await tx.users.rejectRegistration(userId);
      await this.notify.enqueue(tx, { template: 'registration_rejected', toUserId: userId, locale: u.locale });
    });
  }
  invalidRole(r: string): r is Role { return isRole(r); }
  sod(existing: Role[], adding: Role): boolean { return violatesSeparationOfDuties(existing, adding); }
  newToken(): string { return randomToken(); }
  institution(email: string): string | null { return institutionOf(email); }
}
