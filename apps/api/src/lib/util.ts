import { DomainError, newId, type Clock, type IdKind } from '@ari/domain';
export const nid = (clock: Clock, kind: IdKind): string => newId(kind, clock.now().getTime());
export const notFound = (): DomainError => new DomainError('NOT_FOUND');
export function institutionOf(email: string): string | null { const d = email.split('@')[1]; return d ? d.toLowerCase() : null; }
export function etagOf(updatedAt: string): string { return `"${Buffer.from(updatedAt).toString('base64url')}"`; }
export function encodeCursor(v: unknown): string { return Buffer.from(JSON.stringify(v)).toString('base64url'); }
export function decodeCursor<T>(c: string | undefined): T | null { if (!c) return null; try { return JSON.parse(Buffer.from(c, 'base64url').toString('utf8')) as T; } catch { throw new DomainError('VALIDATION_FAILED', [{ field: 'cursor', rule: 'FORMAT' }]); } }
