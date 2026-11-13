import { createHash } from 'node:crypto';
import {
  DomainError, STEP_KEYS, allowedOutcomes, applicantMayEdit, canonicalizeFilters, cartMayChange, checkTransition, scanObjectDeep, stableStringify,
  stepForState, tally, validateEthicsRef, validateFilterShape, type CloseReason, type Clock, type Ctx, type DecisionOutcome, type Filters,
  type NotifyPort, type Repository, type RequestRecord, type RequestState, type RequestStepRecord, type StepKey, type Tx,
} from '@ari/domain';
import { countBucket, type SearchService } from '../search-discovery/index.js';
import { nid, notFound } from '../../lib/util.js';

type Fields = { researchQuestion?: string; applicantEthicsRef?: string; plannedUse?: string; fundingSources?: string };
const STAFF_VIEW = new Set(['national_coordinator', 'committee_member']);

export class RequestService {
  constructor(private repo: Repository, private clock: Clock, private notify: NotifyPort, private search: SearchService) {}

  private checkFields(f: Fields): void {
    const hits = scanObjectDeep({ researchQuestion: f.researchQuestion, plannedUse: f.plannedUse, fundingSources: f.fundingSources }, { maxLength: null });
    if (hits.length) throw new DomainError('VALIDATION_FAILED', hits.map((h) => ({ field: h.field, rule: 'IDENTIFIER_SUSPECTED' })));
    if (f.applicantEthicsRef !== undefined && !validateEthicsRef(f.applicantEthicsRef)) throw new DomainError('VALIDATION_FAILED', [{ field: 'applicantEthicsRef', rule: 'FORMAT' }]);
  }
  private present(ctx: Ctx, r: RequestRecord, dbSteps: RequestStepRecord[]): RequestRecord {
    const staff = STAFF_VIEW.has(ctx.actor.role);
    return { ...r, steps: buildSteps(r.status, dbSteps, staff) };
  }
  private async load(tx: Tx, ctx: Ctx, id: string): Promise<RequestRecord> {
    const r = await tx.requests.get(id); if (!r) throw notFound();
    const steps = await tx.requests.steps(id, STAFF_VIEW.has(ctx.actor.role));
    return this.present(ctx, r, steps);
  }

  // ----- cart -----
  async getCart(ctx: Ctx) { return this.repo.tx(ctx, async (tx) => { const d = await tx.requests.getDraftFor(ctx.actor.userId!); return { requestId: d?.id ?? null, items: d?.items ?? [] }; }); }
  async putCart(ctx: Ctx, items: Array<{ criteria: Filters; requestedCount?: number }>) {
    const prepared: Array<{ id: string; criteria: Filters; requestedCount: number | null; shownCountBucket: string | null }> = [];
    for (const it of items) {
      const criteria = canonicalizeFilters(it.criteria);
      const bad = validateFilterShape(criteria); if (bad) throw new DomainError('VALIDATION_FAILED', [{ field: 'criteria', rule: bad }]);
      prepared.push({ id: nid(this.clock, 'requestItem'), criteria, requestedCount: it.requestedCount ?? null, shownCountBucket: await countBucket(this.search, ctx, criteria) });
    }
    return this.repo.tx(ctx, async (tx) => {
      let d = await tx.requests.getDraftFor(ctx.actor.userId!);
      if (!d) d = await tx.requests.create({ id: nid(this.clock, 'request'), applicantUserId: ctx.actor.userId!, idempotencyKey: null, fields: {} });
      await tx.requests.setItems(d.id, prepared);
      const after = await tx.requests.get(d.id);
      return { requestId: d.id, items: after?.items ?? [] };
    });
  }

  // ----- request lifecycle -----
  async create(ctx: Ctx, body: Fields, idemKey: string | null) {
    this.checkFields(body);
    const hash = createHash('sha256').update(stableStringify(body)).digest('hex');
    return this.repo.tx(ctx, async (tx) => {
      if (idemKey) {
        const prior = await tx.requests.findByIdempotency(ctx.actor.userId!, idemKey);
        if (prior) {
          if (prior.requestHash !== hash) throw new DomainError('IDEMPOTENCY_CONFLICT');
          if (prior.requestId) { const r = await this.load(tx, ctx, prior.requestId); return { request: r, replay: true }; }
        }
      }
      const r = await tx.requests.create({ id: nid(this.clock, 'request'), applicantUserId: ctx.actor.userId!, idempotencyKey: idemKey, fields: body });
      if (idemKey) await tx.requests.saveIdempotency(ctx.actor.userId!, idemKey, 'POST /requests', hash, 201, r.id);
      return { request: this.present(ctx, r, []), replay: false };
    });
  }
  async updateDraft(ctx: Ctx, id: string, body: Fields) {
    this.checkFields(body);
    return this.repo.tx(ctx, async (tx) => {
      const cur = await tx.requests.get(id); if (!cur) throw notFound();
      if (cur.applicantUserId !== ctx.actor.userId) throw notFound();
      if (!applicantMayEdit(cur.status)) throw new DomainError('REQUEST_STATE_INVALID');
      await tx.requests.updateFields(id, body);
      return this.load(tx, ctx, id);
    });
  }
  async addItem(ctx: Ctx, id: string, b: { criteria: Filters; requestedCount?: number }) {
    const criteria = canonicalizeFilters(b.criteria);
    const bad = validateFilterShape(criteria); if (bad) throw new DomainError('VALIDATION_FAILED', [{ field: 'criteria', rule: bad }]);
    const bucket = await countBucket(this.search, ctx, criteria);
    return this.repo.tx(ctx, async (tx) => {
      const cur = await tx.requests.get(id); if (!cur || cur.applicantUserId !== ctx.actor.userId) throw notFound();
      if (!cartMayChange(cur.status)) throw new DomainError('REQUEST_STATE_INVALID');
      return tx.requests.addItem(id, { id: nid(this.clock, 'requestItem'), criteria, requestedCount: b.requestedCount ?? null, shownCountBucket: bucket });
    });
  }
  async removeItem(ctx: Ctx, id: string, itemId: string) {
    await this.repo.tx(ctx, async (tx) => {
      const cur = await tx.requests.get(id); if (!cur || cur.applicantUserId !== ctx.actor.userId) throw notFound();
      if (!cartMayChange(cur.status)) throw new DomainError('REQUEST_STATE_INVALID');
      if (!(await tx.requests.removeItem(id, itemId))) throw notFound();
    });
  }
  async get(ctx: Ctx, id: string) {
    return this.repo.tx(ctx, async (tx) => {
      const r = await this.load(tx, ctx, id);
      await tx.audit.record(ctx, { action: 'request.view', outcome: 'success', objectType: 'request', objectId: id });
      return r;
    });
  }
  async list(ctx: Ctx, q: { status?: RequestState; cursor?: string; limit?: number }) {
    return this.repo.tx(ctx, async (tx) => {
      const page = await tx.requests.list({ ...q, limit: q.limit ?? 25 });
      return { items: page.items.map((r) => ({ ...r, steps: undefined })), nextCursor: page.nextCursor };
    });
  }
  async submit(ctx: Ctx, id: string, idemKey: string | null) {
    return this.repo.tx(ctx, async (tx) => {
      const cur = await tx.requests.get(id); if (!cur || cur.applicantUserId !== ctx.actor.userId) throw notFound();
      if (cur.status === 'submitted' && idemKey) return this.load(tx, ctx, id);   // replay
      const miss = (['researchQuestion', 'applicantEthicsRef', 'plannedUse', 'fundingSources'] as const).filter((k) => !cur[k] || String(cur[k]).trim() === '');
      if (miss.length || cur.items.length === 0) throw new DomainError('VALIDATION_FAILED', [...miss.map((field) => ({ field, rule: 'REQUIRED' })), ...(cur.items.length === 0 ? [{ field: 'items', rule: 'REQUIRED' }] : [])]);
      this.checkFields(cur as Fields);
      const chk = checkTransition(cur.status, 'submitted', ctx.actor.role, true);
      if (!chk.ok) throw new DomainError('REQUEST_STATE_INVALID');
      await tx.requests.transition(id, 'submitted', null);
      await tx.audit.record(ctx, { action: 'request.submit', outcome: 'success', objectType: 'request', objectId: id });
      await this.notify.enqueue(tx, { template: 'coordinator_precheck', toRole: 'national_coordinator', params: {} });
      return this.load(tx, ctx, id);
    });
  }
  async transition(ctx: Ctx, id: string, to: RequestState, closeReason?: CloseReason) {
    return this.repo.tx(ctx, async (tx) => {
      const cur = await tx.requests.get(id); if (!cur) throw notFound();
      const isOwner = cur.applicantUserId === ctx.actor.userId;
      if ((cur.status === 'committee_review' || cur.status === 'appeal_review') && (to === 'approved' || to === 'rejected')) throw new DomainError('REQUEST_STATE_INVALID');
      if (to === 'closed' && !closeReason) throw new DomainError('VALIDATION_FAILED', [{ field: 'closeReason', rule: 'REQUIRED' }]);
      if (to !== 'closed' && closeReason) throw new DomainError('VALIDATION_FAILED', [{ field: 'closeReason', rule: 'FORMAT' }]);
      const coordinatorIsApplicant = ctx.actor.role === 'national_coordinator' && isOwner;
      const chk = checkTransition(cur.status, to, ctx.actor.role, isOwner, closeReason, coordinatorIsApplicant);
      if (!chk.ok) {
        if (chk.reason === 'illegal') throw new DomainError('REQUEST_STATE_INVALID');
        throw new DomainError('FORBIDDEN');
      }
      const next = await tx.requests.transition(id, to, closeReason ?? null);
      if (!next) throw new DomainError('REQUEST_STATE_INVALID');
      await tx.audit.record(ctx, { action: 'request.state_changed', outcome: 'success', objectType: 'request', objectId: id, details: { from: cur.status, to, actorRole: ctx.actor.role } });
      if (to === 'precheck') await tx.audit.record(ctx, { action: 'request.precheck', outcome: 'success', objectType: 'request', objectId: id });
      if (to === 'delivery' || closeReason === 'delivered') await tx.audit.record(ctx, { action: 'request.deliver', outcome: 'success', objectType: 'request', objectId: id });
      if (to === 'agreements' || to === 'center_coordination') await tx.audit.record(ctx, { action: 'request.mta_status', outcome: 'success', objectType: 'request', objectId: id });
      if (to === 'committee_review') await this.notify.enqueue(tx, { template: 'committee_assigned', toRole: 'committee_member' });
      if (!isOwner) await this.notify.enqueue(tx, { template: 'request_status', toUserId: cur.applicantUserId });
      return this.load(tx, ctx, id);
    });
  }
  async steps(ctx: Ctx, id: string) {
    return this.repo.tx(ctx, async (tx) => { const r = await this.load(tx, ctx, id); return r.steps ?? []; });
  }
  async updateStep(ctx: Ctx, id: string, key: StepKey, p: { status?: RequestStepRecord['status']; publicNote?: string; internalNote?: string; centerId?: string }) {
    if (key !== 'center_coordination' && key !== 'delivery') throw new DomainError('VALIDATION_FAILED', [{ field: 'stepKey', rule: 'VOCAB' }]);
    if (!p.centerId) throw new DomainError('VALIDATION_FAILED', [{ field: 'centerId', rule: 'REQUIRED' }]);
    const note = scanObjectDeep({ a: p.publicNote, b: p.internalNote }, { maxLength: null });
    if (note.length) throw new DomainError('VALIDATION_FAILED', [{ field: 'publicNote', rule: 'IDENTIFIER_SUSPECTED' }]);
    return this.repo.tx(ctx, async (tx) => {
      const cur = await tx.requests.get(id); if (!cur) throw notFound();
      if (!['center_coordination', 'agreements', 'delivery'].includes(cur.status)) throw new DomainError('REQUEST_STATE_INVALID');
      const { centerId, ...rest } = p;
      const s = await tx.requests.upsertStep(id, key, centerId!, rest, ctx.actor.userId!);
      await tx.audit.record(ctx, { action: 'request.mta_status', outcome: 'success', objectType: 'request', objectId: id, centerId: centerId!, details: { step: key, status: s.status } });
      return s;
    });
  }
  async resolveSamples(ctx: Ctx, id: string, itemId: string, sampleIds: string[]) {
    await this.repo.tx(ctx, async (tx) => {
      const cur = await tx.requests.get(id); if (!cur) throw notFound();
      if (!['approved', 'center_coordination', 'agreements', 'delivery'].includes(cur.status)) throw new DomainError('REQUEST_STATE_INVALID');
      if (!cur.items.some((i) => i.id === itemId)) throw notFound();
      if (!(await tx.requests.resolveSamples(id, itemId, sampleIds, ctx.actor.userId!))) throw new DomainError('VALIDATION_FAILED', [{ field: 'sampleIds', rule: 'VOCAB' }]);
      await tx.audit.record(ctx, { action: 'request.view', outcome: 'success', objectType: 'request', objectId: id, details: { resolvedSamples: sampleIds.length } });
    });
  }
  async castVote(ctx: Ctx, id: string, b: { vote: 'approve' | 'reject' | 'abstain'; comment?: string; rationaleCode?: string }) {
    if (b.comment && scanObjectDeep({ c: b.comment }, { maxLength: null }).length) throw new DomainError('VALIDATION_FAILED', [{ field: 'comment', rule: 'IDENTIFIER_SUSPECTED' }]);
    return this.repo.tx(ctx, async (tx) => {
      const cur = await tx.requests.get(id); if (!cur) throw notFound();
      if (cur.status !== 'committee_review' && cur.status !== 'appeal_review') throw new DomainError('REQUEST_STATE_INVALID');
      const v = await tx.requests.castVote(id, ctx.actor.userId!, b.vote, b.comment ?? null, b.vote === 'reject' ? (b.rationaleCode ?? 'unspecified') : null);
      await tx.audit.record(ctx, { action: 'request.vote', outcome: 'success', objectType: 'request', objectId: id, details: { vote: b.vote } });
      return v;
    });
  }
  async listVotes(ctx: Ctx, id: string) {
    return this.repo.tx(ctx, async (tx) => { if (!(await tx.requests.get(id))) throw notFound(); return tx.requests.votes(id); });
  }
  async recordDecision(ctx: Ctx, id: string, b: { outcome: DecisionOutcome; rationale?: string }) {
    if (b.rationale && scanObjectDeep({ r: b.rationale }, { maxLength: null }).length) throw new DomainError('VALIDATION_FAILED', [{ field: 'rationale', rule: 'IDENTIFIER_SUSPECTED' }]);
    return this.repo.tx(ctx, async (tx) => {
      const cur = await tx.requests.get(id); if (!cur) throw notFound();
      if (cur.status !== 'committee_review' && cur.status !== 'appeal_review') throw new DomainError('REQUEST_STATE_INVALID');
      if (b.outcome === 'needs_info') {
        if (cur.status !== 'committee_review') throw new DomainError('REQUEST_STATE_INVALID');
        const votes = await tx.requests.votes(id);
        if (!allowedOutcomes(tally(votes), await tx.requests.committeeConfig()).includes('needs_info')) throw new DomainError('QUORUM_NOT_REACHED');
        await tx.requests.transition(id, 'needs_info', null);
        const d = { id: nid(this.clock, 'decision'), requestId: id, outcome: 'needs_info' as const, rationale: b.rationale ?? null, decidedAt: this.clock.now().toISOString() };
        await tx.audit.record(ctx, { action: 'request.decide', outcome: 'success', objectType: 'request', objectId: id, details: { outcome: 'needs_info' } });
        await this.notify.enqueue(tx, { template: 'request_status', toUserId: cur.applicantUserId });
        return d;
      }
      const votes = await tx.requests.votes(id);
      const cfg = await tx.requests.committeeConfig();
      if (!allowedOutcomes(tally(votes), cfg).includes(b.outcome)) throw new DomainError('QUORUM_NOT_REACHED');
      const d = await tx.requests.recordDecision(id, b.outcome, b.rationale ?? null, ctx.actor.userId!);
      await tx.audit.record(ctx, { action: 'request.decide', outcome: 'success', objectType: 'request', objectId: id, details: { outcome: b.outcome } });
      await this.notify.enqueue(tx, { template: 'request_status', toUserId: cur.applicantUserId });
      return d;
    });
  }
  async decisions(ctx: Ctx, id: string) {
    return this.repo.tx(ctx, async (tx) => { if (!(await tx.requests.get(id))) throw notFound(); return tx.requests.decisions(id, ctx.actor.role === 'researcher_il'); });
  }
}

/** The 8-step stepper (REQ-034). Center-level rows replace the generic step when they exist. */
export function buildSteps(state: RequestState, db: RequestStepRecord[], staff: boolean): RequestStepRecord[] {
  const cur = STEP_KEYS.indexOf(stepForState(state));
  const out: RequestStepRecord[] = [];
  STEP_KEYS.forEach((key, i) => {
    const real = db.filter((s) => s.stepKey === key);
    if (real.length) { for (const s of real) out.push(staff ? s : { ...s, internalNote: undefined }); return; }
    const status: RequestStepRecord['status'] = state === 'closed' ? (i <= cur ? 'done' : 'skipped') : i < cur ? 'done' : i === cur ? 'in_progress' : 'pending';
    out.push({ stepKey: key, centerId: null, status, publicNote: null, startedAt: null, completedAt: null });
  });
  return out;
}
