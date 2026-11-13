// PostgreSQL adapter. One runtime login (app_runtime). Every transaction starts with portal.begin_session(user, role):
// the database derives the center from role assignments and signs the context. The client never supplies a center (RT-04).
import pg from 'pg';
import type { AuditEvent, AuditPort, Ctx, Repository, Tx } from '@ari/domain';
import { mapPgError } from './errors.js';
import { makeUserRepo, makeCenterRepo } from './repo-users.js';
import { makeSampleRepo } from './repo-samples.js';
import { makeSearchRepo } from './repo-search.js';
import { makeRequestRepo } from './repo-requests.js';
import { makeImportRepo, makeGovernanceRepo, makeOutboxRepo, makeAuditRepo } from './repo-misc.js';

import type { Q } from './db-types.js';
export type { Q } from './db-types.js';
const OUTCOME = { success: 'allow', denied: 'deny', error: 'error' } as const;

export function makeAudit(q: Q, ctx: Ctx): AuditPort {
  return {
    async record(c, ev: AuditEvent) {
      const details = { ...(ev.details ?? {}), ...(ev.centerId ? { center: ev.centerId } : {}) };
      await q.query('SELECT audit.record($1,$2,$3,$4,$5::jsonb,$6)', [ev.action, ev.objectType ?? null, ev.objectId ?? null, OUTCOME[ev.outcome], JSON.stringify(details), (c ?? ctx).traceId]);
    },
  };
}

export class PgRepository implements Repository {
  readonly pool: pg.Pool;
  constructor(connectionString: string, opts: { max?: number } = {}) {
    this.pool = new pg.Pool({ connectionString, max: opts.max ?? 10, idleTimeoutMillis: 30_000 });
    this.pool.on('error', () => undefined);
  }
  async close(): Promise<void> { await this.pool.end(); }

  private async begin(client: pg.PoolClient, ctx: Ctx): Promise<void> {
    await client.query('BEGIN');
    const a = ctx.actor;
    if (a.role === 'anonymous' || !a.userId) await client.query('SELECT portal.begin_session(NULL, $1)', ['anonymous']);
    else await client.query('SELECT portal.begin_session($1, $2)', [a.userId, a.role]);
  }
  async tx<T>(ctx: Ctx, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let released = false;
    try {
      await this.begin(client, ctx);
      const q = client as unknown as Q;
      const now = new Date();
      const tx: Tx = {
        users: makeUserRepo(q, ctx), centers: makeCenterRepo(q, ctx), samples: makeSampleRepo(q, ctx), search: makeSearchRepo(q, ctx),
        requests: makeRequestRepo(q, ctx), imports: makeImportRepo(q), governance: makeGovernanceRepo(q), outbox: makeOutboxRepo(q),
        audit: makeAudit(q, ctx), auditLog: makeAuditRepo(q, ctx), now,
      };
      const out = await fn(tx);
      await client.query('COMMIT');
      return out;
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch { client.release(true); released = true; }
      throw mapPgError(e);
    } finally { if (!released) client.release(); }
  }
  /** Own transaction. Survives the rollback of a failed business transaction (denials, login failures). */
  async auditStandalone(ctx: Ctx, ev: AuditEvent): Promise<void> {
    const anon = ctx.actor.role === 'anonymous' || !ctx.actor.userId;
    const details = { ...(ev.details ?? {}), ...(anon && ctx.actor.userId ? { actor: ctx.actor.userId } : {}) };
    const c: Ctx = anon ? { ...ctx, actor: { ...ctx.actor, userId: null, role: 'anonymous' } } : ctx;
    try { await this.tx(c, (tx) => tx.audit.record(c, { ...ev, details })); } catch { /* audit of a denial must never mask the denial itself */ }
  }
  async ping() {
    try {
      await this.pool.query('SELECT 1');
      let latest: string | null = null; let ok = true;
      try { const r = await this.pool.query('SELECT max(name) AS n FROM public.schema_migrations'); latest = r.rows[0]?.n ?? null; ok = latest !== null; } catch { latest = null; ok = true; }
      return { ok: true, migrationsOk: ok, latestMigration: latest };
    } catch { return { ok: false, migrationsOk: false, latestMigration: null }; }
  }
}
export { iso } from './db-types.js';
