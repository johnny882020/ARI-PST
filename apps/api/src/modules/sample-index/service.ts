import { DomainError, validateSample, type Clock, type Ctx, type Repository, type SampleInput, type SamplePatch, type FieldIssue, type CenterRecord } from '@ari/domain';
import { nid, notFound } from '../../lib/util.js';

export class SampleService {
  constructor(private repo: Repository, private clock: Clock) {}

  async create(ctx: Ctx, body: Record<string, unknown>) {
    const issues = validateSample(body, 'create');
    if (issues.length) throw new DomainError('VALIDATION_FAILED', issues);
    const input = body as unknown as SampleInput;
    return this.repo.tx(ctx, async (tx) => {
      const extra = await this.crossChecks(tx, input.sourceCenterId, input.diagnosisCode, input.ethicsApprovalId ?? null);
      if (extra.length) throw new DomainError('VALIDATION_FAILED', extra);
      const id = nid(this.clock, 'sample');
      const s = await tx.samples.insert(id, { ...input, attachedData: input.attachedData ?? [], consentStatus: input.consentStatus ?? 'unknown' }, ctx.actor.userId!);
      await tx.audit.record(ctx, { action: 'sample.create', outcome: 'success', objectType: 'sample', objectId: id, centerId: s.sourceCenterId });
      return s;
    });
  }
  private async crossChecks(tx: import('@ari/domain').Tx, centerId: string, dx: string | undefined, ethicsId: string | null): Promise<FieldIssue[]> {
    const out: FieldIssue[] = [];
    const c = await tx.centers.get(centerId); if (!c || !c.isActive) out.push({ field: 'sourceCenterId', rule: 'VOCAB' });
    if (dx !== undefined && !(await tx.samples.diagnosisExists(dx))) out.push({ field: 'diagnosisCode', rule: 'VOCAB' });
    if (ethicsId) {
      const list = await tx.centers.ethicsList(centerId);
      if (!list.some((e) => e.id === ethicsId)) out.push({ field: 'ethicsApprovalId', rule: 'CENTER_MISMATCH' });
    }
    return out;
  }
  async get(ctx: Ctx, id: string) {
    return this.repo.tx(ctx, async (tx) => {
      const r = await tx.samples.get(id);
      if (!r) throw notFound();                // clinician of another center: RLS hides the row -> 404, existence not leaked
      await tx.audit.record(ctx, { action: 'sample.view', outcome: 'success', objectType: 'sample', objectId: id, centerId: r.sample.sourceCenterId });
      return r;
    });
  }
  async list(ctx: Ctx, q: { centerId?: string; diagnosisCode?: string; sampleType?: string; availability?: string; staleness?: 'fresh' | 'due_soon' | 'stale'; cursor?: string; limit?: number }) {
    return this.repo.tx(ctx, async (tx) => {
      const query = { ...q, limit: q.limit ?? 25 };
      // A clinician is always pinned to the own center, whatever the client sends.
      if (ctx.actor.role === 'center_clinician') query.centerId = ctx.actor.centerId ?? '__none__';
      const page = await tx.samples.list(query);
      await tx.audit.record(ctx, { action: 'sample.view', outcome: 'success', objectType: 'sample_list', details: { count: page.items.length } });
      return page;
    });
  }
  async update(ctx: Ctx, id: string, patch: Record<string, unknown>, ifMatch: string | null) {
    if (!ifMatch) throw new DomainError('VALIDATION_FAILED', [{ field: 'If-Match', rule: 'REQUIRED' }]);
    const issues = validateSample(patch, 'patch');
    if (issues.length) throw new DomainError('VALIDATION_FAILED', issues);
    return this.repo.tx(ctx, async (tx) => {
      const cur = await tx.samples.get(id); if (!cur) throw notFound();
      const extra = await this.crossChecks(tx, cur.sample.sourceCenterId, (patch as SamplePatch).diagnosisCode, ((patch as SamplePatch).ethicsApprovalId as string | null | undefined) ?? null);
      if (extra.length) throw new DomainError('VALIDATION_FAILED', extra);
      const r = await tx.samples.update(id, patch as SamplePatch, ifMatch);
      if (r === 'etag_mismatch') throw new DomainError('ETAG_MISMATCH');
      if (!r) throw notFound();
      await tx.audit.record(ctx, { action: 'sample.update', outcome: 'success', objectType: 'sample', objectId: id, centerId: cur.sample.sourceCenterId, details: { fields: Object.keys(patch) } });
      return r;
    });
  }
  async verify(ctx: Ctx, id: string) {
    return this.repo.tx(ctx, async (tx) => {
      const s = await tx.samples.verify(id); if (!s) throw notFound();
      await tx.audit.record(ctx, { action: 'sample.update', outcome: 'success', objectType: 'sample', objectId: id, centerId: s.sourceCenterId, details: { fields: ['lastVerifiedAt'] } });
      return s;
    });
  }
  async flag(ctx: Ctx, id: string, reason: string) {
    await this.repo.tx(ctx, async (tx) => {
      const cur = await tx.samples.get(id); if (!cur) throw notFound();
      await tx.samples.flag(id, ctx.actor.userId!, reason);
      await tx.audit.record(ctx, { action: 'sample.update', outcome: 'success', objectType: 'sample', objectId: id, centerId: cur.sample.sourceCenterId, details: { flag: reason } });
    });
  }
  async retire(ctx: Ctx, id: string) {
    await this.repo.tx(ctx, async (tx) => {
      const cur = await tx.samples.get(id); if (!cur) throw notFound();
      if (!(await tx.samples.retire(id))) throw notFound();
      await tx.audit.record(ctx, { action: 'sample.void', outcome: 'success', objectType: 'sample', objectId: id, centerId: cur.sample.sourceCenterId });
    });
  }
  // ----- centers (read) and ethics approvals -----
  async listCenters(ctx: Ctx): Promise<CenterRecord[]> { return this.repo.tx(ctx, (tx) => tx.centers.list()); }
  async getCenter(ctx: Ctx, id: string) { return this.repo.tx(ctx, async (tx) => { const c = await tx.centers.get(id); if (!c) throw notFound(); return c; }); }
  async listEthics(ctx: Ctx, centerId?: string) {
    const cid = ctx.actor.role === 'center_clinician' ? (ctx.actor.centerId ?? '__none__') : centerId;
    return this.repo.tx(ctx, (tx) => tx.centers.ethicsList(cid));
  }
  async createEthics(ctx: Ctx, b: { centerId: string; approvalRef: string; kind?: 'helsinki_committee' | 'irb_other'; validFrom?: string; validTo?: string }) {
    const issues: FieldIssue[] = [];
    if (!validateSampleEthicsRef(b.approvalRef)) issues.push({ field: 'approvalRef', rule: 'IDENTIFIER_SUSPECTED' });
    if (issues.length) throw new DomainError('VALIDATION_FAILED', issues);
    return this.repo.tx(ctx, async (tx) => {
      if (!(await tx.centers.get(b.centerId))) throw new DomainError('VALIDATION_FAILED', [{ field: 'centerId', rule: 'VOCAB' }]);
      if (await tx.centers.ethicsByRef(b.centerId, b.approvalRef)) throw new DomainError('CONFLICT');
      const e = await tx.centers.ethicsCreate({ id: nid(this.clock, 'ethics'), centerId: b.centerId, approvalRef: b.approvalRef, kind: b.kind ?? 'helsinki_committee', validFrom: b.validFrom ?? null, validTo: b.validTo ?? null, createdBy: ctx.actor.userId! });
      await tx.audit.record(ctx, { action: 'config.change', outcome: 'success', objectType: 'ethics_approval', objectId: e.id, centerId: b.centerId });
      return e;
    });
  }
}
import { validateEthicsRef } from '@ari/domain';
const validateSampleEthicsRef = validateEthicsRef;
