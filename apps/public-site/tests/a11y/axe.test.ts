import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { Browser } from 'playwright';
import { build, htmlPages, ROOT } from '../helpers/build';
import { serve } from '../helpers/serve';
import { launch } from '../helpers/browser';

const axeSrc = fs.readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];

let browser: Browser | null = null;
let main: Awaited<ReturnType<typeof serve>>;
let ana: Awaited<ReturnType<typeof serve>>;
let dist = '';
let pages: string[] = [];

beforeAll(async () => {
  dist = build('dist');
  const adist = build('dist-analytics', {
    PUBLIC_ANALYTICS_ENABLED: 'true', PUBLIC_UMAMI_SRC: 'https://analytics.ari-pst.example/script.js', PUBLIC_UMAMI_WEBSITE_ID: '00000000-0000-0000-0000-000000000000',
  });
  main = await serve(dist);
  ana = await serve(adist);
  pages = htmlPages(dist).map((f) => '/' + path.relative(dist, f).split(path.sep).join('/').replace(/index\.html$/, '')).filter((p) => p !== '/404.html');
  browser = await launch();
});
afterAll(async () => { await browser?.close(); await main?.close(); await ana?.close(); });

async function scan(base: string, p: string, opts: { colorScheme: 'light' | 'dark'; width: number; reducedMotion?: boolean }) {
  const ctx = await browser!.newContext({ viewport: { width: opts.width, height: 800 }, colorScheme: opts.colorScheme, reducedMotion: opts.reducedMotion ? 'reduce' : 'no-preference', locale: 'en' });
  const page = await ctx.newPage();
  const problems: string[] = [];
  page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) problems.push('CSP: ' + m.text()); });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  await page.goto(base + p, { waitUntil: 'load' });
  await page.evaluate(axeSrc);
  const res = await page.evaluate(async (tags) => {
    // @ts-expect-error axe is injected
    const r = await window.axe.run(document, { runOnly: { type: 'tag', values: tags } });
    return r.violations.map((v: { id: string; impact: string; nodes: { target: unknown[] }[] }) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
  }, TAGS);
  await ctx.close();
  return [...res, ...problems];
}

describe('axe accessibility on the built site (WCAG 2.1 A/AA)', () => {
  it('browser is available', () => { expect(browser, 'chromium not found').not.toBeNull(); });

  it('all pages, both locales, light theme, desktop', async () => {
    expect(pages.length).toBeGreaterThanOrEqual(40);
    const bad: Record<string, string[]> = {};
    for (const p of pages) { const r = await scan(main.url, p, { colorScheme: 'light', width: 1280 }); if (r.length) bad[p] = r; }
    expect(bad).toEqual({});
  });

  it('all pages, dark theme, mobile 360px', async () => {
    const bad: Record<string, string[]> = {};
    for (const p of pages) { const r = await scan(main.url, p, { colorScheme: 'dark', width: 360, reducedMotion: true }); if (r.length) bad[p] = r; }
    expect(bad).toEqual({});
  });

  it('consent banner (analytics build) is accessible, shown by default and loads no analytics before consent', async () => {
    for (const scheme of ['light', 'dark'] as const) {
      const ctx = await browser!.newContext({ colorScheme: scheme, viewport: { width: 360, height: 700 } });
      const page = await ctx.newPage();
      const requested: string[] = [];
      await ctx.route('https://analytics.ari-pst.example/**', (r) => { requested.push(r.request().url()); r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }); });
      await page.goto(ana.url + '/en/', { waitUntil: 'load' });
      expect(await page.locator('#consent').isVisible()).toBe(true);
      await page.evaluate(axeSrc);
      const v = await page.evaluate(async (tags) => { // @ts-expect-error injected
        const r = await window.axe.run(document, { runOnly: { type: 'tag', values: tags } }); return r.violations.map((x: { id: string }) => x.id); }, TAGS);
      expect(v).toEqual([]);
      expect(requested).toEqual([]);
      await ctx.close();
    }
  });

  it('consent: decline keeps analytics off; accept loads the script; Privacy settings reopens; DNT is respected', async () => {
    const ctx = await browser!.newContext();
    const requested: string[] = [];
    await ctx.route('https://analytics.ari-pst.example/**', (r) => { requested.push(r.request().url()); r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }); });
    const page = await ctx.newPage();
    await page.goto(ana.url + '/he/', { waitUntil: 'load' });
    await page.click('[data-consent="decline"]');
    expect(await page.locator('#consent').isHidden()).toBe(true);
    expect((await ctx.cookies()).find((c) => c.name === 'ari_consent')?.value).toBe('v1:denied');
    await page.reload();
    expect(await page.locator('#consent').isHidden()).toBe(true);
    expect(requested).toEqual([]);
    await page.click('[data-consent-open]');
    expect(await page.locator('#consent').isVisible()).toBe(true);
    await page.click('[data-consent="accept"]');
    await page.waitForTimeout(300);
    expect((await ctx.cookies()).find((c) => c.name === 'ari_consent')?.value).toBe('v1:granted');
    expect(requested).toHaveLength(1);
    await ctx.close();

    // Sec-GPC / DNT => treated as denied, no banner, no script.
    const ctx2 = await browser!.newContext({ extraHTTPHeaders: { 'Sec-GPC': '1' } });
    const req2: string[] = [];
    await ctx2.route('https://analytics.ari-pst.example/**', (r) => { req2.push(r.request().url()); r.abort(); });
    const p2 = await ctx2.newPage();
    await p2.addInitScript(() => { Object.defineProperty(navigator, 'globalPrivacyControl', { value: true }); });
    await p2.goto(ana.url + '/en/', { waitUntil: 'load' });
    expect(await p2.locator('#consent').isHidden()).toBe(true);
    expect(req2).toEqual([]);
    await ctx2.close();
  });

  it('default build: no analytics request and no banner', async () => {
    const ctx = await browser!.newContext();
    const page = await ctx.newPage();
    const reqs: string[] = [];
    page.on('request', (r) => { if (!r.url().startsWith(main.url)) reqs.push(r.url()); });
    await page.goto(main.url + '/en/', { waitUntil: 'networkidle' });
    expect(await page.locator('#consent').count()).toBe(0);
    expect(reqs).toEqual([]);
    await ctx.close();
  });

  it('keyboard: first Tab stop is the skip link and it targets main; mobile menu opens', async () => {
    const ctx = await browser!.newContext({ viewport: { width: 360, height: 700 } });
    const page = await ctx.newPage();
    await page.goto(main.url + '/he/', { waitUntil: 'load' });
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => (document.activeElement as HTMLAnchorElement).className)).toBe('skip');
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => location.hash)).toBe('#main');
    expect(await page.locator('nav[aria-label] a').first().isVisible()).toBe(false);
    await page.click('summary');
    expect(await page.locator('.navlist a').first().isVisible()).toBe(true);
    await ctx.close();
  });

  it('forms: validation errors focus an error summary; honeypot field is present; success posts JSON to the endpoint', async () => {
    const ctx = await browser!.newContext();
    const page = await ctx.newPage();
    let posted: { url: string; body: Record<string, unknown> } | null = null;
    await page.route('**/api/v1/public/forms/*', async (route) => {
      posted = { url: route.request().url(), body: route.request().postDataJSON() };
      await route.fulfill({ status: 202, body: '' });
    });
    await page.goto(main.url + '/en/join/', { waitUntil: 'load' });
    await page.click('button[type="submit"]');
    expect(await page.locator('[data-summary]').isVisible()).toBe(true);
    expect(await page.evaluate(() => document.activeElement?.hasAttribute('data-summary'))).toBe(true);
    await page.fill('#join-name', 'Test Person');
    await page.selectOption('#join-role', 'researcher');
    await page.fill('#join-email', 'test@example.org');
    await page.fill('#join-message', 'Call 123456789012 please');
    await page.check('#join-consent');
    await page.click('button[type="submit"]');
    expect(await page.locator('[data-summary]').innerText()).toMatch(/identify/i); // ID-like digit string refused
    await page.fill('#join-message', 'A general hello');
    await page.click('button[type="submit"]');
    await page.waitForSelector('[data-status].status');
    expect(posted).not.toBeNull();
    expect(new URL(posted!.url).pathname).toBe('/api/v1/public/forms/join');
    expect(posted!.body).toMatchObject({ name: 'Test Person', role: 'researcher', consent_contact: true, locale: 'en', website: '' });
    expect(Object.keys(posted!.body).sort()).toEqual(['consent_contact', 'elapsed_ms', 'email', 'interests', 'locale', 'message', 'name', 'organization', 'role', 'website'].sort());
    const axeV = await page.evaluate(axeSrc).then(() => page.evaluate(async (tags) => { // @ts-expect-error injected
      const r = await window.axe.run(document, { runOnly: { type: 'tag', values: tags } }); return r.violations.map((x: { id: string }) => x.id); }, TAGS));
    expect(axeV).toEqual([]);
    await ctx.close();
  });

  it('forms: ALTCHA-style proof of work solves a server challenge before posting', async () => {
    const { createHash } = await import('node:crypto');
    const salt = 'abc123', number = 777;
    const challenge = createHash('sha256').update(salt + number).digest('hex');
    const chUrl = 'http://127.0.0.1:1/challenge'; // intercepted below
    const html = fs.readFileSync(path.join(dist, 'en/contact/index.html'), 'utf8').replace('data-challenge-url ', `data-challenge-url="${chUrl}" `);
    const ctx = await browser!.newContext();
    const page = await ctx.newPage();
    let body: Record<string, unknown> | null = null;
    await page.route(chUrl, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ algorithm: 'SHA-256', challenge, salt, maxnumber: 2000, signature: 'sig' }) }));
    await page.route('**/api/v1/public/forms/contact', async (route) => { body = route.request().postDataJSON(); await route.fulfill({ status: 202, body: '' }); });
    await page.route('**/en/contact/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: html }));
    await page.goto(main.url + '/en/contact/?subject=general');
    expect(await page.inputValue('#contact-subject')).toBe('general');
    await page.fill('#contact-name', 'A B'); await page.fill('#contact-email', 'a@example.org'); await page.fill('#contact-message', 'Hi'); await page.check('#contact-consent');
    await page.click('button[type="submit"]');
    await page.waitForSelector('[data-status].status');
    const alt = JSON.parse(Buffer.from((body as unknown as { altcha: string }).altcha, 'base64').toString());
    expect(alt).toMatchObject({ number, salt, challenge, signature: 'sig' });
    await ctx.close();
  });

  it('RTL: he pages are dir=rtl and the layout does not overflow horizontally at 360px (he and en)', async () => {
    for (const l of ['he', 'en']) {
      const ctx = await browser!.newContext({ viewport: { width: 360, height: 700 } });
      const page = await ctx.newPage();
      await page.goto(`${main.url}/${l}/community/`, { waitUntil: 'load' });
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).direction)).toBe(l === 'he' ? 'rtl' : 'ltr');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      await ctx.close();
    }
  });
});
void ROOT;
