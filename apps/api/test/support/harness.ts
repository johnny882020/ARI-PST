import pg from 'pg';
import { newId, type Role } from '@ari/domain';
import { loadConfig } from '../../src/config.js';
import { Contract } from '../../src/http/openapi.js';
import { PgRepository } from '../../src/adapters/postgres/db.js';
import { PgAuth } from '../../src/adapters/auth-local/index.js';
import { MemoryObjectStore } from '../../src/adapters/objectstore/index.js';
import { ConsoleMailer } from '../../src/adapters/email/index.js';
import { systemClock } from '../../src/adapters/clock/index.js';
import { createNotifyPort, createOutboxWorker } from '../../src/modules/notifications/index.js';
import { buildApp } from '../../src/app.js';
import { totpAt } from '../../src/adapters/auth-local/totp.js';

export const ORIGIN = 'http://localhost:8080';
export interface TestUser { id: string; email: string; password: string; role: Role; centerId: string | null; totpSecret: string }
export interface Session { cookie: string; csrf: string }

export async function startHarness(extraEnv: Record<string, string> = {}) {
  const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: process.env.TEST_DATABASE_URL!, PUBLIC_ORIGIN: ORIGIN, ARGON_MEMORY_KIB: '8192', ARGON_TIME_COST: '2', OUTBOX_INTERVAL_MS: '0', VALIDATE_RESPONSES: '1', OBJECT_STORE: 'memory', RATE_TIGHT_PER_MIN: '100000', RATE_GENERAL_PER_MIN: '100000', ...extraEnv } as NodeJS.ProcessEnv);
  const repo = new PgRepository(config.databaseUrl, { max: 8 });
  const admin = new pg.Pool({ connectionString: process.env.TEST_ADMIN_DATABASE_URL, max: 3 });
  const auth = new PgAuth(repo.pool, { rpId: 'localhost', rpName: 'ARI-PST Test', origin: ORIGIN, secretsKey: config.secretsKey, argon: config.argon }, systemClock);
  const store = new MemoryObjectStore(); const mailer = new ConsoleMailer();
  const contract = new Contract();
  const { app } = await buildApp({ config, contract, repo, auth, store, mailer, clock: systemClock, notify: createNotifyPort(systemClock) }, { logger: false });
  await app.ready();
  const worker = createOutboxWorker(repo, mailer, systemClock, () => undefined);
  const mk = (kind: Parameters<typeof newId>[0]) => newId(kind, Date.now());
  let n = 0;

  async function seedCenter(code: string): Promise<string> {
    const id = mk('center');
    await admin.query(`INSERT INTO portal.centers (id, code, name_en, name_he, contact_role, feeds_regularly) VALUES ($1,$2,$3,$4,'Center research coordinator', true) ON CONFLICT (code) DO NOTHING`, [id, code, `Synthetic Center ${code}`, `מרכז סינתטי ${code}`]);
    return (await admin.query('SELECT id FROM portal.centers WHERE code = $1', [code])).rows[0].id;
  }
  async function seedUser(role: Role, centerId: string | null = null, label = ''): Promise<TestUser> {
    const id = mk('user'); n++;
    const email = `${role}.${label || n}.${id.slice(-6).toLowerCase()}@example.invalid`;
    const password = 'correct-horse-battery-1';
    await admin.query(`INSERT INTO portal.users (id, email, display_name, status, email_verified_at) VALUES ($1,$2,$3,'active', now())`, [id, email, `Synthetic ${role}`]);
    await admin.query(`INSERT INTO portal.role_assignments (id, user_id, role, center_id) VALUES ($1,$2,$3::portal.role_name,$4)`, [mk('role'), id, role, centerId]);
    await auth.storePasswordHash(id, await auth.hashPassword(password));
    const t = await auth.totpBegin(id, email);
    const step = Math.floor(Date.now() / 30000) - 1;
    const code = totpAt(t.secretBase32, step * 30000);
    if (!(await auth.totpConfirm(id, code))) throw new Error('seed totp failed');
    await admin.query('UPDATE authn.credentials SET totp_last_step = -1 WHERE user_id = $1', [id]);
    return { id, email, password, role, centerId, totpSecret: t.secretBase32 };
  }
  /** Direct server-side session (skips the login ceremony). The login flow has its own tests. */
  async function session(u: TestUser, opts: { mfaAgeMs?: number } = {}): Promise<Session> {
    const roles = await auth.activeRolesFor(u.id);
    const s = await auth.createSession(u.id, { mfaAt: Date.now() - (opts.mfaAgeMs ?? 0), ipHash: null, roles, displayName: 'Synthetic', locale: 'en' });
    return { cookie: `__Host-sid=${s.id}; __Host-csrf=csrf-test-token-0123456789`, csrf: s.csrfToken };
  }
  async function csrfFor(s: Session): Promise<Session> { return s; }
  type Opts = { body?: unknown; headers?: Record<string, string>; query?: Record<string, string | number>; contentType?: string; raw?: Buffer | string };
  async function call(s: Session | null, method: string, url: string, o: Opts = {}) {
    const headers: Record<string, string> = { origin: ORIGIN, ...(o.headers ?? {}) };
    const cookie = s ? s.cookie : '__Host-csrf=csrf-test-token-0123456789';
    headers.cookie = cookie;
    headers['x-csrf-token'] = s ? s.csrf : 'csrf-test-token-0123456789';
    if (s) { /* csrf of an authenticated session is the session token; cookie value is checked by double submit */ headers['x-csrf-token'] = s.csrf; headers.cookie = s.cookie.replace(/__Host-csrf=[^;]+/, `__Host-csrf=${s.csrf}`); }
    const res = await app.inject({ method: method as 'GET', url, headers, ...(o.raw !== undefined ? { payload: o.raw } : o.body !== undefined ? { payload: o.body as object } : {}), ...(o.query ? { query: o.query as Record<string, string> } : {}) });
    let json: any = undefined; try { json = res.body ? JSON.parse(res.body) : undefined; } catch { /* not json */ }
    return { status: res.statusCode, json, body: res.body + (res.headers['x-debug-error'] ? ` [${res.headers['x-debug-error']}]` : ''), headers: res.headers, res };
  }
  /** The nightly job runs agg.refresh_snapshot() as app_readonly_bg. Tests run it as a coordinator (allowed by the function). */
  async function refreshSnapshot(coord: TestUser): Promise<void> {
    await repo.tx({ actor: { userId: coord.id, role: 'national_coordinator', roles: ['national_coordinator'], centerId: null }, traceId: 'test' }, async () => undefined);
    const c = await repo.pool.connect();
    try { await c.query('BEGIN'); await c.query('SELECT portal.begin_session($1,$2)', [coord.id, 'national_coordinator']); await c.query('SELECT agg.refresh_snapshot()'); await c.query('COMMIT'); } finally { c.release(); }
  }
  async function close() { await app.close(); await repo.close(); await admin.end(); }
  return { app, config, repo, auth, admin, store, mailer, contract, worker, refreshSnapshot, seedCenter, seedUser, session, call, close, csrfFor, mk };
}
export type Harness = Awaited<ReturnType<typeof startHarness>>;
