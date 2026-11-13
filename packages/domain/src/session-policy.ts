import type { Role } from './roles.js';
// Canonical decision C-02. Idle: 15 min staff, 30 min researchers. Absolute: 4 h admin, 8 h others. Step-up age <= 5 min.
const MIN = 60_000, HOUR = 3_600_000;
export const STEP_UP_MAX_AGE_MS = 5 * MIN;
export function idleTimeoutMs(role: Role): number {
  return role === 'researcher_il' || role === 'researcher_intl' ? 30 * MIN : 15 * MIN;
}
export function absoluteTimeoutMs(role: Role): number { return role === 'system_admin' ? 4 * HOUR : 8 * HOUR; }
/** Strictest timeout applies when a user holds several roles. */
export function strictestIdleMs(roles: readonly Role[]): number {
  return Math.min(...(roles.length ? roles : (['researcher_il'] as Role[])).map(idleTimeoutMs));
}
export function strictestAbsoluteMs(roles: readonly Role[]): number {
  return Math.min(...(roles.length ? roles : (['researcher_il'] as Role[])).map(absoluteTimeoutMs));
}
export interface SessionTimes { createdAt: number; lastSeenAt: number; mfaAt: number | null }
export type SessionVerdict = 'ok' | 'idle_expired' | 'absolute_expired';
export function evaluateSession(s: SessionTimes, roles: readonly Role[], now: number): SessionVerdict {
  if (now - s.createdAt >= strictestAbsoluteMs(roles)) return 'absolute_expired';
  if (now - s.lastSeenAt >= strictestIdleMs(roles)) return 'idle_expired';
  return 'ok';
}
export function sessionExpiresAt(s: SessionTimes, roles: readonly Role[]): number {
  return Math.min(s.createdAt + strictestAbsoluteMs(roles), s.lastSeenAt + strictestIdleMs(roles));
}
export function stepUpFresh(mfaAt: number | null, now: number): boolean {
  return mfaAt !== null && now - mfaAt <= STEP_UP_MAX_AGE_MS;
}
