import {
  DomainError, ANON_ACTOR, sessionExpiresAt, stepUpFresh, type AuthPort, type Clock, type Ctx, type Repository,
  type RoleAssignmentRecord, type SessionRecord, type NotifyPort, type Role, type UserRecord, isRole, violatesSeparationOfDuties,
} from '@ari/domain';
import { nid, institutionOf } from '../../lib/util.js';
import { randomToken } from '../../lib/crypto.js';

export interface SessionView { centerId: string | null; userId: string; displayName: string; locale: 'he' | 'en'; roles: RoleAssignmentRecord[]; activeCenterId: string | null; expiresAt: string; csrfToken: string; stepUpFresh: boolean; mfaEnrolled: boolean }

export class IdentityService {
  constructor(private repo: Repository, private auth: AuthPort, private notify: NotifyPort, private clock: Clock, private origin: string) {}
  private sys(traceId: string, ipHash: string | null | undefined): Ctx { return { actor: ANON_ACTOR, traceId, ipHash: ipHash ?? null }; }

  async login(email: string, password: string, traceId: string, ipHash: string | null) {
    const ctx = this.sys(traceId, ipHash);
    const norm = email.trim().toLowerCase();
    const r = await this.auth.verifyPassword(norm, password);
    if (!r || 'locked' in r && r.locked && !('userId' in r)) {
      // R-07: a locked account answers exactly like an unknown address or a wrong password (401), so the answer
      // does not tell that the address exists. The lock-out stays internal; the audit event records the reason.
      await this.repo.auditStandalone(ctx, { action: 'auth.login.fail', outcome: 'denied', details: { reason: r ? 'locked' : 'credentials' } });
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
    // R-05: consume the challenge atomically. Only the request whose DELETE returns the row may create a session,
    // so parallel requests with two valid factors cannot turn one password step into two sessions.
    const won = await this.auth.consumeChallenge(b.challengeToken);
    if (!won || won.userId !== c.userId) {
      await this.repo.auditStandalone({ ...ctx, actor: { ...ANON_ACTOR, userId: c.userId } }, { action: 'auth.mfa.fail', outcome: 'denied', details: { reason: 'challenge_used' } });
      throw new DomainError('UNAUTHENTICATED');
    }
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
      userId: s.userId, displayName: s.displayName, locale: s.locale, roles: s.roles, activeCenterId: s.roles.find((r) => r.role === 'center_clinician')?.centerId ?? null, centerId: s.roles.find((r) => r.role === 'center_clinician')?.centerId ?? null,
      expiresAt: new Date(sessionExpiresAt(s, s.roles.map((r) => r.role))).toISOString(), csrfToken: s.csrfToken, stepUpFresh: stepUpFresh(s.mfaAt, now), mfaEnrolled: s.mfaAt !== null,
    };
  }
  async register(b: { email: string; password?: string; displayName: string; institution: string; termsVersion: string; isIsraeliAcademic?: boolean; locale?: 'he' | 'en' }, traceId: string): Promise<void> {
    const email = b.email.trim().toLowerCase();
    if (b.password) { const problem = this.auth.checkPasswordPolicy(b.password, email); if (problem) throw new DomainError('VALIDATION_FAILED', [{ field: 'password', rule: problem }]); }
    const ctx = this.sys(traceId, null);
    const hash = await this.auth.hashPassword(b.password ?? randomToken(16));     // always hash: same timing for known and unknown email
    const il = b.isIsraeliAcademic ?? /\.ac\.il$/i.test(email);
    const created = await this.repo.tx(ctx, async (tx) => {
      const r = await tx.users.registerResearcher({ email, displayName: b.displayName.trim(), institution: b.institution.trim(), isIsraeliAcademic: il, locale: b.locale ?? 'he' });
      if (r) await this.notify.enqueue(tx, { template: 'verify_email', toEmail: email, locale: b.locale ?? 'he', params: { link: `${this.origin}/verify-email?token=${r.userId}.${r.verificationToken}` } });
      return r;
    });
    if (!created) return;
    if (b.password) await this.auth.storePasswordHash(created.userId, hash);
    await this.auth.saveRegistrationMeta(created.userId, b.institution.trim(), b.termsVersion);
  }
  async verifyEmail(token: string, password: string | undefined, traceId: string): Promise<void> {
    const ctx = this.sys(traceId, null);
    let userId: string | null = null; let invite = false;
    if (token.startsWith('usr_')) {
      const [uid, raw] = token.split('.', 2);
      const ok = uid && raw ? await this.repo.tx(ctx, (tx) => tx.users.verifyEmail(uid, raw)) : false;
      userId = ok ? uid! : null;
      if (userId && password) { const p = this.auth.checkPasswordPolicy(password); if (p) throw new DomainError('VALIDATION_FAILED', [{ field: 'password', rule: p }]); await this.auth.setPassword(userId, password); }
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
  /** Adding a factor to an account that already has one needs a fresh step-up. Otherwise a stolen, older session could
   *  replace the TOTP secret or add its own passkey and keep access. The first factor (enrolment-only session) needs none. */
  private async requireStepUpIfEnrolled(s: SessionRecord): Promise<boolean> {
    const first = (await this.auth.mfaFactorsFor(s.userId)).length === 0;
    if (!first && !stepUpFresh(s.mfaAt, this.clock.now().getTime())) throw new DomainError('STEP_UP_REQUIRED');
    return first;
  }
  async enrollTotpStart(s: SessionRecord) {
    await this.requireStepUpIfEnrolled(s);
    const p = await this.auth.profileFor(s.userId); if (!p) throw new DomainError('NOT_FOUND');
    return this.auth.totpBegin(s.userId, p.email);
  }
  async enrollTotpConfirm(s: SessionRecord, code: string, traceId: string): Promise<{ recoveryCodes: string[] }> {
    const first = await this.requireStepUpIfEnrolled(s);
    if (!(await this.auth.totpConfirm(s.userId, code))) throw new DomainError('UNAUTHENTICATED');
    await this.auth.stepUpSession(s.id, this.clock.now().getTime());
    await this.repo.auditStandalone({ ...this.sys(traceId, null), actor: { ...ANON_ACTOR, userId: s.userId } }, { action: 'auth.mfa.enroll', outcome: 'success', details: { factor: 'totp' } });
    return { recoveryCodes: first ? await this.auth.issueRecoveryCodes(s.userId) : [] };
  }
  async webauthnRegisterOptions(s: SessionRecord) {
    await this.requireStepUpIfEnrolled(s);
    const p = await this.auth.profileFor(s.userId); if (!p) throw new DomainError('NOT_FOUND');
    return this.auth.webauthnRegistrationOptions(s.userId, p.email);
  }
  async webauthnRegisterVerify(s: SessionRecord, response: unknown, name: string, traceId: string): Promise<{ recoveryCodes: string[] }> {
    const first = await this.requireStepUpIfEnrolled(s);
    if (!(await this.auth.webauthnRegistrationVerify(s.userId, response, name))) throw new DomainError('UNAUTHENTICATED');
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
  async registrations(ctx: Ctx) { return (await this.repo.tx(ctx, (tx) => tx.users.registrations(200))).map(({ isIsraeliAcademic: _i, ...r }) => r); }
  async decideRegistration(ctx: Ctx, userId: string, outcome: 'approved' | 'rejected') {
    await this.repo.tx(ctx, async (tx) => {
      const reg = (await tx.users.registrations(500)).find((r) => r.id === userId);
      if (!reg) throw new DomainError('NOT_FOUND');
      if (reg.status !== 'pending') throw new DomainError('CONFLICT');
      const u = await tx.users.getById(userId); if (!u) throw new DomainError('NOT_FOUND');
      if (outcome === 'approved') {
        if (!u.emailVerifiedAt || u.status !== 'invited') throw new DomainError('CONFLICT');
        await tx.users.approveRegistration(userId);       // grants the researcher role, activates, audits (database function)
        await this.notify.enqueue(tx, { template: 'registration_approved', toUserId: userId, locale: u.locale });
      } else {
        await tx.users.rejectRegistration(userId);
        await this.notify.enqueue(tx, { template: 'registration_rejected', toUserId: userId, locale: u.locale });
      }
    });
    return this.repo.tx(ctx, async (tx) => { const r = (await tx.users.registrations(500)).find((x) => x.id === userId)!; const { isIsraeliAcademic: _i, ...rest } = r; return rest; });
  }
  async methods(s: SessionRecord) { return this.auth.listMethods(s.userId); }
  invalidRole(r: string): r is Role { return isRole(r); }
  sod(existing: Role[], adding: Role): boolean { return violatesSeparationOfDuties(existing, adding); }
  newToken(): string { return randomToken(); }
  institution(email: string): string | null { return institutionOf(email); }
}
