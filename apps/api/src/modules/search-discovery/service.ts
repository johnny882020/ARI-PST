import {
  DomainError, QUERY_LIMITS, TokenBucket, canonicalizeFilters, evaluateBudget, predicateCount, queryCost, stableStringify, validateFilterShape,
  type Clock, type Ctx, type Filters, type Repository, type DiagnosisTermRecord,
} from '@ari/domain';
import { sha256Hex } from '../../lib/crypto.js';
import { institutionOf } from '../../lib/util.js';

const EPOCH_HOUR_UTC = 2;
export function epochStart(now: Date): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), EPOCH_HOUR_UTC));
  return d.getTime() > now.getTime() ? new Date(d.getTime() - 86_400_000) : d;
}
export interface SearchInput { q?: string; lang?: 'he' | 'en'; filters?: Filters }

export class SearchService {
  private buckets = new Map<string, TokenBucket>();
  private dxCache: { at: number; items: DiagnosisTermRecord[] } | null = null;
  constructor(private repo: Repository, private clock: Clock, private emailOf: (userId: string) => Promise<string | null>) {}

  async diagnoses(ctx: Ctx): Promise<DiagnosisTermRecord[]> {
    const now = this.clock.now().getTime();
    if (this.dxCache && now - this.dxCache.at < 60_000) return this.dxCache.items;
    const items = await this.repo.tx(ctx, (tx) => tx.search.diagnoses());
    this.dxCache = { at: now, items }; return items;
  }
  async suggest(ctx: Ctx, q: string) {
    const dx = await this.diagnoses(ctx);
    const rows = await this.repo.tx(ctx, async (tx) => { const r = await tx.search.expand(q, 10); await tx.audit.record(ctx, { action: 'search.aggregate', outcome: 'success', details: { kind: 'suggest', hash: sha256Hex(q.toLowerCase()).slice(0, 16) } }); return r; });
    const by = new Map(dx.map((d) => [d.diagnosisCode, d]));
    return rows.flatMap((r) => { const d = by.get(r.diagnosisCode); return d ? [{ diagnosisCode: r.diagnosisCode, score: r.score, matchedVia: r.matchedVia, labelHe: d.labelHe, labelEn: d.labelEn }] : []; });
  }
  /** Free text -> diagnosis codes (vocabulary only), merged into the diagnosis filter. */
  private async resolve(ctx: Ctx, input: SearchInput): Promise<{ filters: Filters; emptyText: boolean }> {
    const f = canonicalizeFilters(input.filters);
    const bad = validateFilterShape(f);
    if (bad) throw new DomainError('VALIDATION_FAILED', [{ field: 'filters', rule: bad }]);
    const q = input.q?.trim();
    if (!q) return { filters: f, emptyText: false };
    const codes = await this.repo.tx(ctx, (tx) => tx.search.expand(q, 10));
    if (codes.length === 0) return { filters: f, emptyText: true };
    const merged = [...new Set([...(f.diagnosis ?? []), ...codes.map((c) => c.diagnosisCode)])].slice(0, QUERY_LIMITS.maxOrValues);
    return { filters: canonicalizeFilters({ ...f, diagnosis: merged }), emptyText: false };
  }
  /** Rate limit and budget. Cache hit in the same epoch costs 0. Denials are audited in their own transaction. */
  private async charge(ctx: Ctx, key: string, cost: number): Promise<void> {
    const uid = ctx.actor.userId!; const now = this.clock.now();
    const deny = async (reason: string): Promise<never> => {
      await this.repo.auditStandalone(ctx, { action: 'search.denied_budget', outcome: 'denied', details: { reason } });
      throw new DomainError('RATE_LIMITED');
    };
    const epoch = epochStart(now);
    const seen = await this.repo.tx(ctx, (tx) => tx.search.seenInEpoch(uid, key, epoch));
    if (seen) return;
    let b = this.buckets.get(uid);
    if (!b) { b = new TokenBucket(QUERY_LIMITS.ratePerMinute, QUERY_LIMITS.ratePerMinute / 60_000, now.getTime()); this.buckets.set(uid, b); }
    if (!b.take(now.getTime()).ok) return deny('rate');
    const inst = institutionOf((await this.emailOf(uid)) ?? '');
    const spent = await this.repo.tx(ctx, (tx) => tx.search.spent(uid, inst, now));
    const v = evaluateBudget(spent, cost, false);
    if (!v.ok) return deny(v.reason);
    await this.repo.tx(ctx, (tx) => tx.search.recordQuery(uid, inst, key, cost, now));
  }
  private roleClass(ctx: Ctx): string { return ctx.actor.role === 'researcher_il' || ctx.actor.role === 'researcher_intl' ? 'external' : 'staff'; }

  async aggregate(ctx: Ctx, input: SearchInput) {
    const { filters, emptyText } = await this.resolve(ctx, input);
    const key = sha256Hex(stableStringify({ f: filters, t: input.q?.trim().toLowerCase() ?? null, rc: this.roleClass(ctx) }));
    await this.charge(ctx, key, queryCost(filters));
    const k = await this.repo.tx(ctx, (tx) => tx.search.k());
    const res = emptyText ? { count: null, suppressed: true, k } : await this.repo.tx(ctx, (tx) => tx.search.total(filters));
    await this.repo.tx(ctx, (tx) => tx.audit.record(ctx, { action: 'search.aggregate', outcome: 'success', details: { hash: key.slice(0, 32), masked: res.suppressed ? 1 : 0, predicates: predicateCount(filters), role: this.roleClass(ctx) } }));
    return { count: res.suppressed ? null : res.count, suppressed: res.suppressed, label: res.suppressed ? 'too_few' : res.count === null ? (res.band ?? 'lt10') : String(res.count), ...(ctx.actor.role === 'national_coordinator' ? { k: res.k } : {}), resolvedFilters: filters };
  }
  async facets(ctx: Ctx, input: SearchInput & { facets: string[] }) {
    const { filters, emptyText } = await this.resolve(ctx, input);
    const key = sha256Hex(stableStringify({ f: filters, t: input.q?.trim().toLowerCase() ?? null, fc: [...input.facets].sort(), rc: this.roleClass(ctx) }));
    await this.charge(ctx, key, queryCost(filters) + input.facets.length - 1);
    const k = await this.repo.tx(ctx, (tx) => tx.search.k());
    const out: Record<string, Array<{ bucket: string; level: string; count: number | null; suppressed: boolean }>> = {};
    for (const f of input.facets) {
      out[f] = emptyText ? [{ bucket: 'all', level: 'other', count: null, suppressed: true }] : await this.repo.tx(ctx, (tx) => tx.search.facet(filters, f));
    }
    await this.repo.tx(ctx, (tx) => tx.audit.record(ctx, { action: 'search.aggregate', outcome: 'success', details: { hash: key.slice(0, 32), kind: 'facets', facets: input.facets.length, role: this.roleClass(ctx) } }));
    return { ...(ctx.actor.role === 'national_coordinator' ? { k } : {}), facets: out };
  }
}

/** Used by access-requests through the module index: k-safe bucket for a cart item. Charges the same budget as a search. */
export async function countBucket(svc: SearchService, ctx: Ctx, filters: Filters): Promise<'lt10' | '10_plus'> {
  const r = await svc.aggregate(ctx, { filters });
  return r.suppressed || r.count === null || r.count < 10 ? 'lt10' : '10_plus';
}
