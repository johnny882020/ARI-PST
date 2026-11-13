#!/usr/bin/env node
// Full-stack end-to-end check against the REAL API and the built SPA (no mocks). Synthetic data only.
//
//   pnpm test:e2e:full                 = node scripts/e2e-fullstack.mjs --start
//   BASE_URL=https://host SEED_USER_PASSWORD=... node scripts/e2e-fullstack.mjs      (against a running, seeded stack)
//
// --start does what a Render deploy does, locally: fresh simulated Render Postgres (scripts/sim-render-db.sh, one
// non-superuser owner), scripts/render-predeploy.mjs (bootstrap, migrate, synthetic seed), then
// `node apps/api/dist/server.js` with production-like env. Build first: pnpm -r build.
//
// What it checks:
//   1. smoke: /livez, /readyz (version, migration level)
//   2. every role signs in through the SPA with password + TOTP
//   3. researcher: aggregate search shows a count; add to cart; start, fill and submit a request
//   4. coordinator pre-check, committee votes (2 of 3) and decision, center coordination, MTA, delivery -> closed(delivered)
//   5. privacy spot checks: a researcher gets 403 on sample rows; the public-form CORS rule is exact
// Steps marked [ui] drive the browser UI. Steps marked [api] call the real API from inside the signed-in browser
// session (same cookies and CSRF token as the SPA) where no screen exists yet.
import { spawn, spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = createRequire(path.join(root, 'apps/web/package.json'))('@playwright/test')); }

const START = process.argv.includes('--start');
const PORT = Number(process.env.E2E_PORT ?? 18080);
const BASE = (process.env.BASE_URL ?? `http://localhost:${PORT}`).replace(/\/$/, '');
const PASSWORD = process.env.SEED_USER_PASSWORD ?? (START ? 'Synthetic-e2e-only-2026!' : null);
if (!PASSWORD) { console.error('SEED_USER_PASSWORD is required'); process.exit(2); }
const USERS = {
  system_admin: 'synthetic.admin.a@example.invalid', national_coordinator: 'synthetic.coordinator.a@example.invalid',
  committee_member: 'synthetic.committee.a@example.invalid', committee_member_2: 'synthetic.committee.b@example.invalid',
  researcher_il: 'synthetic.researcher.c@example.invalid', researcher_intl: 'synthetic.intl.a@example.invalid',
  center_clinician: 'synthetic.clinician.a@example.invalid',
};

// ---- TOTP (RFC 6238). The seed derives each secret from the seed password and the e-mail (apps/api/src/jobs/seed-synthetic.ts).
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const totpSecret = (email) => createHmac('sha256', PASSWORD).update('ari-pst-seed-totp:' + email).digest().subarray(0, 20);
function totp(key) {
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = createHmac('sha1', key).update(buf).digest(); const o = h[19] & 15;
  return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0');
}
void B32;

const results = [];
let failed = 0;
async function step(name, fn) {
  const t0 = Date.now();
  try { const note = await fn(); results.push({ ok: true, name, ms: Date.now() - t0, note }); console.log(`ok    ${name}${note ? '  (' + note + ')' : ''}`); }
  catch (e) { failed++; results.push({ ok: false, name, error: String(e?.message ?? e).split('\n')[0] }); console.log(`FAIL  ${name}: ${String(e?.message ?? e).split('\n')[0]}`); throw e; }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

// ---- stack (only with --start)
let apiProc = null;
function startStack() {
  const sh = (cmd, args, env) => { const r = spawnSync(cmd, args, { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8' }); if (r.status !== 0) throw new Error(`${path.basename(args[0] ?? cmd)} failed: ${(r.stderr || r.stdout).trim().split('\n').slice(-3).join(' | ')}`); return r.stdout.trim(); };
  const ownerUrl = sh('bash', ['scripts/sim-render-db.sh', '--reset']).split('\n').pop();
  const u = new URL(ownerUrl);
  const env = {
    NODE_ENV: 'production', DATA_CLASSIFICATION: 'synthetic', SEED_SYNTHETIC: 'true', SEED_PROFILE: 'preview', SEED_USER_PASSWORD: PASSWORD,
    DATABASE_URL_OWNER: ownerUrl, DB_HOST: u.hostname, DB_PORT: u.port, DB_NAME: u.pathname.slice(1),
    DB_PASSWORD_MIGRATOR: 'e2e-migrator-+/=-0123456789', DB_PASSWORD_RUNTIME: 'e2e-runtime-+/=-0123456789', DB_PASSWORD_BG: 'e2e-bg-+/=-0123456789',
    IP_HASH_SALT: 'e2e-only-ip-hash-salt-0123456789', SECRETS_KEY: 'e2e-only-secrets-key-0123456789',
    PORT: String(PORT), PUBLIC_ORIGIN: BASE, WEB_DIST_DIR: 'apps/web/dist', PUBLIC_SITE_ORIGIN: 'http://public.example.invalid',
    RENDER_GIT_COMMIT: 'e2e-local-sha', RATE_TIGHT_PER_MIN: '200', DATABASE_URL: '', DATABASE_URL_MIGRATOR: '',
  };
  sh(process.execPath, ['scripts/render-predeploy.mjs'], env);
  sh(process.execPath, ['scripts/render-predeploy.mjs'], env);            // second run: must be idempotent
  apiProc = spawn(process.execPath, ['apps/api/dist/server.js'], { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'ignore', 'inherit'] });
  const smoke = spawnSync('bash', ['scripts/smoke.sh', '--wait', '40', '--expect-sha', 'e2e-local-sha'], { cwd: root, env: { ...process.env, BASE_URL: BASE }, encoding: 'utf8' });
  if (smoke.status !== 0) throw new Error('smoke failed: ' + (smoke.stderr || smoke.stdout).trim());
}
function stopStack() { if (apiProc) { apiProc.kill('SIGTERM'); apiProc = null; } if (START) spawnSync('bash', ['scripts/sim-render-db.sh', '--stop'], { cwd: root }); }

// ---- browser helpers
async function login(browser, email) {
  const ctx = await browser.newContext({ locale: 'en-US' });
  const page = await ctx.newPage();
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.getByLabel(/e-?mail|דוא/i).first().fill(email);
  await page.locator('input[type=password]').fill(PASSWORD);
  await page.locator('form button[type=submit]').click();
  await page.waitForURL(/mfa/, { timeout: 15000 });
  await page.locator('form input').first().fill(totp(totpSecret(email)));
  await page.locator('form button[type=submit]').first().click();
  await page.waitForURL((u) => !/login/.test(u.pathname), { timeout: 15000 });
  await page.waitForLoadState('networkidle');
  return page;
}
/** Calls the API from inside the page: same origin, same cookies, CSRF header from the readable cookie (like the SPA). */
async function api(page, method, url, body, headers = {}) {
  return page.evaluate(async ([m, u, b, h]) => {
    const csrf = document.cookie.split('; ').find((c) => c.startsWith('__Host-csrf='))?.split('=')[1] ?? '';
    const r = await fetch(u, { method: m, credentials: 'same-origin', headers: { ...(b !== null ? { 'content-type': 'application/json' } : {}), 'x-csrf-token': csrf, ...h }, ...(b !== null ? { body: JSON.stringify(b) } : {}) });
    const text = await r.text(); let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
    return { status: r.status, json, text: text.slice(0, 300) };
  }, [method, url, body ?? null, headers]);
}
const must = (r, status, what) => { expect(r.status === status, `${what}: expected ${status}, got ${r.status} ${r.text}`); return r.json; };
const MP = { 'content-type': 'application/merge-patch+json' };

async function main() {
  if (START) await step('stack: simulated Render DB + predeploy (twice) + API + smoke', async () => { startStack(); });
  await step('smoke: /readyz reports version and migration level', async () => {
    const r = await (await fetch(BASE + '/readyz')).json();
    expect(r.status === 'ok' && r.version && r.checks?.db === 'ok' && r.checks?.migrations === 'ok', JSON.stringify(r));
    return `version ${r.version}, migration ${r.checks.migrationApplied}`;
  });
  const browser = await chromium.launch();
  const pages = {};
  try {
    for (const [role, email] of Object.entries(USERS)) {
      await step(`[ui] ${role}: sign in with password + TOTP`, async () => {
        pages[role] = await login(browser, email);
        const s = must(await api(pages[role], 'GET', '/api/v1/auth/session'), 200, 'session');
        const want = role.replace(/_2$/, '');
        expect(JSON.stringify(s).includes(want), `session does not carry role ${want}`);
      });
    }
    const res = pages.researcher_il, coord = pages.national_coordinator, c1 = pages.committee_member, c2 = pages.committee_member_2, clin = pages.center_clinician;

    await step('[ui] researcher: /search renders and shows a count', async () => {
      await res.goto(BASE + '/search', { waitUntil: 'networkidle' });
      await res.waitForFunction(() => /\d{2,}/.test(document.querySelector('main')?.innerText ?? ''), null, { timeout: 15000 });
    });
    await step('[api] researcher: aggregate count is a number (snapshot is published)', async () => {
      const r = must(await api(res, 'POST', '/api/v1/search/aggregate', { filters: {} }), 200, 'aggregate');
      expect(r.suppressed === false && Number(r.count) >= 10, 'no count: ' + JSON.stringify(r)); return `count ${r.count}`;
    });
    await step('[api] researcher: sample rows are forbidden (403)', async () => { must(await api(res, 'GET', '/api/v1/samples'), 403, 'samples as researcher'); });
    await step('[api] international researcher: cannot add to a request cart', async () => {
      const r = await api(pages.researcher_intl, 'POST', '/api/v1/request-cart/items', { criteria: { diagnosis: ['mb_shh'] } });
      expect(r.status === 403, `expected 403, got ${r.status}`);
    });

    let id;
    await step('[api] researcher: add to cart, start request (QA-001)', async () => {
      must(await api(res, 'POST', '/api/v1/request-cart/items', { criteria: { diagnosis: ['mb_shh'] } }), 201, 'cart add');
      id = must(await api(res, 'POST', '/api/v1/request-cart/start', null, { 'idempotency-key': 'e2e-start-' + Date.now() }), 201, 'cart start').id;
    });
    await step('[api] researcher: fill and submit', async () => {
      must(await api(res, 'PATCH', `/api/v1/requests/${id}`, { researchQuestion: 'SYNTHETIC: does pathway X differ by subtype?', applicantEthicsRef: 'HC-2024-0012', plannedUse: 'SYNTHETIC: expression profiling of archived tissue', fundingSources: 'Synthetic Foundation grant' }, MP), 200, 'patch');
      const s = must(await api(res, 'POST', `/api/v1/requests/${id}/submit`, null, { 'idempotency-key': 'e2e-submit-' + Date.now() }), 200, 'submit');
      expect(['submitted', 'precheck'].includes(s.status), 'status ' + s.status);
    });
    await step('[ui] researcher: request page renders', async () => {
      await res.goto(`${BASE}/requests/${id}`, { waitUntil: 'networkidle' });
      await res.waitForFunction(() => (document.querySelector('main')?.innerText ?? '').length > 40, null, { timeout: 15000 });
    });
    await step('[api] coordinator: pre-check forward to committee', async () => {
      expect(must(await api(coord, 'POST', `/api/v1/requests/${id}/precheck`, { outcome: 'forward' }), 200, 'precheck').status === 'committee_review', 'not in committee_review');
    });
    await step('[ui] committee member: queue page renders', async () => {
      await c1.goto(BASE + '/committee', { waitUntil: 'networkidle' });
      await c1.waitForFunction(() => (document.querySelector('main')?.innerText ?? '').length > 20, null, { timeout: 15000 });
    });
    await step('[api] committee: two approve votes, second vote by the same member refused, decision recorded', async () => {
      must(await api(c1, 'PUT', `/api/v1/requests/${id}/votes`, { vote: 'approve' }), 200, 'vote 1');
      must(await api(c1, 'PUT', `/api/v1/requests/${id}/votes`, { vote: 'approve' }), 409, 'double vote');
      must(await api(c2, 'PUT', `/api/v1/requests/${id}/votes`, { vote: 'approve' }), 200, 'vote 2');
      const d = await api(c1, 'POST', `/api/v1/requests/${id}/decisions`, { outcome: 'approved' });
      expect(d.status === 201 || d.status === 409, `decision ${d.status} ${d.text}`);     // 409: quorum already closed the vote
      expect(must(await api(res, 'GET', `/api/v1/requests/${id}`), 200, 'get').status === 'approved', 'not approved');
    });
    let centerId;
    await step('[api] coordinator: resolve samples, start center coordination', async () => {
      const me = must(await api(clin, 'GET', '/api/v1/samples?limit=50&diagnosisCode=mb_shh'), 200, 'clinician samples');   // own center only (RLS)
      expect(me.items?.length >= 1, 'clinician center has no mb_shh sample');
      centerId = me.items[0].sourceCenterId;
      const item = must(await api(coord, 'GET', `/api/v1/requests/${id}`), 200, 'get').items[0].id;
      must(await api(coord, 'PUT', `/api/v1/requests/${id}/resolved-samples`, { itemId: item, sampleIds: me.items.slice(0, 2).map((s) => s.sampleCode) }), 204, 'resolved-samples');
      must(await api(coord, 'POST', `/api/v1/requests/${id}/transition`, { to: 'center_coordination' }), 200, 'to center_coordination');
    });
    await step('[api] clinician accepts, coordinator records MTA and starts delivery, clinician delivers', async () => {
      must(await api(clin, 'PATCH', `/api/v1/requests/${id}/steps/center_coordination`, { accepted: true, publicNote: 'SYNTHETIC: accepted' }), 200, 'center accept');
      must(await api(coord, 'PATCH', `/api/v1/requests/${id}/steps/mta_dta`, { centerId, agreement: { kind: 'mta', docRef: 'MTA-2026-001' } }), 200, 'mta');
      must(await api(coord, 'POST', `/api/v1/requests/${id}/transition`, { to: 'delivery' }), 200, 'to delivery');
      const bad = await api(coord, 'POST', `/api/v1/requests/${id}/transition`, { to: 'closed', closeReason: 'delivered' });
      expect(bad.status >= 400, 'coordinator could mark delivered');
      must(await api(clin, 'PATCH', `/api/v1/requests/${id}/steps/delivery`, { status: 'done' }), 200, 'delivered');
    });
    await step('[api] researcher: request is closed (delivered)', async () => {
      const r = must(await api(res, 'GET', `/api/v1/requests/${id}`), 200, 'get');
      expect(r.status === 'closed' && r.closeReason === 'delivered', `${r.status}/${r.closeReason}`);
    });
    await step('[api] admin: cannot read samples, cannot vote', async () => {
      must(await api(pages.system_admin, 'GET', '/api/v1/samples'), 403, 'admin samples');
      const v = await api(pages.system_admin, 'PUT', `/api/v1/requests/${id}/votes`, { vote: 'approve' });
      expect(v.status === 403 || v.status === 404, `admin vote ${v.status}`);
    });
    await step('[api] CORS: only the public site origin may post a public form; nothing else gets CORS headers', async () => {
      const pre = (o, p = '/api/v1/public/forms/contact') => fetch(BASE + p, { method: 'OPTIONS', headers: { origin: o, 'access-control-request-method': 'POST' } });
      const site = process.env.PUBLIC_SITE_ORIGIN ?? 'http://public.example.invalid';
      const good = await pre(site); expect(good.status === 204 && good.headers.get('access-control-allow-origin') === site && !good.headers.get('access-control-allow-credentials'), 'allowed origin refused');
      const evil = await pre('https://evil.example.invalid'); expect(!evil.headers.get('access-control-allow-origin'), 'foreign origin got CORS');
      const other = await pre(site, '/api/v1/auth/login'); expect(!other.headers.get('access-control-allow-origin'), 'CORS leaked to another route');
    });
  } finally { await browser.close(); }
}

main().catch(() => undefined).finally(() => {
  stopStack();
  const ok = results.filter((r) => r.ok).length;
  console.log(`\ne2e-fullstack: ${ok} passed, ${failed} failed (stopped at first failure) at ${BASE}`);
  process.exit(failed ? 1 : 0);
});
