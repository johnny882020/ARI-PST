// Integration fixes (INT-1): config single source, data guard, DB URL per role, public-form CORS rule, health.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { roleUrl } from '../src/lib/db-url.js';
import { expectedMigration } from '../src/lib/migrations.js';
import { Health } from '../src/modules/observability/index.js';
import { startHarness, ORIGIN, type Harness } from './support/harness.js';

const SITE = 'https://public.example.invalid';
const prod = { NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://portal.example.invalid', IP_HASH_SALT: 'x'.repeat(24), SECRETS_KEY: 'y'.repeat(24), DB_HOST: 'db.internal', DB_NAME: 'ari_portal', DB_PASSWORD_RUNTIME: 'p+/=w' } as NodeJS.ProcessEnv;

describe('config', () => {
  it('builds the runtime URL for app_runtime from host + password (never the owner URL)', () => {
    const c = loadConfig({ ...prod, DATABASE_URL_OWNER: 'postgres://owner:secret@db.internal/ari_portal' });
    expect(c.databaseUrl).toBe('postgres://app_runtime:p%2B%2F%3Dw@db.internal:5432/ari_portal');
    expect(roleUrl(prod, 'app_readonly_bg')).toBeUndefined();
    expect(roleUrl({ ...prod, DB_PASSWORD_BG: 'bg' }, 'app_readonly_bg')).toContain('app_readonly_bg:bg@');
  });
  it('refuses a non-synthetic classification unless the gate variable is set', () => {
    expect(() => loadConfig({ ...prod, DATA_CLASSIFICATION: 'real' })).toThrow(/GATE-PROD-DATA/);
    expect(() => loadConfig({ ...prod, DATA_CLASSIFICATION: 'index' })).toThrow(/GATE-PROD-DATA/);
    expect(loadConfig({ ...prod, DATA_CLASSIFICATION: 'synthetic' }).dataClassification).toBe('synthetic');
  });
  it('with real data the object store and SMTP are mandatory; with synthetic data they fall back', () => {
    expect(() => loadConfig({ ...prod, DATA_CLASSIFICATION: 'index', GATE_PROD_DATA_CLOSED: 'true' })).toThrow(/S3_BUCKET|SMTP_URL/);
    const c = loadConfig(prod); expect(c.objectStore.kind).toBe('memory'); expect(c.mail.kind).toBe('console');
  });
  it('production needs its secrets and a database; PUBLIC_ORIGIN falls back to RENDER_EXTERNAL_URL', () => {
    const { IP_HASH_SALT: _a, ...noSalt } = prod; expect(() => loadConfig(noSalt)).toThrow(/IP_HASH_SALT/);
    const { DB_PASSWORD_RUNTIME: _b, ...noDb } = prod; expect(() => loadConfig(noDb)).toThrow(/database/i);
    const { PUBLIC_ORIGIN: _c, ...noOrigin } = prod; expect(loadConfig({ ...noOrigin, RENDER_EXTERNAL_URL: 'https://ari-api-pr-7.onrender.com' }).publicOrigin).toBe('https://ari-api-pr-7.onrender.com');
    expect(loadConfig({ ...prod, RENDER_GIT_COMMIT: 'abc123' }).appVersion).toBe('abc123');
  });
});

describe('trusted proxy hops (TRUST_PROXY_HOPS, review R-04)', () => {
  it('unset keeps today\'s behaviour (trust every hop); a number must be a whole number of hops', () => {
    expect(loadConfig(prod).trustProxy).toBe(true);
    expect(loadConfig({ ...prod, TRUST_PROXY_HOPS: '' }).trustProxy).toBe(true);
    expect(loadConfig({ ...prod, TRUST_PROXY_HOPS: '1' }).trustProxy).toBe(1);
    expect(loadConfig({ ...prod, TRUST_PROXY_HOPS: '0' }).trustProxy).toBe(0);
    for (const bad of ['-1', '1.5', 'all', 'true']) expect(() => loadConfig({ ...prod, TRUST_PROXY_HOPS: bad }), bad).toThrow(/TRUST_PROXY_HOPS/);
  });
  const spoofed = async (h: Harness) => {
    let limited = 0;
    for (let i = 0; i < 6; i++) {
      const r = await h.app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin: ORIGIN, 'x-forwarded-for': `198.51.100.${i + 1}, 203.0.113.7` } });
      if (r.statusCode === 429) limited++;
    }
    return limited;
  };
  it('with TRUST_PROXY_HOPS=1 a client-set left-most X-Forwarded-For does not reset the per-address limit', async () => {
    const h = await startHarness({ TRUST_PROXY_HOPS: '1', RATE_TIGHT_PER_MIN: '3' });
    try { expect(await spoofed(h)).toBeGreaterThan(0); } finally { await h.close(); }
  });
  it('without it (default) every hop is trusted, as before', async () => {
    const h = await startHarness({ RATE_TIGHT_PER_MIN: '3' });
    try { expect(await spoofed(h)).toBe(0); } finally { await h.close(); }
  });
});

describe('public-form CORS rule and health', () => {
  let h: Harness;
  beforeAll(async () => { h = await startHarness({ PUBLIC_SITE_ORIGIN: SITE + '/', RENDER_GIT_COMMIT: 'sha-test', RATE_TIGHT_PER_MIN: '20' }); });
  afterAll(async () => { await h.close(); });
  const form = { name: 'Synthetic Person', email: 'person@example.invalid', message: 'SYNTHETIC: hello' };
  const inject = (method: string, url: string, origin: string | null, payload?: unknown) =>
    h.app.inject({ method: method as 'POST', url, headers: { ...(origin ? { origin } : {}), ...(payload ? { 'content-type': 'application/json' } : {}) }, ...(payload ? { payload: payload as object } : {}) });

  it('preflight from the public site: POST only, no credentials', async () => {
    const r = await inject('OPTIONS', '/api/v1/public/forms/contact', SITE);
    expect(r.statusCode).toBe(204);
    expect(r.headers['access-control-allow-origin']).toBe(SITE);
    expect(r.headers['access-control-allow-methods']).toBe('POST');
    expect(r.headers['access-control-allow-credentials']).toBeUndefined();
    expect(String(r.headers.vary)).toContain('Origin');
    expect(r.headers['set-cookie']).toBeUndefined();
  });
  it('POST from the public site is accepted (or fails validation), never CSRF-blocked, and sets no cookie', async () => {
    const r = await inject('POST', '/api/v1/public/forms/contact', SITE, form);
    expect(r.statusCode, r.body).toBe(202);
    expect(r.headers['access-control-allow-origin']).toBe(SITE);
    expect(r.headers['set-cookie']).toBeUndefined();
  });
  it('any other origin gets no CORS header and the POST is refused', async () => {
    for (const o of ['https://evil.example.invalid', SITE + '.evil.example.invalid', 'null']) {
      const pre = await inject('OPTIONS', '/api/v1/public/forms/contact', o);
      expect(pre.headers['access-control-allow-origin']).toBeUndefined(); expect(pre.statusCode).toBe(404);
      const post = await inject('POST', '/api/v1/public/forms/contact', o, form);
      expect(post.statusCode).toBe(403); expect(post.headers['access-control-allow-origin']).toBeUndefined();
    }
  });
  it('the rule does not reach any other route', async () => {
    for (const url of ['/api/v1/auth/login', '/api/v1/search/aggregate', '/api/v1/public/forms/contact/extra', '/api/v1/client-errors', '/api/livez']) {
      const pre = await inject('OPTIONS', url, SITE);
      expect(pre.headers['access-control-allow-origin'], url).toBeUndefined();
    }
    const login = await inject('POST', '/api/v1/auth/login', SITE, { email: 'a@example.invalid', password: 'x' });
    expect(login.statusCode).toBe(403); expect(login.headers['access-control-allow-origin']).toBeUndefined();
    const same = await inject('GET', '/api/v1/auth/session', ORIGIN);
    expect(same.headers['access-control-allow-origin']).toBeUndefined();
  });
  it('cross-origin form posts are rate-limited', async () => {
    let limited = 0;
    for (let i = 0; i < 30; i++) if ((await inject('POST', '/api/v1/public/forms/contact', SITE, form)).statusCode === 429) limited++;
    expect(limited).toBeGreaterThan(0);
  });
  it('/livez and /readyz carry the git SHA; /readyz checks the DB and the migration level', async () => {
    const live = (await h.app.inject({ method: 'GET', url: '/livez' })).json();
    expect(live).toMatchObject({ status: 'ok', version: 'sha-test' });
    const ready = await h.app.inject({ method: 'GET', url: '/readyz' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({ status: 'ok', version: 'sha-test', checks: { db: 'ok', migrations: 'ok', migrationApplied: expectedMigration(), migrationExpected: expectedMigration() } });
    expect((await h.app.inject({ method: 'GET', url: '/api/readyz' })).statusCode).toBe(200);
  });
  it('/readyz is 503 when the database is behind the build, and when the database is down', async () => {
    const behind = await new Health(h.repo, 'v', { expectedMigration: '9999', dataClassification: 'synthetic', demoMode: false }).readyz();
    expect(behind.code).toBe(503); expect(behind.body.checks.migrations).toBe('behind');
    const ahead = await new Health(h.repo, 'v', { expectedMigration: '0001', dataClassification: 'synthetic', demoMode: false }).readyz();
    expect(ahead.code).toBe(200);     // old instance during a deploy: stays ready after the new migration ran
    const down = await new Health({ ping: async () => ({ ok: false, migrationsOk: false, latestMigration: null }) } as never, 'v').readyz();
    expect(down.code).toBe(503); expect(down.body.checks.db).toBe('down');
  });
});
