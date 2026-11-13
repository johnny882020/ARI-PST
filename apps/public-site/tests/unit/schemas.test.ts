import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { collectionSchemas, pageSchema, personSchema, partnerSchema, imageSchema, newsSchema, LOCALES, PAGE_SLUGS, LEGAL_SLUGS } from '../../src/content/schemas';
import { ROOT, walk } from '../helpers/build';

const CONTENT = path.join(ROOT, 'src/content');
type Entry = { coll: string; locale: string; file: string; data: Record<string, unknown> };

function load(): Entry[] {
  const out: Entry[] = [];
  for (const coll of Object.keys(collectionSchemas)) {
    for (const f of walk(path.join(CONTENT, coll), (x) => /\.(md|json)$/.test(x))) {
      const rel = path.relative(path.join(CONTENT, coll), f);
      const locale = rel.split(path.sep)[0]!.replace(/\.json$/, '');
      const raw = fs.readFileSync(f, 'utf8');
      const data = f.endsWith('.json') ? JSON.parse(raw) : YAML.parse(raw.split(/^---\s*$/m)[1]!);
      out.push({ coll, locale, file: f, data });
    }
  }
  return out;
}
const entries = load();

describe('content collections', () => {
  it('every content file validates against its Zod schema', () => {
    for (const e of entries) {
      const r = (collectionSchemas as Record<string, { safeParse: (x: unknown) => { success: boolean; error?: unknown } }>)[e.coll]!.safeParse(e.data);
      expect(r.success, `${path.relative(CONTENT, e.file)}: ${JSON.stringify((r.error as { issues?: unknown })?.issues)}`).toBe(true);
    }
  });

  it('folder locale is he or en and matches locale field when present', () => {
    for (const e of entries) {
      expect(LOCALES as readonly string[]).toContain(e.locale);
      if (e.data.locale) expect(e.data.locale).toBe(e.locale);
    }
  });

  it('every slug exists in both locales unless translation_status is pending', () => {
    for (const coll of ['pages', 'news', 'research-areas', 'partners', 'centers', 'people', 'legal']) {
      const by = new Map<string, Entry[]>();
      for (const e of entries.filter((x) => x.coll === coll)) by.set(e.data.slug as string, [...(by.get(e.data.slug as string) ?? []), e]);
      for (const [slug, es] of by) {
        const locs = new Set(es.map((e) => e.locale));
        const pending = es.some((e) => e.data.translation_status === 'pending');
        expect(locs.size === 2 || pending, `${coll}/${slug} missing a locale`).toBe(true);
      }
    }
  });

  it('every required REQ-019 page and legal page exists', () => {
    for (const l of LOCALES) {
      for (const s of PAGE_SLUGS) expect(entries.some((e) => e.coll === 'pages' && e.locale === l && e.data.slug === s), `pages ${l}/${s}`).toBe(true);
      for (const s of LEGAL_SLUGS) expect(entries.some((e) => e.coll === 'legal' && e.locale === l && e.data.slug === s), `legal ${l}/${s}`).toBe(true);
    }
  });

  it('cross references (slugs) resolve', () => {
    const slugs = (c: string) => new Set(entries.filter((e) => e.coll === c).map((e) => e.data.slug as string));
    const news = slugs('news'), partners = slugs('partners'), areas = slugs('research-areas');
    for (const e of entries.filter((x) => x.coll === 'pages')) {
      for (const s of (e.data.featured_news as string[]) ?? []) expect(news.has(s), `featured_news ${s}`).toBe(true);
      for (const s of (e.data.featured_partners as string[]) ?? []) expect(partners.has(s), `featured_partners ${s}`).toBe(true);
    }
    for (const e of entries.filter((x) => x.coll === 'people')) for (const s of (e.data.research_areas as string[]) ?? []) expect(areas.has(s)).toBe(true);
  });

  it('legal drafts are flagged needs_legal_review and the patients page needs review', () => {
    for (const e of entries.filter((x) => x.coll === 'legal')) expect(e.data.needs_legal_review).toBe(true);
    for (const e of entries.filter((x) => x.coll === 'pages' && x.data.slug === 'patients')) expect(e.data.needs_review).toBe(true);
  });

  it('partners have no logo field and the four global partners are present', () => {
    const p = entries.filter((e) => e.coll === 'partners');
    for (const e of p) expect('logo' in e.data).toBe(false);
    expect(new Set(p.map((e) => e.data.slug))).toEqual(new Set(['pnoc', 'sickkids', 'stanford', 'cbtn']));
  });

  it('no Shaare Zedek logo asset exists anywhere in the app source', () => {
    const files = walk(ROOT, (f) => !f.includes('node_modules') && !f.includes(`${path.sep}dist`) && !f.includes('.astro'));
    expect(files.filter((f) => /shaare|zedek/i.test(path.basename(f)) && /\.(jpe?g|png|svg|webp|gif)$/i.test(f))).toEqual([]);
  });

  it('no personal data patterns (e-mails other than role/example, long digit strings) in content', () => {
    for (const e of entries) {
      const text = fs.readFileSync(e.file, 'utf8');
      for (const m of text.matchAll(/[\w.+-]+@[\w-]+\.[\w.]+/g)) expect(m[0], e.file).toMatch(/@ari-pst\.example$/);
      expect(text, e.file).not.toMatch(/\d{9,}/);
    }
  });
});

describe('schema rules', () => {
  const ok = { title: 'T', description: 'D', slug: 'about', updated: '2026-11-13', mission: 'm', principles: [{ title: 'a', text: 'b' }], governance: 'g' };
  it('page requires its slug-specific fields', () => {
    expect(pageSchema.safeParse(ok).success).toBe(true);
    expect(pageSchema.safeParse({ ...ok, mission: undefined }).success).toBe(false);
  });
  it('title max 70, description max 160, slug kebab', () => {
    expect(pageSchema.safeParse({ ...ok, title: 'x'.repeat(71) }).success).toBe(false);
    expect(pageSchema.safeParse({ ...ok, description: 'x'.repeat(161) }).success).toBe(false);
    expect(newsSchema.safeParse({ title: 'T', description: 'D', slug: 'Bad_Slug', updated: '2026-11-13', date: '2026-11-13', summary: 's' }).success).toBe(false);
  });
  it('image alt is required unless decorative; src must be under /uploads/', () => {
    expect(imageSchema.safeParse({ src: '/uploads/a.png' }).success).toBe(false);
    expect(imageSchema.safeParse({ src: '/uploads/a.png', alt: 'x' }).success).toBe(true);
    expect(imageSchema.safeParse({ src: '/uploads/a.png', decorative: true }).success).toBe(true);
    expect(imageSchema.safeParse({ src: 'https://cdn.example/a.png', alt: 'x' }).success).toBe(false);
  });
  it('a real person needs consent_on_file; placeholders do not', () => {
    const p = { title: 'T', description: 'D', slug: 'x', updated: '2026-11-13', name: 'N', role: 'R', bio: 'B' };
    expect(personSchema.safeParse(p).success).toBe(false);
    expect(personSchema.safeParse({ ...p, consent_on_file: true }).success).toBe(true);
    expect(personSchema.safeParse({ ...p, placeholder: true }).success).toBe(true);
  });
  it('partner type is restricted and url must be https', () => {
    const p = { title: 'T', description: 'D', slug: 'x', updated: '2026-11-13', name: 'N', country: 'C', summary: 'S', type: 'other' };
    expect(partnerSchema.safeParse(p).success).toBe(true);
    expect(partnerSchema.safeParse({ ...p, url: 'http://x.org' }).success).toBe(false);
    expect(partnerSchema.safeParse({ ...p, type: 'bogus' }).success).toBe(false);
  });
});
