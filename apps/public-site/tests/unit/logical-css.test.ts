import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, walk } from '../helpers/build';
import { physicalCssViolations } from '../helpers/css';

describe('logical CSS only', () => {
  it('detector catches physical properties (self-test)', () => {
    expect(physicalCssViolations('a{margin-left:1px}')).toHaveLength(1);
    expect(physicalCssViolations('a{text-align:right}')).toHaveLength(1);
    expect(physicalCssViolations('a{left:0}')).toHaveLength(1);
    expect(physicalCssViolations('a{border-top-left-radius:2px}')).toHaveLength(1);
    expect(physicalCssViolations('a{padding:1px 2px 3px 4px}')).toHaveLength(1);
    expect(physicalCssViolations('a{width:10px}')).toHaveLength(1);
    expect(physicalCssViolations('a{margin-inline-start:1px;inset-inline-start:0;text-align:start;padding:1px 2px;inline-size:1px}')).toEqual([]);
    expect(physicalCssViolations('/* margin-left */ a{color:red}')).toEqual([]);
  });

  const sources = [
    ...walk(path.join(ROOT, 'src'), (f) => f.endsWith('.css')),
    ...walk(path.join(ROOT, 'src'), (f) => f.endsWith('.astro')),
  ];
  it('no physical properties in src CSS or <style> blocks', () => {
    for (const f of sources) {
      let css = fs.readFileSync(f, 'utf8');
      if (f.endsWith('.astro')) css = [...css.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n') + [...css.matchAll(/style="([^"]*)"/g)].map((m) => `{${m[1]}}`).join('\n');
      expect(physicalCssViolations(css), path.relative(ROOT, f)).toEqual([]);
    }
  });
});
