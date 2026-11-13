// Query rate and budget (plan/02-security-privacy/02-reidentification-controls.md section 1 and 5.2).
export const QUERY_LIMITS = {
  ratePerMinute: 20, dayCost: 300, cost30d: 3000, institution30dCost: 8000,
  maxPredicates: 4, maxOrValues: 3, maxFacetsPerCall: 8,
} as const;
export type QueryLimits = typeof QUERY_LIMITS;

export interface Filters {
  diagnosis?: string[]; sampleType?: string[]; ageBand?: string[]; sex?: string[]; centerId?: string[];
  timepoint?: string[]; availability?: string[]; attachedData?: string[];
}
export const FILTER_KEYS = ['diagnosis', 'sampleType', 'ageBand', 'sex', 'centerId', 'timepoint', 'availability', 'attachedData'] as const;

/** Sorted, de-duplicated copy. Same query in any order gives the same key input. */
export function canonicalizeFilters(f: Filters | undefined): Filters {
  const out: Record<string, string[]> = {};
  for (const k of FILTER_KEYS) {
    const v = f?.[k];
    if (v && v.length) out[k] = [...new Set(v)].sort();
  }
  return out as Filters;
}
export function predicateCount(f: Filters): number {
  return Object.values(f).filter((v) => Array.isArray(v) && v.length > 0).length;
}
/** Cost of a query = 1 + number of predicates. A repeat of a canonical query in the same epoch costs 0. */
export function queryCost(f: Filters): number { return 1 + predicateCount(f); }
export function validateFilterShape(f: Filters, limits: QueryLimits = QUERY_LIMITS): string | null {
  if (predicateCount(f) > limits.maxPredicates) return 'MAX_PREDICATES';
  for (const k of FILTER_KEYS) if ((f[k]?.length ?? 0) > (k === 'diagnosis' ? 50 : 50) ) return 'MAX_VALUES';
  for (const k of ['sampleType', 'ageBand', 'sex', 'centerId', 'timepoint', 'availability'] as const) {
    if ((f[k]?.length ?? 0) > Math.max(limits.maxOrValues, 6)) return 'MAX_OR_VALUES';
  }
  return null;
}
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

export interface BudgetSnapshot { spentDay: number; spent30d: number; spentInstitution30d: number }
export type BudgetVerdict = { ok: true; cost: number } | { ok: false; reason: 'budget_day' | 'budget_30d' | 'budget_inst' };
export function evaluateBudget(s: BudgetSnapshot, cost: number, cacheHit: boolean, limits: QueryLimits = QUERY_LIMITS): BudgetVerdict {
  if (cacheHit) return { ok: true, cost: 0 };
  if (s.spentDay + cost > limits.dayCost) return { ok: false, reason: 'budget_day' };
  if (s.spent30d + cost > limits.cost30d) return { ok: false, reason: 'budget_30d' };
  if (s.spentInstitution30d + cost > limits.institution30dCost) return { ok: false, reason: 'budget_inst' };
  return { ok: true, cost };
}

/** Token bucket. Pure: caller passes `now`. */
export class TokenBucket {
  private tokens: number; private last: number;
  constructor(private readonly capacity: number, private readonly refillPerMs: number, now: number) {
    this.tokens = capacity; this.last = now;
  }
  take(now: number, n = 1): { ok: boolean; retryAfterMs: number } {
    this.tokens = Math.min(this.capacity, this.tokens + (now - this.last) * this.refillPerMs);
    this.last = now;
    if (this.tokens >= n) { this.tokens -= n; return { ok: true, retryAfterMs: 0 }; }
    return { ok: false, retryAfterMs: Math.ceil((n - this.tokens) / this.refillPerMs) };
  }
}
