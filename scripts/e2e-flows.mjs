#!/usr/bin/env node
// Major user flows against the REAL production build (API + built SPA + Render-like Postgres). Synthetic data only.
// Drives the browser UI, asserts text and state, and saves screenshots for human review.
//
//   pnpm test:e2e:flows            = node scripts/e2e-flows.mjs
//   Build first: pnpm -r build     (apps/api/dist, apps/web/dist, apps/public-site/dist)
//
// What it starts (and stops at the end):
//   - throwaway PostgreSQL 16 like Render (scripts/sim-render-db.sh: one NOSUPERUSER owner) on FLOWS_DB_PORT (55450)
//   - scripts/render-predeploy.mjs with SEED_SYNTHETIC=true, SEED_PROFILE=preview
//   - node apps/api/dist/server.js, NODE_ENV=production, DEMO_MODE=true, on FLOWS_API_PORT (18100)
//   - a static file server for apps/public-site/dist on FLOWS_SITE_PORT (18101)
// Output: docs/qa/flows/screenshots/NN-<flow>-<step>-<locale>.png and docs/qa/flows/results.json
//
// Steps marked [api] call the real API from inside the signed-in browser session (same cookies and CSRF header as the
// SPA). They are used ONLY where the UI has no screen for the action; the report names each one.
import { spawn, spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = createRequire(path.join(root, 'apps/web/package.json'))('@playwright/test')); }

const DB_PORT = Number(process.env.FLOWS_DB_PORT ?? 55450);
const API_PORT = Number(process.env.FLOWS_API_PORT ?? 18100);
const SITE_PORT = Number(process.env.FLOWS_SITE_PORT ?? 18101);
const BASE = `http://localhost:${API_PORT}`;
const SITE = `http://localhost:${SITE_PORT}`;
const PASSWORD = 'Synthetic-flows-only-2026!';
const OUT = path.join(root, 'docs/qa/flows');
const SHOTS = path.join(OUT, 'screenshots');
const PGDATA = `/tmp/ari-flows-pg-${DB_PORT}`;
const U = (slug) => `synthetic.${slug}@example.invalid`;

// ---- TOTP (RFC 6238), same derivation as scripts/seed-credentials.mjs
const totpKey = (email) => createHmac('sha256', PASSWORD).update('ari-pst-seed-totp:' + email).digest().subarray(0, 20);
const totpAt = (key, stepNo) => {
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(stepNo));
  const h = createHmac('sha1', key).update(buf).digest(); const o = h[19] & 15;
  return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0');
};
const lastStep = new Map();   // email -> TOTP time step already used (the server refuses a replayed code)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- results
const results = [];
let shotNo = 0;
let current = null;
function expect(cond, msg) { if (!cond) throw new Error(msg); }
async function step(flow, name, fn) {
  current = { flow, name, ok: true, notes: [], shots: [], api: false };
  const t0 = Date.now();
  try { const note = await fn(); if (note) current.notes.push(String(note)); }
  catch (e) { current.ok = false; current.error = String(e?.message ?? e).split('\n')[0].slice(0, 300); }
  current.ms = Date.now() - t0;
  results.push(current);
  console.log(`${current.ok ? 'ok  ' : 'FAIL'}  [${flow}] ${name}${current.api ? ' [api]' : ''}${current.error ? ': ' + current.error : ''}${current.notes.length ? '  (' + current.notes.join('; ').slice(0, 200) + ')' : ''}`);
  return current.ok;
}
const note = (s) => current?.notes.push(s);

// ---- page monitoring: console errors, page errors, failed requests, HTTP >= 400
function watch(page) {
  const b = { console: [], errors: [], failed: [], http: [], expected: [] };
  page.on('console', (m) => { if (m.type() === 'error') b.console.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => b.errors.push(String(e.message).slice(0, 200)));
  page.on('requestfailed', (r) => { const f = r.failure()?.errorText ?? ''; if (!/ERR_ABORTED/.test(f)) b.failed.push(`${r.method()} ${new URL(r.url()).pathname} ${f}`); });
  page.on('response', (r) => { if (r.status() >= 400) b.http.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`); });
  page.__b = b;
  return b;
}
/** Expect HTTP responses that match the pattern during this step (and their console lines). */
function allow(page, re) { page.__b.expected.push(re); }
function checkClean(page) {
  const b = page.__b;
  const ok = (s) => b.expected.some((re) => re.test(s));
  // The SPA probes the session on public pages: a 401 there is normal.
  const http = b.http.filter((s) => !/^401 GET \/api\/v1\/auth\/session/.test(s) && !ok(s));
  const consoleErr = b.console.filter((s) => !/status of 401/.test(s) && !(/Failed to load resource/.test(s) && b.http.some((h) => ok(h))));
  const problems = [...http.map((s) => 'http ' + s), ...b.failed.map((s) => 'net ' + s), ...b.errors.map((s) => 'pageerror ' + s), ...consoleErr.map((s) => 'console ' + s)];
  b.console = []; b.errors = []; b.failed = []; b.http = []; b.expected = [];
  if (problems.length) throw new Error('not clean: ' + problems.slice(0, 4).join(' | '));
}
// Direct identifiers that must never be on a screen of the portal (synthetic user e-mails are allowed only in the header).
const ID_PATTERNS = [
  ['national-ID-like 9-digit number', /(?<![0-9])[0-9]{9}(?![0-9])/],
  ['phone number', /(?<![0-9])(\+?972|0)[- ]?[0-9]{1,2}[- ]?[0-9]{3}[- ]?[0-9]{4}(?![0-9])/],
  ['e-mail address', /[^\s@]+@[^\s@]+\.[^\s@]+/],
];
async function noIdentifiers(page, scope = 'main') {
  const text = await page.locator(scope).first().innerText();
  for (const [what, re] of ID_PATTERNS) expect(!re.test(text), `${what} on screen: "${text.match(re)[0]}"`);
}
async function shot(page, flow, stepName, locale, opts = {}) {
  shotNo++;
  const file = `${String(shotNo).padStart(2, '0')}-${flow}-${stepName}-${locale}.png`;
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(SHOTS, file), fullPage: opts.fullPage ?? true });
  current?.shots.push(file);
  return file;
}
const mainText = (page) => page.locator('main').first().innerText();
async function waitMain(page, re, timeout = 15000) {
  await page.waitForFunction((src) => new RegExp(src).test(document.querySelector('main')?.innerText ?? ''), re.source, { timeout });
}

// ---- stack
let apiProc = null; let siteServer = null;
function sh(cmd, args, env) {
  const r = spawnSync(cmd, args, { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${path.basename(args[0] ?? cmd)} failed: ${(r.stderr || r.stdout).trim().split('\n').slice(-3).join(' | ')}`);
  return r.stdout.trim();
}
const dbEnv = { SIM_PGDATA: PGDATA, SIM_PGPORT: String(DB_PORT) };
async function startStack() {
  for (const f of ['apps/api/dist/server.js', 'apps/web/dist/index.html', 'apps/public-site/dist/index.html']) expect(existsSync(path.join(root, f)), `missing ${f}: run pnpm -r build first`);
  const ownerUrl = sh('bash', ['scripts/sim-render-db.sh', '--reset'], dbEnv).split('\n').pop();
  const u = new URL(ownerUrl);
  const env = {
    NODE_ENV: 'production', DATA_CLASSIFICATION: 'synthetic', DEMO_MODE: 'true', SEED_SYNTHETIC: 'true', SEED_PROFILE: 'preview', SEED_USER_PASSWORD: PASSWORD,
    DATABASE_URL_OWNER: ownerUrl, DB_HOST: u.hostname, DB_PORT: u.port, DB_NAME: u.pathname.slice(1),
    DB_PASSWORD_MIGRATOR: 'flows-migrator-0123456789', DB_PASSWORD_RUNTIME: 'flows-runtime-0123456789', DB_PASSWORD_BG: 'flows-bg-0123456789',
    IP_HASH_SALT: 'flows-only-ip-hash-salt-0123456789', SECRETS_KEY: 'flows-only-secrets-key-0123456789',
    PORT: String(API_PORT), RENDER_EXTERNAL_URL: BASE, PUBLIC_ORIGIN: '', WEB_DIST_DIR: 'apps/web/dist', PUBLIC_SITE_ORIGIN: SITE,
    RENDER_GIT_COMMIT: 'flows-local-sha', RATE_TIGHT_PER_MIN: '200', DATABASE_URL: '', DATABASE_URL_MIGRATOR: '',
  };
  const seed = sh(process.execPath, ['scripts/render-predeploy.mjs'], env);
  apiProc = spawn(process.execPath, ['apps/api/dist/server.js'], { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'ignore', 'inherit'] });
  for (let i = 0; i < 80; i++) { try { const r = await fetch(BASE + '/readyz'); if (r.ok) break; } catch { /* not up yet */ } await sleep(500); }
  const ready = await (await fetch(BASE + '/readyz')).json();
  expect(ready.status === 'ok', 'readyz ' + JSON.stringify(ready));
  siteServer = startSite();
  return `readyz ok, version ${ready.version}, migration ${ready.checks?.migrationApplied}; seed: ${seed.split('\n').filter((l) => /"ok"/.test(l)).pop()?.slice(0, 160) ?? 'done'}`;
}
function startSite() {
  const dist = path.join(root, 'apps/public-site/dist');
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain', '.woff2': 'font/woff2', '.webp': 'image/webp', '.ico': 'image/x-icon' };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, SITE).pathname);
    let f = path.join(dist, p);
    if (!f.startsWith(dist)) { res.writeHead(400); return res.end(); }
    if (existsSync(f) && statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!existsSync(f)) { res.writeHead(404, { 'content-type': 'text/html' }); return res.end(readFileSync(path.join(dist, '404.html'))); }
    res.writeHead(200, { 'content-type': types[path.extname(f)] ?? 'application/octet-stream' }); res.end(readFileSync(f));
  });
  srv.listen(SITE_PORT);
  return srv;
}
function stopStack() {
  if (apiProc) { apiProc.kill('SIGTERM'); apiProc = null; }
  if (siteServer) { siteServer.close(); siteServer = null; }
  spawnSync('bash', ['scripts/sim-render-db.sh', '--stop'], { cwd: root, env: { ...process.env, ...dbEnv } });
  rmSync(PGDATA, { recursive: true, force: true });
}

// ---- browser helpers
let browser;
const DESKTOP = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 };
const MOBILE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
async function newPage(locale, device = DESKTOP) {
  const ctx = await browser.newContext({ ...device, locale: locale === 'he' ? 'he-IL' : 'en-US' });
  const page = await ctx.newPage();
  watch(page);
  return page;
}
async function setLang(page, locale) {
  const label = locale === 'he' ? 'עברית' : 'English';
  const btn = page.getByRole('button', { name: label, exact: true }).first();
  if ((await btn.getAttribute('aria-pressed')) === 'true' || (await btn.getAttribute('aria-current')) === 'true') return;
  await btn.click();
  await page.waitForFunction((l) => document.documentElement.lang.startsWith(l), locale, { timeout: 5000 });
}
async function freshCode(email) {
  let s = Math.floor(Date.now() / 30000);
  if (lastStep.get(email) === s) { await sleep(30000 - (Date.now() % 30000) + 300); s = Math.floor(Date.now() / 30000); }
  lastStep.set(email, s);
  return totpAt(totpKey(email), s);
}
/** Signs in through the UI. With flow/locale set, saves the login and MFA screens. */
async function signIn(page, email, locale, { flow, shots = false } = {}) {
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await setLang(page, locale);
  await page.getByLabel(/e-?mail|דוא/i).first().fill(email);
  await page.locator('input[type=password]').fill(PASSWORD);
  if (shots) await shot(page, flow, 'login', locale);
  await page.locator('form button[type=submit]').click();
  await page.waitForURL(/\/login\/mfa/, { timeout: 15000 });
  await page.locator('form input').first().waitFor();
  if (shots) {
    expect(/Second step|שלב שני/.test(await mainText(page)), 'MFA screen title not shown');
    await shot(page, flow, 'mfa', locale);
  }
  await page.locator('form input').first().fill(await freshCode(email));
  await page.locator('form button[type=submit]').first().click();
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 15000 });
  await page.waitForLoadState('networkidle');
}
/** Same-origin API call with the session cookie and CSRF header (as the SPA). Marks the step as [api]. */
async function api(page, method, url, body, headers = {}) {
  if (current) current.api = true;
  return page.evaluate(async ([m, u, b, h]) => {
    const csrf = document.cookie.split('; ').find((c) => c.startsWith('__Host-csrf='))?.split('=')[1] ?? '';
    const r = await fetch(u, { method: m, credentials: 'same-origin', headers: { ...(b !== null ? { 'content-type': 'application/json' } : {}), 'x-csrf-token': csrf, ...h }, ...(b !== null ? { body: JSON.stringify(b) } : {}) });
    const text = await r.text(); let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
    return { status: r.status, json, text: text.slice(0, 300) };
  }, [method, url, body ?? null, headers]);
}
/** Read-only lookups that only plan the test (which codes exist). They do not count as UI work. */
async function lookup(page, method, url, body) { const was = current?.api; const r = await api(page, method, url, body); if (current) current.api = was; return r; }
const must = (r, status, what) => { expect(r.status === status, `${what}: expected ${status}, got ${r.status} ${r.text}`); return r.json; };
async function trackerSteps(page) {
  const lis = page.locator('ol.ds-stepper > li');
  const n = await lis.count();
  const cur = await page.locator('ol.ds-stepper > li[aria-current=step] .ds-step-title').first().innerText().catch(() => null);
  const done = await page.locator('ol.ds-stepper > li.ds-step-done').count();
  return { n, cur, done };
}
async function signOut(page) {
  await page.getByRole('button', { name: /Sign out|התנתקות/ }).first().click();
  await page.waitForURL((u) => /\/login|\/session-ended/.test(u.pathname), { timeout: 10000 });
}

// ---- the flows
const S = {};   // shared state between flows
async function main() {
  mkdirSync(SHOTS, { recursive: true });
  for (const f of (await import('node:fs')).readdirSync(SHOTS)) if (f.endsWith('.png')) rmSync(path.join(SHOTS, f));
  const up = await step('setup', 'start Render-like DB, predeploy with synthetic seed, API (production build), public site', startStack);
  if (!up) return;
  browser = await chromium.launch();

  // a. Sign in --------------------------------------------------------------------------------------------------
  const res = await newPage('he');
  await step('a-signin', 'researcher_il signs in with password + TOTP (he), lands on role home', async () => {
    await signIn(res, U('researcher.a'), 'he', { flow: 'a-signin', shots: true });
    expect(new URL(res.url()).pathname === '/home', 'not on /home: ' + res.url());
    await waitMain(res, /שלום/);
    expect(await res.evaluate(() => document.documentElement.dir) === 'rtl', 'page is not RTL');
    await noIdentifiers(res);
    await shot(res, 'a-signin', 'home', 'he');
    checkClean(res);
  });
  await step('a-signin', 'researcher_il signs out (he)', async () => {
    await signOut(res);
    await shot(res, 'a-signin', 'signed-out', 'he');
    checkClean(res);
  });
  const resEn = await newPage('en');
  await step('a-signin', 'researcher_il (second user) signs in and out in English', async () => {
    await signIn(resEn, U('researcher.b'), 'en', { flow: 'a-signin', shots: true });
    await waitMain(resEn, /Hello/);
    expect(await resEn.evaluate(() => document.documentElement.dir) === 'ltr', 'page is not LTR');
    await shot(resEn, 'a-signin', 'home', 'en');
    await signOut(resEn);
    checkClean(resEn);
  });
  await step('a-signin', 'mobile 390x844: sign-in and MFA screens (he)', async () => {
    const m = await newPage('he', MOBILE);
    await signIn(m, U('researcher.c'), 'he', { flow: 'a-signin-mobile', shots: true });
    await shot(m, 'a-signin-mobile', 'home', 'he');
    checkClean(m);
    await m.context().close();
  });
  await resEn.context().close();

  // b. Researcher search ----------------------------------------------------------------------------------------
  await step('b-search', 'researcher_il signs in again and opens Search from the navigation', async () => {
    await signIn(res, U('researcher.a'), 'he');
    await res.getByRole('link', { name: 'חיפוש' }).first().click();
    await res.waitForURL(/\/search/);
    await res.locator('.ds-tile[data-state=value]').first().waitFor({ timeout: 15000 });
    await shot(res, 'b-search', 'start', 'he');
    checkClean(res);
  });
  // Plan the filter combination: find a diagnosis present in the seed, and an age band that makes the count suppressed.
  await step('b-search', 'plan: pick a diagnosis, sample type and age band that exist in the synthetic seed', async () => {
    const dx = await lookup(res, 'GET', '/api/v1/diagnoses');
    const terms = (dx.json?.items ?? dx.json ?? []).filter((d) => d.level === 'type');
    const agg = async (filters) => (await lookup(res, 'POST', '/api/v1/search/aggregate', { filters })).json;
    let pick = null;
    for (const code of ['mb_shh', 'neuroblastoma', 'mb_group3', ...terms.map((t) => t.diagnosisCode)]) {
      if (!terms.some((t) => t.diagnosisCode === code)) continue;
      const a = await agg({ diagnosis: [code], sampleType: ['ffpe'] });
      if (a && !a.suppressed && a.count >= 5) {
        for (const band of ['0_lt1', '15_lt18', '1_lt3', '10_lt15', '6_lt10', '3_lt6']) {
          const b2 = await agg({ diagnosis: [code], sampleType: ['ffpe'], ageBand: [band] });
          if (b2?.suppressed) { pick = { code, band, count: a.count }; break; }
        }
      }
      if (pick) break;
    }
    expect(pick, 'no diagnosis/age band combination with one value and one suppressed count');
    const term = terms.find((t) => t.diagnosisCode === pick.code);
    S.search = { ...pick, he: term.labelHe, en: term.labelEn };
    return `diagnosis ${pick.code} + FFPE = ${pick.count}; adding age band ${pick.band} is suppressed`;
  });
  const facet = async (page, legend, option) => {
    const toggle = page.locator('button.ds-facet-toggle', { hasText: legend });
    if (await toggle.count() && (await toggle.first().getAttribute('aria-expanded')) === 'false') await toggle.first().click();
    await page.locator('.ds-facet').filter({ hasText: legend }).getByRole('checkbox', { name: option }).first().check();
    await page.waitForTimeout(600); await page.waitForLoadState('networkidle');
  };
  const ageLabel = { he: { '0_lt1': /מתחת לשנה|0/, }, en: {} };
  void ageLabel;
  await step('b-search', 'filter diagnosis + sample type FFPE: count tile shows a number', async () => {
    await facet(res, 'אבחנה', S.search.he);
    await facet(res, 'סוג דגימה', /FFPE/);
    await res.waitForFunction(() => document.querySelector('.ds-tile')?.getAttribute('data-state') === 'value', null, { timeout: 10000 });
    const v = await res.locator('.ds-tile .ds-tile-value').first().innerText();
    expect(Number(v.replace(/[^0-9]/g, '')) === S.search.count, `tile shows ${v}, API said ${S.search.count}`);
    expect(new URL(res.url()).searchParams.get('dx') === S.search.code, 'filter not in URL');
    await shot(res, 'b-search', 'filtered-count', 'he');
    checkClean(res);
    return `tile ${v}`;
  });
  await step('b-search', 'add an age band: tile shows "Too few to show", no number, add-to-cart disabled', async () => {
    const ageToggle = res.locator('button.ds-facet-toggle', { hasText: 'גיל' }).first();
    if ((await ageToggle.getAttribute('aria-expanded')) === 'false') await ageToggle.click();
    const ageBox = res.locator('.ds-facet').filter({ hasText: 'גיל' }).getByRole('checkbox');
    // The age bands are listed in ENUM order: 0_lt1 1_lt3 3_lt6 6_lt10 10_lt15 15_lt18
    const order = ['0_lt1', '1_lt3', '3_lt6', '6_lt10', '10_lt15', '15_lt18'];
    await ageBox.nth(order.indexOf(S.search.band)).check();
    await res.waitForFunction(() => document.querySelector('.ds-tile')?.getAttribute('data-state') === 'suppressed', null, { timeout: 10000 });
    const tile = await res.locator('.ds-tile').first().innerText();
    expect(/מעט מדי להצגה/.test(tile), 'suppressed label missing: ' + tile);
    expect(!/[0-9]/.test(tile), 'suppressed tile prints a number: ' + tile);
    expect(await res.getByRole('button', { name: 'הוספה לסל הבקשה' }).isDisabled(), 'add-to-cart is enabled on a suppressed count');
    const t = await mainText(res);
    expect(!/k\s*=|k ≥|סף|threshold|פחות מ-?5|<\s*5/i.test(t), 'a threshold is printed');
    await shot(res, 'b-search', 'suppressed-too-few', 'he');
    checkClean(res);
  });
  await step('b-search', 'remove the age band chip, add the search to the request cart', async () => {
    await res.locator('.chips').getByRole('button').filter({ hasNotText: /ניקוי/ }).last().click();
    await res.waitForFunction(() => document.querySelector('.ds-tile')?.getAttribute('data-state') === 'value', null, { timeout: 10000 });
    await res.getByRole('button', { name: 'הוספה לסל הבקשה' }).click();
    await res.getByRole('status').filter({ hasText: 'נוסף לסל הבקשה' }).waitFor({ timeout: 10000 });
    await shot(res, 'b-search', 'added-to-cart', 'he');
    await noIdentifiers(res);
    checkClean(res);
  });
  await step('b-search', 'English: same search shows the count and the suppressed tile', async () => {
    await setLang(res, 'en');
    await res.waitForFunction(() => document.querySelector('.ds-tile')?.getAttribute('data-state') === 'value', null, { timeout: 10000 });
    await shot(res, 'b-search', 'filtered-count', 'en');
    const ageToggle = res.locator('button.ds-facet-toggle', { hasText: /Age/ }).first();
    if ((await ageToggle.getAttribute('aria-expanded')) === 'false') await ageToggle.click();
    const order = ['0_lt1', '1_lt3', '3_lt6', '6_lt10', '10_lt15', '15_lt18'];
    await res.locator('.ds-facet').filter({ hasText: /Age/ }).getByRole('checkbox').nth(order.indexOf(S.search.band)).check();
    await res.waitForFunction(() => document.querySelector('.ds-tile')?.getAttribute('data-state') === 'suppressed', null, { timeout: 10000 });
    expect(/Too few to show/.test(await res.locator('.ds-tile').first().innerText()), 'English suppressed label missing');
    await shot(res, 'b-search', 'suppressed-too-few', 'en');
    await setLang(res, 'he');
    checkClean(res);
  });
  await step('b-search', 'mobile 390x844: search with filters (he)', async () => {
    const m = await newPage('he', MOBILE);
    await signIn(m, U('researcher.c'), 'he');
    await m.goto(`${BASE}/search?dx=${S.search.code}&type=ffpe`, { waitUntil: 'networkidle' });
    await m.locator('.ds-tile[data-state=value]').first().waitFor({ timeout: 15000 });
    const sw = await m.evaluate(() => document.documentElement.scrollWidth);
    expect(sw <= 390, `horizontal scroll on mobile: scrollWidth ${sw}`);
    await shot(m, 'b-search-mobile', 'filtered-count', 'he');
    checkClean(m);
    await m.context().close();
  });

  // c. Request for approval -------------------------------------------------------------------------------------
  await step('c-request', 'open the cart and start a request', async () => {
    await res.goto(BASE + '/cart', { waitUntil: 'networkidle' });
    const t = await mainText(res);
    expect(t.includes(S.search.he), 'cart item does not name the diagnosis');
    await shot(res, 'c-request', 'cart', 'he');
    await res.getByRole('button', { name: 'התחלת בקשה' }).click();
    await res.waitForURL(/\/requests\/new\?draft=req_/);
    S.reqId = new URL(res.url()).searchParams.get('draft');
    await waitMain(res, /שאלת המחקר/);
    checkClean(res);
    return S.reqId;
  });
  const cont = () => res.locator('main form').getByRole('button', { name: 'המשך' }).click();
  await step('c-request', 'identifier guard: an ID-number-like string is refused and nothing is sent', async () => {
    let patches = 0; const onReq = (r) => { if (r.method() === 'PATCH' && r.url().includes('/requests/')) patches++; };
    res.on('request', onReq);
    await res.locator('#field-researchQuestion').fill('SYNTHETIC: compare pathway X in sample of patient 123456789');
    await cont();
    await res.locator('[role=alert]').first().waitFor({ timeout: 5000 });
    const t = await mainText(res);
    expect(/שלב 1 מתוך 5|1 מתוך 5/.test(t), 'wizard left step 1');
    const err = await res.locator('#field-researchQuestion').getAttribute('aria-invalid');
    expect(err === 'true', 'field not marked invalid');
    await shot(res, 'c-request', 'identifier-refused', 'he');
    res.off('request', onReq);
    expect(patches === 0, `identifying text was sent to the server (${patches} PATCH)`);
    checkClean(res);
    return (await res.locator('[role=alert]').allInnerTexts()).join(' | ').slice(0, 140);
  });
  await step('c-request', 'fill research question, IRB/Helsinki reference (bad format refused, then valid), planned use, funding', async () => {
    await res.locator('#field-researchQuestion').fill('SYNTHETIC: does pathway X expression differ between molecular subtypes?');
    await cont();
    await res.locator('#field-applicantEthicsRef').waitFor();
    await res.locator('#field-applicantEthicsRef').fill('IRB #12');
    await cont();
    await waitMain(res, /3 עד 64/);
    await shot(res, 'c-request', 'ethics-ref-format', 'he');
    await res.locator('#field-applicantEthicsRef').fill('HC-2024-0012');
    await cont();
    await res.locator('#field-plannedUse').fill('SYNTHETIC: expression profiling of archived FFPE tissue sections.');
    await cont();
    await res.locator('#field-fundingSources').fill('Synthetic Foundation research grant');
    await cont();
    await waitMain(res, /בדיקה ושליחה/);
    await res.locator('#field-declaration').check();
    await shot(res, 'c-request', 'review', 'he');
    checkClean(res);
  });
  await step('c-request', 'submit; confirmation; the tracker shows 8 steps', async () => {
    await res.locator('main form').getByRole('button', { name: 'שליחת בקשה' }).click();
    await waitMain(res, /הבקשה נשלחה/);
    expect((await res.getByTestId('request-id').innerText()) === S.reqId, 'request id differs');
    await shot(res, 'c-request', 'sent', 'he');
    await res.getByRole('button', { name: 'מעקב אחרי הבקשה' }).click();
    await res.waitForURL(new RegExp(`/requests/${S.reqId}$`));
    await res.locator('ol.ds-stepper').waitFor();
    const tr = await trackerSteps(res);
    expect(tr.n === 8, `tracker has ${tr.n} steps`);
    await noIdentifiers(res);
    await shot(res, 'c-request', 'tracker-submitted', 'he');
    const st = (await lookup(res, 'GET', `/api/v1/requests/${S.reqId}`)).json?.status;
    checkClean(res);
    return `status ${st}, current step "${tr.cur}"`;
  });

  // d. National coordinator pre-check ----------------------------------------------------------------------------
  const coord = await newPage('he');
  await step('d-precheck', 'national_coordinator signs in; home shows the pre-check queue', async () => {
    await signIn(coord, U('coordinator.a'), 'he');
    await waitMain(coord, /ממתינות לבדיקה מקדימה/);
    await shot(coord, 'd-precheck', 'home', 'he');
    checkClean(coord);
  });
  await step('d-precheck', 'open the request from the requests list and the pre-check page', async () => {
    await coord.getByRole('link', { name: 'בקשות' }).first().click();
    await coord.waitForURL(/\/requests$/);
    await coord.locator(`main a[href="/requests/${S.reqId}"]`).first().click();
    await coord.waitForURL(new RegExp(`/requests/${S.reqId}$`));
    await shot(coord, 'd-precheck', 'request-detail', 'he');
    const link = coord.getByRole('link', { name: /בדיקה מקדימה|פתיחת/ }).filter({ has: coord.locator('.ds-btn-label') });
    if (await link.count()) await link.first().click();
    else {
      note('UI GAP: no pre-check button on the request page (status "submitted"); opened /requests/:id/precheck by URL');
      await coord.goto(`${BASE}/requests/${S.reqId}/precheck`, { waitUntil: 'networkidle' });
    }
    await waitMain(coord, /HC-2024-0012/);
    checkClean(coord);
  });
  await step('d-precheck', 'tick the checklist, choose "Send to the committee", save', async () => {
    for (const cb of await coord.locator('main input[type=checkbox]').all()) await cb.check();
    await coord.getByRole('radio', { name: 'העברה לוועדה' }).check();
    await shot(coord, 'd-precheck', 'precheck-form', 'he');
    await coord.getByRole('button', { name: 'שמירת החלטה' }).click();
    await coord.waitForURL(new RegExp(`/requests/${S.reqId}$`));
    await waitMain(coord, /הוועדה בוחנת את הבקשה/);
    await shot(coord, 'd-precheck', 'forwarded', 'he');
    checkClean(coord);
  });

  // e. Committee N-of-M ------------------------------------------------------------------------------------------
  const vote = async (slug, locale, flowStep) => {
    const p = await newPage(locale);
    await signIn(p, U(slug), locale);
    expect(new URL(p.url()).pathname === '/committee', 'committee home is not /committee');
    await p.locator(`main a[href="/requests/${S.reqId}/decision"]`).first().click();
    await p.waitForURL(/\/decision$/);
    await p.getByTestId('tally').waitFor();
    const before = await p.getByTestId('tally').innerText();
    await shot(p, 'e-committee', `${flowStep}-before`, locale);
    await p.getByRole('radio', { name: locale === 'he' ? 'אישור' : /^Approve/ }).check();
    await p.getByRole('button', { name: locale === 'he' ? 'שליחת הצבעה' : 'Cast vote' }).click();
    await p.waitForFunction((b) => document.querySelector('[data-testid=tally]')?.textContent !== b, before, { timeout: 10000 });
    const after = await p.getByTestId('tally').innerText();
    await shot(p, 'e-committee', `${flowStep}-after`, locale);
    checkClean(p);
    return { p, before, after };
  };
  let lastVoter;
  await step('e-committee', 'committee member A (he) opens the queue and votes approve', async () => {
    const { p, before, after } = await vote('committee.a', 'he', 'vote1');
    await p.context().close();
    return `tally "${before}" -> "${after}"`;
  });
  await step('e-committee', 'committee member B (en) votes approve; quorum reached; records approval', async () => {
    const { p, after } = await vote('committee.b', 'en', 'vote2');
    lastVoter = p;
    const m = after.match(/(\d+) of (\d+)/); expect(m && Number(m[1]) >= Number(m[2]), 'quorum not reached: ' + after);
    await p.getByRole('button', { name: 'Record approval' }).click();
    await p.waitForURL(/\/committee$/);
    await shot(p, 'e-committee', 'queue-after', 'en');
    checkClean(p);
    return after;
  });
  await step('e-committee', 'researcher tracker shows "Approved", committee step done', async () => {
    await res.reload({ waitUntil: 'networkidle' });
    await waitMain(res, /אושרה/);
    await shot(res, 'e-committee', 'tracker-approved', 'he');
    checkClean(res);
    await lastVoter?.context().close();
  });

  // f. Coordination -> agreements -> delivery -> closed ----------------------------------------------------------
  const clin = await newPage('he');
  await step('f-delivery', 'coordinator: "Center coordination" card on the approved request (UI button)', async () => {
    await coord.reload({ waitUntil: 'networkidle' });
    await waitMain(coord, /תיאום מרכז/);
    allow(coord, /PATCH \/api\/v1\/requests\/.*\/steps\//);
    await coord.getByRole('button', { name: 'סימון תיאום כהושלם' }).click();
    await coord.waitForTimeout(1500);
    const alert = await coord.locator('main [role=alert], main .ds-alert-danger').allInnerTexts();
    await shot(coord, 'f-delivery', 'coordination-button', 'he');
    const st = (await lookup(coord, 'GET', `/api/v1/requests/${S.reqId}`)).json?.status;
    checkClean(coord);
    if (st === 'approved') throw new Error(`UI GAP: the button does not move the request (status still "${st}"; alert: ${alert.join(' ').slice(0, 120) || 'none'}). No UI exists to resolve samples, start center coordination, record an MTA/DTA or mark delivery; the clinician cannot open /requests`);
    return 'status ' + st;
  });
  await step('f-delivery', '[api] coordinator resolves samples and starts center coordination (no screen for this)', async () => {
    await signIn(clin, U('clinician.a'), 'he');
    const me = must(await api(clin, 'GET', `/api/v1/samples?limit=50&diagnosisCode=${S.search.code}`), 200, 'clinician samples');
    expect(me.items?.length >= 1, 'clinician center has no sample of the requested diagnosis');
    S.centerId = me.items[0].sourceCenterId;
    const r = must(await api(coord, 'GET', `/api/v1/requests/${S.reqId}`), 200, 'get');
    must(await api(coord, 'PUT', `/api/v1/requests/${S.reqId}/resolved-samples`, { itemId: r.items[0].id, sampleIds: me.items.slice(0, 2).map((s) => s.sampleCode) }), 204, 'resolved-samples');
    must(await api(coord, 'POST', `/api/v1/requests/${S.reqId}/transition`, { to: 'center_coordination' }), 200, 'to center_coordination');
    await res.reload({ waitUntil: 'networkidle' });
    expect((await trackerSteps(res)).cur?.includes('תיאום'), 'tracker not at coordination');
    await shot(res, 'f-delivery', 'tracker-coordination', 'he');
  });
  await step('f-delivery', '[api] clinician accepts for the center; coordinator records the MTA (no screen for this)', async () => {
    must(await api(clin, 'PATCH', `/api/v1/requests/${S.reqId}/steps/center_coordination`, { accepted: true, publicNote: 'SYNTHETIC: center accepted' }), 200, 'center accept');
    await res.reload({ waitUntil: 'networkidle' });
    await waitMain(res, /MTA\/DTA/);
    await shot(res, 'f-delivery', 'tracker-agreements', 'he');
    must(await api(coord, 'PATCH', `/api/v1/requests/${S.reqId}/steps/mta_dta`, { centerId: S.centerId, agreement: { kind: 'mta', docRef: 'MTA-2026-001' } }), 200, 'mta');
    must(await api(coord, 'POST', `/api/v1/requests/${S.reqId}/transition`, { to: 'delivery' }), 200, 'to delivery');
    await res.reload({ waitUntil: 'networkidle' });
    await waitMain(res, /המסירה בהכנה/);
    await shot(res, 'f-delivery', 'tracker-delivery', 'he');
  });
  await step('f-delivery', '[api] clinician confirms delivery; researcher tracker shows "Closed" (delivered)', async () => {
    must(await api(clin, 'PATCH', `/api/v1/requests/${S.reqId}/steps/delivery`, { status: 'done' }), 200, 'delivered');
    await res.reload({ waitUntil: 'networkidle' });
    await waitMain(res, /נמסרה\./);
    const tr = await trackerSteps(res);
    expect(tr.n === 8, 'tracker not 8 steps');
    expect(tr.done >= 7, `only ${tr.done} steps done`);
    await noIdentifiers(res);
    await shot(res, 'f-delivery', 'tracker-closed', 'he');
    await setLang(res, 'en');
    await waitMain(res, /Delivered\./);
    await shot(res, 'f-delivery', 'tracker-closed', 'en');
    await setLang(res, 'he');
    checkClean(res);
    return `${tr.done} of ${tr.n} steps done, current "${tr.cur}"`;
  });
  await step('f-delivery', 'mobile 390x844: researcher tracker at "Closed" (he)', async () => {
    const m = await newPage('he', MOBILE);
    m.context().addCookies(await res.context().cookies());
    await m.goto(`${BASE}/requests/${S.reqId}`, { waitUntil: 'networkidle' });
    await waitMain(m, /נמסרה\./);
    await shot(m, 'f-delivery-mobile', 'tracker-closed', 'he');
    checkClean(m);
    await m.context().close();
  });

  // g. Clinician own-center view ---------------------------------------------------------------------------------
  await step('g-clinician', 'clinician lands on samples: own center only, coded records', async () => {
    await clin.goto(BASE + '/samples', { waitUntil: 'networkidle' });
    await waitMain(clin, /בלבד/);
    const centerName = (await clin.locator('main .ds-alert').first().innerText()).replace(/^.*מוצג\s*|\s*בלבד.*$/gs, '').trim();
    const centerCells = await clin.locator('main table tbody tr td:nth-child(6)').allInnerTexts();
    expect(centerCells.length > 0, 'no rows');
    expect(centerCells.every((c) => c.trim() === centerName), `rows from other centers: ${[...new Set(centerCells)].join(', ')}`);
    await noIdentifiers(clin);
    await shot(clin, 'g-clinician', 'samples-own-center', 'he');
    checkClean(clin);
    return `${centerCells.length} rows, all "${centerName}"`;
  });
  await step('g-clinician', 'clinician opens a record: coded id, month-only date, no identity, pointer to the center system', async () => {
    await clin.locator('main table tbody tr td a').first().click();
    await clin.waitForURL(/\/samples\/smp_/);
    await waitMain(clin, /המערכת של המרכז/);
    const t = await mainText(clin);
    expect(/ברשומה זו אין זהות מטופל/.test(t), 'no-identity notice missing');
    expect(!/(?<![0-9])[0-9]{1,2}[./-][0-9]{1,2}[./-][0-9]{2,4}(?![0-9])/.test(t.split('אימות אחרון')[0] ?? t), 'an exact date is shown in the record fields');
    const links = await clin.locator('main a[href^="http"]').count();
    if (!links) note('Link-out to the center system is a text pointer, not a hyperlink (no URL per center in the index)');
    await noIdentifiers(clin);
    await shot(clin, 'g-clinician', 'sample-detail', 'he');
    checkClean(clin);
  });
  await step('g-clinician', "another center's record is not visible to the clinician (404)", async () => {
    const all = must(await lookup(coord, 'GET', '/api/v1/samples?limit=100'), 200, 'coordinator samples');
    const other = all.items.find((s) => s.sourceCenterId !== S.centerId);
    expect(other, 'no sample from another center');
    allow(clin, /^404 GET \/api\/v1\/samples\//);
    await clin.goto(`${BASE}/samples/${other.sampleCode}`, { waitUntil: 'networkidle' });
    await clin.waitForTimeout(800);
    const t = await mainText(clin);
    expect(!t.includes('המערכת של המרכז'), 'the other center record rendered');
    await shot(clin, 'g-clinician', 'other-center-hidden', 'he');
    checkClean(clin);
    return t.split('\n').slice(0, 2).join(' / ').slice(0, 120);
  });

  // h. Coordinator sample entry and CSV import dry-run ----------------------------------------------------------
  await step('h-ingest', 'coordinator adds one coded record through the form', async () => {
    await coord.goto(BASE + '/samples/new', { waitUntil: 'networkidle' });
    for (const sel of await coord.locator('main form select').all()) await sel.selectOption({ index: 1 });
    await coord.locator('#field-collectionMonth').fill('2025-03');
    await shot(coord, 'h-ingest', 'sample-entry', 'he');
    await coord.locator('main form button[type=submit]').click();
    await coord.waitForURL(/\/samples\/smp_/, { timeout: 15000 });
    await waitMain(coord, /ברשומה זו אין זהות מטופל/);
    await shot(coord, 'h-ingest', 'sample-created', 'he');
    checkClean(coord);
    return new URL(coord.url()).pathname;
  });
  await step('h-ingest', 'CSV import dry-run: good and bad rows, rejection report', async () => {
    const centers = (await lookup(coord, 'GET', '/api/v1/centers')).json;
    const c = (centers.items ?? centers)[0];
    const hdr = (await lookup(coord, 'GET', '/api/v1/import-templates/csv')).text.trim().split(',');
    const row = (o) => hdr.map((h) => o[h] ?? '').join(',');
    const good = { source_center_code: c.code, diagnosis_source_value: S.search.code, age_band_at_diagnosis: '6_lt10', sex: 'female', sample_type: 'ffpe', availability: 'available', quantity_class: 'medium', clinical_timepoint: 'diagnosis', collection_month: '2024-05', consent_status: 'broad_consent', verified: 'true' };
    const csv = [hdr.join(','), row(good),
      row({ ...good, collection_month: '2024-05-17' }),          // exact date: refused
      row({ ...good, sex: 'unknown_value' }),                    // not in vocabulary
      row({ ...good, ethics_approval_ref: '123456789' }),        // ID-number-like text
    ].join('\n') + '\n';
    const file = path.join(OUT, '.import-dry-run.csv'); writeFileSync(file, csv);
    await coord.goto(BASE + '/import/new', { waitUntil: 'networkidle' });
    await coord.locator('#field-file').setInputFiles(file);
    rmSync(file);
    await shot(coord, 'h-ingest', 'import-upload', 'he');
    await coord.locator('main form button[type=submit]').click();
    await coord.waitForURL(/\/import\/imp_|\/import\/[a-z]+_/, { timeout: 15000 });
    await coord.waitForFunction(() => /\d/.test(document.querySelectorAll('.ds-tile .ds-tile-value')[3]?.textContent ?? ''), null, { timeout: 20000 });
    const tiles = await coord.locator('.ds-tile .ds-tile-value').allInnerTexts();
    await coord.waitForLoadState('networkidle');
    const t = await mainText(coord);
    expect(Number(tiles[3]) >= 2, `rejected rows ${tiles[3]}`);
    expect(/הורד|דוח/.test(t), 'no rejection report link');
    await shot(coord, 'h-ingest', 'import-dry-run-report', 'he');
    checkClean(coord);
    return `total ${tiles[0]}, accepted ${tiles[1]}, warnings ${tiles[2]}, rejected ${tiles[3]} (dry run, not committed)`;
  });

  // i. Admin audit ----------------------------------------------------------------------------------------------
  const adm = await newPage('he');
  await step('i-admin', 'system_admin signs in; home says the role sees no sample data', async () => {
    await signIn(adm, U('admin.a'), 'he');
    await waitMain(adm, /לתפקיד זה אין גישה לנתוני דגימות/);
    await shot(adm, 'i-admin', 'home', 'he');
    checkClean(adm);
  });
  await step('i-admin', 'audit log lists the events of this flow; chain verification says intact', async () => {
    await adm.getByRole('link', { name: 'ביקורת' }).first().click();
    await adm.waitForURL(/\/audit/);
    await adm.locator('main table tbody tr').first().waitFor();
    await adm.getByRole('button', { name: 'בדיקת שלמות' }).click();
    await waitMain(adm, /שרשרת הביקורת שלמה/);
    const actions = (await adm.locator('main table tbody tr td:nth-child(4)').allInnerTexts()).map((s) => s.trim());
    const want = ['request.deliver', 'request.state_changed', 'request.vote'];
    const seen = want.filter((w) => actions.includes(w));
    await noIdentifiers(adm);
    await shot(adm, 'i-admin', 'audit-verified', 'he');
    expect(seen.length === want.length, `missing on page 1: ${want.filter((w) => !seen.includes(w)).join(', ')} (seen: ${[...new Set(actions)].slice(0, 8).join(', ')})`);
    checkClean(adm);
    return `${actions.length} rows on page 1; flow actions seen: ${seen.join(', ')}`;
  });
  await step('i-admin', 'admin cannot open sample data (UI 403 page, and API 403)', async () => {
    await adm.goto(BASE + '/samples', { waitUntil: 'networkidle' });
    await waitMain(adm, /אין אפשרות לפתוח את הדף|לא ניתן לפתוח|You cannot open/);
    await shot(adm, 'i-admin', 'samples-forbidden', 'he');
    checkClean(adm);
    allow(adm, /^403 GET \/api\/v1\/samples/);
    must(await api(adm, 'GET', '/api/v1/samples'), 403, 'admin samples');
    checkClean(adm);
  });

  // j. Public site ----------------------------------------------------------------------------------------------
  for (const [loc, dev, tag] of [['he', DESKTOP, 'j-public'], ['en', DESKTOP, 'j-public'], ['he', MOBILE, 'j-public-mobile']]) {
    await step('j-public', `public site home (${loc}${dev === MOBILE ? ', mobile' : ''})`, async () => {
      const p = await newPage(loc, dev);
      await p.goto(`${SITE}/${loc}/`, { waitUntil: 'networkidle' });
      const lang = await p.evaluate(() => [document.documentElement.lang, document.documentElement.dir]);
      expect(lang[0].startsWith(loc) && lang[1] === (loc === 'he' ? 'rtl' : 'ltr'), 'lang/dir ' + lang.join('/'));
      expect((await p.locator('h1').count()) >= 1, 'no h1');
      await shot(p, tag, 'home', loc);
      checkClean(p);
      await p.context().close();
    });
  }
}

main().catch((e) => { console.error('fatal', e); results.push({ flow: 'setup', name: 'fatal', ok: false, error: String(e?.message ?? e) }); })
  .finally(async () => {
    try { await browser?.close(); } catch { /* closed */ }
    stopStack();
    const ok = results.filter((r) => r.ok).length; const fail = results.length - ok;
    writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ when: new Date().toISOString(), base: BASE, site: SITE, passed: ok, failed: fail, screenshots: shotNo, steps: results }, null, 2) + '\n');
    console.log(`\ne2e-flows: ${ok} passed, ${fail} failed, ${shotNo} screenshots in docs/qa/flows/screenshots`);
    process.exit(fail ? 1 : 0);
  });
