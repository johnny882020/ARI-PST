// Repo rules the type checker cannot see: no console.log of request data, no raw SQL outside adapters, no fastify outside http/modules http.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const root = new URL('../src', import.meta.url).pathname; const bad = [];
(function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.ts')) check(p, readFileSync(p, 'utf8')); } })(root);
function check(p, s) {
  const rel = p.slice(root.length + 1);
  if (/from 'pg'/.test(s) && !/^adapters\/|^jobs\//.test(rel)) bad.push(`${rel}: pg outside adapters`);
  if (/from 'fastify'|from '@fastify\//.test(s) && !/^(http\/|app\.ts|modules\/[^/]+\/http\/)/.test(rel)) bad.push(`${rel}: fastify outside http`);
  if (/\b(SELECT|INSERT INTO|UPDATE)\b.*\bportal\./.test(s) && !/^adapters\/|^jobs\//.test(rel)) bad.push(`${rel}: SQL outside adapters`);
  if (/console\.(log|info)\(/.test(s) && !/^(jobs\/|server\.ts)/.test(rel)) bad.push(`${rel}: console output`);
}
if (bad.length) { console.error(bad.join('\n')); process.exit(1); }
console.log('lint-rules ok');
