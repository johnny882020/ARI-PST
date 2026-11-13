// Staleness (REQ-067). Defaults live in workflow_config (C-14); these are fallbacks.
export type Staleness = 'fresh' | 'due_soon' | 'stale';
export const DEFAULT_STALENESS = { slaDays: 180, warnDays: 30 } as const;
export function classifyStaleness(lastVerifiedAt: Date, now: Date, slaDays: number = DEFAULT_STALENESS.slaDays, warnDays: number = DEFAULT_STALENESS.warnDays): Staleness {
  const age = (now.getTime() - lastVerifiedAt.getTime()) / 86_400_000;
  if (age > slaDays) return 'stale';
  if (age > slaDays - warnDays) return 'due_soon';
  return 'fresh';
}
