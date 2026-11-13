import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { build, htmlPages, walk, ROOT } from '../helpers/build';
import { physicalCssViolations } from '../helpers/css';

let dist = '';
let analytics = '';
beforeAll(() => {
  dist = build('dist');
  analytics = build('dist-analytics', {
    PUBLIC_ANALYTICS_ENABLED: 'true', PUBLIC_UMAMI_SRC: 'https://analytics.ari-pst.example/script.js', PUBLIC_UMAMI_WEBSITE_ID: '00000000-0000-0000-0000-000000000000',
  });
});

const rel = (f: string) => path.relative(dist, f).split(path.sep).join('/');
const read = (p: string, d = dist) => fs.readFileSync(path.join(d, p), 'utf8');

/** URL slugs the site must serve in BOTH locales (REQ-019 + legal + 404). */
const REQUIRED = [
  '', 'about', 'research', 'research/tumor-biology', 'research/biobanking', 'research/data-sharing', 'community', 'infrastructure',
  'partners', 'news', 'news/portal-phase-one', 'news/public-site-launch', 'patients', 'join', 'contact', 'login',
  'privacy', 'terms', 'accessibility', 'analytics-notice', '404',
];

describe('built site', () => {
  it('every page exists in both locales (parity)', () => {
    for (const l of ['he', 'en']) for (const s of REQUIRED) expect(fs.existsSync(path.join(dist, l, s, 'index.html')), `${l}/${s}`).toBe(true);
  });

  it('page sets are identical across locales', () => {
    const set = (l: string) => new Set(htmlPages(dist).map(rel).filter((p) => p.startsWith(l + '/')).map((p) => p.slice(l.length)));
    expect([...set('he')].sort()).toEqual([...set('en')].sort());
  });

  it('root page, 404, robots, sitemap and _headers exist', () => {
    for (const f of ['index.html', '404.html', 'robots.txt', 'sitemap-index.xml', 'sitemap-0.xml', '_headers', 'favicon.svg', 'admin/index.html', 'admin/config.yml']) expect(fs.existsSync(path.join(dist, f)), f).toBe(true);
    expect(read('robots.txt')).toMatch(/Sitemap: https:\/\/www\.ari-pst\.example\/sitemap-index\.xml/);
    expect(read('robots.txt')).toMatch(/Disallow: \/admin\//);
  });

  it('html has lang/dir, one h1, title, description, canonical, hreflang, OG tags', () => {
    for (const f of htmlPages(dist).filter((f) => /\/(he|en)\/.+\/index\.html$|\/(he|en)\/index\.html$/.test(f))) {
      const h = fs.readFileSync(f, 'utf8');
      const loc = rel(f).split('/')[0]!;
      expect(h, rel(f)).toContain(`<html lang="${loc}" dir="${loc === 'he' ? 'rtl' : 'ltr'}"`);
      expect((h.match(/<h1[ >]/g) ?? []).length, `${rel(f)} h1 count`).toBe(1);
      expect(h).toMatch(/<title>[^<]+<\/title>/);
      expect(h).toMatch(/<meta name="description" content="[^"]+"/);
      expect(h).toMatch(/<link rel="canonical" href="https:\/\/www\.ari-pst\.example\/(he|en)\/[^"]*"/);
      expect(h).toContain('property="og:title"');
      expect(h).toContain('property="og:locale"');
      expect(h).toContain('name="twitter:card"');
      expect(h).toContain('class="skip"');
      expect(h).toContain('id="main"');
      if (!rel(f).includes('404')) {
        expect(h).toMatch(/hreflang="he" href="https:\/\/www\.ari-pst\.example\/he\//);
        expect(h).toMatch(/hreflang="en" href="https:\/\/www\.ari-pst\.example\/en\//);
        expect(h).toMatch(/hreflang="x-default" href="https:\/\/www\.ari-pst\.example\/he\//);
      }
    }
  });

  it('JSON-LD is valid JSON: Organization, WebSite, BreadcrumbList; NewsArticle on posts', () => {
    const types = (p: string) => [...read(p).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap((m) => (JSON.parse(m[1]!) as { '@type': string }[]).map((o) => o['@type']));
    expect(types('he/index.html')).toEqual(expect.arrayContaining(['Organization', 'WebSite']));
    expect(types('en/about/index.html')).toContain('BreadcrumbList');
    expect(types('en/news/portal-phase-one/index.html')).toContain('NewsArticle');
    expect(types('he/community/index.html')).toContain('Event');
    expect(types('he/patients/index.html')).not.toContain('FAQPage'); // unreviewed page: no FAQ markup
  });

  it('sitemap has hreflang alternates and excludes 404 and noindex pages', () => {
    const s = read('sitemap-0.xml');
    expect(s).toContain('hreflang="he-IL"');
    expect(s).toContain('hreflang="en-US"');
    expect(s).not.toMatch(/\/404\//);
    expect(s).toContain('/en/news/portal-phase-one/');
  });

  it('no inline scripts (other than JSON-LD) and no inline styles (strict CSP)', () => {
    for (const f of htmlPages(dist)) {
      const h = fs.readFileSync(f, 'utf8');
      const scripts = [...h.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
      for (const [, attrs, body] of scripts) {
        if (/application\/ld\+json/.test(attrs!)) continue;
        expect(attrs, rel(f)).toMatch(/\ssrc="/);
        expect(body!.trim(), rel(f)).toBe('');
      }
      expect(h, rel(f)).not.toMatch(/<style[\s>]/);
      expect(h, rel(f)).not.toMatch(/\sstyle="/);
      expect(h, rel(f)).not.toMatch(/\son(click|load|error)=/);
    }
  });

  it('CSP and security headers are set; analytics host absent when off', () => {
    const h = read('_headers');
    expect(h).toContain("default-src 'self'");
    expect(h).toContain("frame-ancestors 'none'");
    expect(h).toContain('X-Content-Type-Options: nosniff');
    expect(h).toContain('Referrer-Policy');
    expect(h).toContain('Strict-Transport-Security');
    expect(h).toMatch(/^\/admin\/\*/m);
    expect(h).not.toContain('analytics.ari-pst.example');
  });

  it('analytics is OFF by default: no Umami script, no banner, no consent script', () => {
    for (const f of htmlPages(dist)) {
      const h = fs.readFileSync(f, 'utf8');
      expect(h).not.toMatch(/data-umami-src|analytics\.ari/);
      expect(h).not.toContain('id="consent"');
    }
    for (const f of walk(path.join(dist, '_astro'), (x) => x.endsWith('.js'))) expect(fs.readFileSync(f, 'utf8')).not.toContain('analytics.ari-pst.example');
  });

  it('analytics ON build: banner present but script NOT in HTML, CSP lists the origin, footer has privacy settings', () => {
    const h = read('he/index.html', analytics);
    expect(h).toContain('id="consent"');
    expect(h).toContain('data-consent-open');
    expect(h).not.toMatch(/<script[^>]+analytics\.ari-pst\.example/); // injected at runtime after consent only
    expect(read('_headers', analytics)).toMatch(/script-src 'self' https:\/\/analytics\.ari-pst\.example;/);
    expect(read('_headers', analytics)).toMatch(/connect-src 'self' https:\/\/analytics\.ari-pst\.example/);
  });

  it('forms post to /api/v1/public/forms/{join|contact}, have honeypot and no sensitive fields', () => {
    for (const l of ['he', 'en']) {
      const j = read(`${l}/join/index.html`), c = read(`${l}/contact/index.html`);
      expect(j).toContain('data-form="join"');
      expect(c).toContain('data-form="contact"');
      for (const h of [j, c]) {
        expect(h).toContain('name="website"');
        expect(h).toContain('autocomplete="off"');
        expect(h).not.toMatch(/name="(diagnosis|id_number|national_id|dob|birth|phone|address|patient)/i);
        expect(h).toMatch(/role="status"/);
      }
    }
    const js = walk(path.join(dist, '_astro'), (x) => x.endsWith('.js')).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    expect(js).toContain('/api/v1/public/forms/');
  });

  it('client JS stays tiny (budget: <= 30 KB gzip total, 0 on most pages)', async () => {
    const { gzipSync } = await import('node:zlib');
    const total = walk(path.join(dist, '_astro'), (x) => x.endsWith('.js')).reduce((n, f) => n + gzipSync(fs.readFileSync(f)).length, 0);
    expect(total).toBeLessThan(30 * 1024);
    expect(read('he/about/index.html')).not.toMatch(/Form\.astro/);
  });

  it('CSS budget (<= 40 KB gzip) and no physical CSS in the built stylesheet', async () => {
    const { gzipSync } = await import('node:zlib');
    const css = walk(path.join(dist, '_astro'), (x) => x.endsWith('.css'));
    expect(css.length).toBeGreaterThan(0);
    for (const f of css) {
      expect(gzipSync(fs.readFileSync(f)).length).toBeLessThan(40 * 1024);
      // minified: split rules onto lines so the line-based detector can run
      expect(physicalCssViolations(fs.readFileSync(f, 'utf8').replace(/[{;}]/g, '$&\n'))).toEqual([]);
    }
  });

  it('no partner logos and no Shaare Zedek logo in the output; partners are text names', () => {
    const files = walk(dist);
    expect(files.filter((f) => /shaare|zedek/i.test(path.basename(f)))).toEqual([]);
    expect(files.filter((f) => /\.(jpe?g|png|webp|gif)$/i.test(f) && !/og-default/.test(f))).toEqual([]);
    const p = read('en/partners/index.html');
    for (const n of ['PNOC', 'SickKids', 'Stanford', 'CBTN']) expect(p).toContain(n);
    expect(p).not.toMatch(/<img/);
  });

  it('draft/legal notices are visible on legal pages and the patients page', () => {
    for (const l of ['he', 'en']) {
      for (const s of ['privacy', 'terms', 'accessibility', 'analytics-notice']) expect(read(`${l}/${s}/index.html`)).toContain('role="note"');
      expect(read(`${l}/patients/index.html`)).toContain('role="note"');
    }
  });

  it('login entry links to the configurable portal URL', () => {
    expect(read('en/login/index.html')).toContain('href="/app/"');
  });

  it('internal link check: every internal href/src resolves to a built file', () => {
    const missing: string[] = [];
    const exists = (u: string) => {
      const p = u.split('#')[0]!.split('?')[0]!;
      if (!p) return true;
      if (p.startsWith('/app/')) return true; // protected SPA, other deploy
      const f = path.join(dist, p);
      return fs.existsSync(f) && (fs.statSync(f).isFile() || fs.existsSync(path.join(f, 'index.html')));
    };
    for (const f of htmlPages(dist)) {
      const h = fs.readFileSync(f, 'utf8');
      const ids = new Set([...h.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
      for (const m of h.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
        const u = m[1]!;
        if (/^(https?:|mailto:|tel:|data:)/.test(u)) continue;
        if (u.startsWith('#')) { if (u.length > 1 && !ids.has(u.slice(1))) missing.push(`${rel(f)} -> ${u}`); continue; }
        if (!exists(u)) missing.push(`${rel(f)} -> ${u}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('tokens.css is the plan copy (no dependency on packages/design-system)', () => {
    const plan = fs.readFileSync(path.join(ROOT, '../../plan/05-design-brand/tokens.css'), 'utf8');
    expect(fs.readFileSync(path.join(ROOT, 'src/styles/tokens.css'), 'utf8')).toBe(plan);
    expect(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).not.toContain('design-system');
  });
});
