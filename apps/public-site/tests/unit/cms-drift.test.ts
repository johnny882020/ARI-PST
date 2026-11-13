import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { render, config } from '../../scripts/gen-cms-config.mjs';
import { violations } from '../../scripts/check-content-only.mjs';
import { collectionSchemas } from '../../src/content/schemas';
import { ROOT } from '../helpers/build';

const cfg = YAML.parse(fs.readFileSync(path.join(ROOT, 'public/admin/config.yml'), 'utf8'));

describe('Decap CMS config', () => {
  it('committed config.yml equals generated output (run pnpm gen:cms-config)', () => {
    expect(fs.readFileSync(path.join(ROOT, 'public/admin/config.yml'), 'utf8')).toBe(render());
    expect(config).toBeTruthy();
  });

  it('uses editorial workflow, he/en i18n and GitHub backend', () => {
    expect(cfg.publish_mode).toBe('editorial_workflow');
    expect(cfg.i18n.locales).toEqual(['he', 'en']);
    expect(cfg.i18n.default_locale).toBe('he');
    expect(cfg.backend.name).toBe('github');
  });

  it('fields of each collection match the Zod schema keys (no drift)', () => {
    for (const c of cfg.collections as { name: string; fields?: { name: string }[]; files?: { fields: { name: string }[] }[] }[]) {
      const schema = (collectionSchemas as Record<string, { shape: Record<string, unknown> }>)[c.name]!;
      const zodKeys = new Set(Object.keys(schema.shape).filter((k) => k !== 'locale'));
      const cmsKeys = new Set((c.fields ?? c.files![0]!.fields).map((f) => f.name));
      cmsKeys.delete('body');
      expect([...cmsKeys].sort(), c.name).toEqual([...zodKeys].sort());
    }
  });

  it('RT-10: every collection and the media folder are under src/content/', () => {
    expect(cfg.media_folder.startsWith('src/content/')).toBe(true);
    for (const c of cfg.collections) {
      const paths: string[] = c.folder ? [c.folder] : c.files.map((f: { file: string }) => f.file);
      for (const p of paths) expect(p.startsWith('src/content/'), `${c.name}: ${p}`).toBe(true);
    }
  });

  it('RT-10: content-only-diff rejects paths outside src/content', () => {
    const ok = 'apps/public-site/src/content/news/he/x.md';
    expect(violations([ok, 'apps/public-site/src/content/uploads/a.png', ''])).toEqual([]);
    expect(violations([ok, 'apps/public-site/src/pages/index.astro', 'apps/public-site/public/_headers', 'apps/api/src/x.ts', 'package.json']).length).toBe(4);
    expect(violations(['apps/public-site/src/content/../pages/x.astro'])).toHaveLength(1);
  });

  it('documents the CMS path restriction', () => {
    expect(fs.readFileSync(path.join(ROOT, 'CMS-SECURITY.md'), 'utf8')).toContain('src/content');
  });
});
