import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const built = new Map<string, string>();

/** Builds once per (outDir, env) per test process. Returns the absolute outDir. */
export function build(outDir = 'dist', env: Record<string, string> = {}): string {
  const key = outDir + JSON.stringify(env);
  const abs = path.join(ROOT, outDir);
  if (built.has(key)) return abs;
  fs.rmSync(abs, { recursive: true, force: true });
  execFileSync('pnpm', ['exec', 'astro', 'build', '--outDir', outDir], {
    cwd: ROOT, stdio: 'pipe', env: { ...process.env, SITE_URL: 'https://www.ari-pst.example', ...env },
  });
  built.set(key, abs);
  return abs;
}

export function walk(dir: string, pred: (f: string) => boolean = () => true): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, pred));
    else if (pred(p)) out.push(p);
  }
  return out;
}

export const htmlPages = (dist: string) => walk(dist, (f) => f.endsWith('.html') && !f.includes(`${path.sep}admin${path.sep}`));
