import {
  DomainError, K_FLOOR, isExternalRole, validateCommitteeConfig, validateK, violatesSeparationOfDuties, type AuthPort, type Clock, type Ctx,
  type NotifyPort, type Repository, type Role, type CenterRecord, type ApprovalRecord,
} from '@ari/domain';
import { nid, notFound } from '../../lib/util.js';

const PRIVILEGED: readonly Role[] = ['system_admin', 'national_coordinator', 'committee_member', 'center_clinician'];

export class AdminService {
  constructor(private repo: Repository, private auth: AuthPort, private notify: NotifyPort, private clock: Clock, private origin: string) {}

  // ----- users -----
  async listUsers(ctx: Ctx, q: { status?: string; cursor?: string; limit?: number }) {
    return this.repo.tx(ctx, (tx) => tx.users.list({ ...q, limit: q.limit ?? 25, researchersOnly: ctx.actor.role === 'national_coordinator' }));
  }
  async getUser(ctx: Ctx, id: string) {
    return this.repo.tx(ctx, async (tx) => {
      const u = await tx.users.getById(id); if (!u) throw notFound();
      if (ctx.actor.role === 'national_coordinator' && !u.roles.every((r) => isExternalRole(r.role)) && u.roles.length) throw notFound();
      return u;
    });
  }
  async invite(ctx: Ctx, b: { email: string; displayName: string; locale?: 'he' | 'en'; role: Role; centerId?: string }) {
    if (b.role === 'center_clinician' && !b.centerId) throw new DomainError('VALIDATION_FAILED', [{ field: 'centerId', rule: 'REQUIRED' }]);
    if (b.role !== 'center_clinician' && b.centerId) throw new DomainError('VALIDATION_FAILED', [{ field: 'centerId', rule: 'FORMAT' }]);
    if (!PRIVILEGED.includes(b.role)) throw new DomainError('VALIDATION_FAILED', [{ field: 'role', rule: 'VOCAB' }]);   // researchers register themselves
    const email = b.email.trim().toLowerCase();
    const out = await this.repo.tx(ctx, async (tx) => {
      if (await tx.users.getByEmail(email)) throw new DomainError('CONFLICT');
      if (b.centerId && !(await tx.centers.get(b.centerId))) throw new DomainError('VALIDATION_FAILED', [{ field: 'centerId', rule: 'VOCAB' }]);
      const u = await tx.users.create({ email, displayName: b.displayName.trim(), locale: b.locale ?? 'he', status: 'invited' });
      const pending = await tx.governance.propose({ id: nid(this.clock, 'role'), kind: 'role_grant', payload: { userId: u.id, role: b.role, centerId: b.centerId ?? null }, proposedBy: ctx.actor.userId! });
      return { id: u.id, pending };
    });
    const token = await this.auth.issueEmailToken(out.id, 'invite');
    await this.repo.tx(ctx, (tx) => this.notify.enqueue(tx, { template: 'invite', toUserId: out.id, toEmail: email, locale: b.locale ?? 'he', params: { link: `${this.origin}/invite/${token}` } }));
    return this.repo.tx(ctx, async (tx) => (await tx.users.getById(out.id))!);
  }
  async updateUser(ctx: Ctx, id: string, p: { displayName?: string; status?: 'active' | 'suspended' | 'closed' }) {
    const u = await this.repo.tx(ctx, async (tx) => {
      const cur = await tx.users.getById(id); if (!cur) throw notFound();
      if (id === ctx.actor.userId && p.status && p.status !== 'active') throw new DomainError('SOD_VIOLATION');
      const next = await tx.users.update(id, p); if (!next) throw notFound();
      if (p.status === 'suspended' || p.status === 'closed') await tx.audit.record(ctx, { action: 'user.disable', outcome: 'success', objectType: 'user', objectId: id });
      else if (p.status === 'active') await tx.audit.record(ctx, { action: 'user.enable', outcome: 'success', objectType: 'user', objectId: id });
      return next;
    });
    if (p.status === 'suspended' || p.status === 'closed') await this.auth.revokeAllForUser(id);   // suspension ends sessions at once
    return u;
  }
  async grantRole(ctx: Ctx, userId: string, b: { role: Role; centerId?: string; reason?: string }): Promise<{ approval: ApprovalRecord }> {
    if (!PRIVILEGED.includes(b.role)) throw new DomainError('VALIDATION_FAILED', [{ field: 'role', rule: 'VOCAB' }]);   // researcher roles come from registration approval
    if ((b.role === 'center_clinician') !== Boolean(b.centerId)) throw new DomainError('VALIDATION_FAILED', [{ field: 'centerId', rule: b.centerId ? 'FORMAT' : 'REQUIRED' }]);
    return this.repo.tx(ctx, async (tx) => {
      const u = await tx.users.getById(userId); if (!u) throw notFound();
      if (violatesSeparationOfDuties(u.roles.map((r) => r.role), b.role)) throw new DomainError('SOD_VIOLATION');
      if (b.centerId && !(await tx.centers.get(b.centerId))) throw new DomainError('VALIDATION_FAILED', [{ field: 'centerId', rule: 'VOCAB' }]);
      const a = await tx.governance.propose({ id: nid(this.clock, 'role'), kind: 'role_grant', payload: { userId, role: b.role, centerId: b.centerId ?? null, ...(b.reason ? { reason: b.reason } : {}) }, proposedBy: ctx.actor.userId! });
      return { approval: a };
    });
  }
  async revokeRole(ctx: Ctx, userId: string, assignmentId: string) {
    await this.repo.tx(ctx, async (tx) => {
      const u = await tx.users.getById(userId); if (!u) throw notFound();
      const a = u.roles.find((r) => r.id === assignmentId);
      if (!a) throw notFound();
      if (a.role === 'system_admin' && userId === ctx.actor.userId) throw new DomainError('SOD_VIOLATION');
      if (!(await tx.users.revokeRole(userId, assignmentId))) throw notFound();
      await tx.audit.record(ctx, { action: 'role.revoke', outcome: 'success', objectType: 'user', objectId: userId, details: { role: a.role } });
    });
    await this.auth.revokeAllForUser(userId);
  }

  // ----- second approver -----
  async config(ctx: Ctx) {
    return this.repo.tx(ctx, async (tx) => ({ kPolicies: ctx.actor.role === 'system_admin' ? await tx.governance.getKPolicies() : [], committee: await tx.requests.committeeConfig() }));
  }
  async proposeK(ctx: Ctx, b: { fieldSet: string; k: number; reason?: string }): Promise<ApprovalRecord> {
    if (!validateK(b.k)) throw new DomainError('VALIDATION_FAILED', [{ field: 'k', rule: `RANGE_MIN_${K_FLOOR}` }]);
    return this.repo.tx(ctx, async (tx) => {
      return tx.governance.propose({ id: nid(this.clock, 'role'), kind: 'k_change', payload: { fieldSet: b.fieldSet, k: b.k, ...(b.reason ? { reason: b.reason } : {}) }, proposedBy: ctx.actor.userId! });
    });
  }
  async proposeCommittee(ctx: Ctx, b: { votesNeeded: number; membersTotal: number }): Promise<ApprovalRecord> {
    if (!validateCommitteeConfig(b)) throw new DomainError('VALIDATION_FAILED', [{ field: 'votesNeeded', rule: 'RANGE' }]);
    return this.repo.tx(ctx, async (tx) => {
      return tx.governance.propose({ id: nid(this.clock, 'role'), kind: 'committee_config', payload: { ...b }, proposedBy: ctx.actor.userId! });
    });
  }
  async approvals(ctx: Ctx) { return this.repo.tx(ctx, (tx) => tx.governance.listApprovals()); }
  /** The database applies the change (role grant, k, committee config) and enforces: proposer differs, approver role, step-up age. */
  async decide(ctx: Ctx, id: string, approve: boolean, stepUpAgeS: number): Promise<ApprovalRecord> {
    let affectedUser: string | null = null;
    const a = await this.repo.tx(ctx, async (tx) => {
      const cur = await tx.governance.getApproval(id); if (!cur) throw notFound();
      if (cur.status !== 'pending') throw new DomainError('CONFLICT');
      if (cur.proposedBy === ctx.actor.userId) throw new DomainError('SECOND_APPROVER_REQUIRED');
      if (cur.kind === 'role_grant' && approve) affectedUser = (cur.payload as { userId?: string }).userId ?? null;
      const done = await tx.governance.decide(id, ctx.actor.userId!, approve, stepUpAgeS); if (!done) throw new DomainError('CONFLICT');
      return done;
    });
    if (affectedUser) await this.auth.revokeAllForUser(affectedUser);
    return a;
  }

  // ----- web-facing views (k policies, role-grant requests) over the same two-person changes -----
  private kView(policy: { fieldSet: string; k: number }, approvals: ApprovalRecord[]) {
    const p = approvals.find((a) => a.kind === 'k_change' && a.status === 'pending' && (a.payload as { fieldSet?: string }).fieldSet === policy.fieldSet);
    const pl = p?.payload as { k?: number; reason?: string } | undefined;
    return { id: policy.fieldSet, fieldSet: policy.fieldSet, k: policy.k, pendingChange: p ? { id: p.id, proposedK: pl!.k!, proposedByUserId: p.proposedBy, reason: pl?.reason ?? '' } : null };
  }
  async kPolicies(ctx: Ctx) {
    return this.repo.tx(ctx, async (tx) => { const [ps, ap] = await Promise.all([tx.governance.getKPolicies(), tx.governance.listApprovals('pending')]); return ps.map((p) => this.kView(p, ap)); });
  }
  async proposeKPolicy(ctx: Ctx, fieldSet: string, b: { k: number; reason: string }) {
    await this.proposeK(ctx, { fieldSet, k: b.k, reason: b.reason });
    return this.repo.tx(ctx, async (tx) => this.kView((await tx.governance.getKPolicies()).find((p) => p.fieldSet === fieldSet) ?? { fieldSet, k: 5 }, await tx.governance.listApprovals('pending')));
  }
  async approveKChange(ctx: Ctx, changeId: string, age: number) {
    const cur = await this.repo.tx(ctx, (tx) => tx.governance.getApproval(changeId));
    if (!cur || cur.kind !== 'k_change') throw notFound();
    await this.decide(ctx, changeId, true, age);
    const fs = (cur.payload as { fieldSet: string }).fieldSet;
    return this.repo.tx(ctx, async (tx) => this.kView((await tx.governance.getKPolicies()).find((p) => p.fieldSet === fs) ?? { fieldSet: fs, k: 5 }, await tx.governance.listApprovals('pending')));
  }
  private grantView(a: ApprovalRecord) {
    const p = a.payload as { userId: string; role: Role; centerId: string | null; reason?: string };
    return { id: a.id, userId: p.userId, role: p.role, centerId: p.centerId ?? null, reason: p.reason ?? '', requestedByUserId: a.proposedBy, status: a.status, requestedAt: a.createdAt };
  }
  async roleGrants(ctx: Ctx) { return (await this.repo.tx(ctx, (tx) => tx.governance.listApprovals())).filter((a) => a.kind === 'role_grant').map((a) => this.grantView(a)); }
  async createRoleGrant(ctx: Ctx, b: { userId: string; role: Role; centerId?: string; reason: string }) {
    return this.grantView((await this.grantRole(ctx, b.userId, { role: b.role, ...(b.centerId ? { centerId: b.centerId } : {}), reason: b.reason })).approval);
  }
  async decideRoleGrant(ctx: Ctx, id: string, outcome: 'approved' | 'rejected', age: number) {
    const cur = await this.repo.tx(ctx, (tx) => tx.governance.getApproval(id));
    if (!cur || cur.kind !== 'role_grant') throw notFound();
    return this.grantView(await this.decide(ctx, id, outcome === 'approved', age));
  }

  // ----- centers -----
  async createCenter(ctx: Ctx, b: { code?: string; nameEn?: string; nameHe?: string; isActive?: boolean; contactRole?: string; contactChannel?: string; localSystemRef?: string }): Promise<CenterRecord> {
    const miss = (['code', 'nameEn', 'nameHe', 'contactRole'] as const).filter((k) => !b[k]);
    if (miss.length) throw new DomainError('VALIDATION_FAILED', miss.map((field) => ({ field, rule: 'REQUIRED' })));
    return this.repo.tx(ctx, async (tx) => {
      if (await tx.centers.byCode(b.code!)) throw new DomainError('CONFLICT');
      const c = await tx.centers.create({ id: nid(this.clock, 'center'), code: b.code!, nameEn: b.nameEn!, nameHe: b.nameHe!, isActive: b.isActive ?? true, contactRole: b.contactRole!, contactChannel: b.contactChannel ?? null, localSystemRef: b.localSystemRef ?? null });
      await tx.audit.record(ctx, { action: 'config.change', outcome: 'success', objectType: 'center', objectId: c.id });
      return c;
    });
  }
  async updateCenter(ctx: Ctx, id: string, p: Partial<CenterRecord>): Promise<CenterRecord> {
    return this.repo.tx(ctx, async (tx) => {
      const c = await tx.centers.update(id, p); if (!c) throw notFound();
      await tx.audit.record(ctx, { action: 'config.change', outcome: 'success', objectType: 'center', objectId: id, details: { fields: Object.keys(p) } });
      return c;
    });
  }
  // ----- metrics (REQ-066). Counts only. -----
  async metrics(ctx: Ctx) {
    return this.repo.tx(ctx, async (tx) => {
      const [m, byStatus] = await Promise.all([tx.governance.metrics(), tx.requests.countsByStatus()]);
      return { ...m, requestsByStatus: byStatus };
    });
  }
  async outbox(ctx: Ctx) { return this.repo.tx(ctx, (tx) => tx.outbox.list(100)); }
}
