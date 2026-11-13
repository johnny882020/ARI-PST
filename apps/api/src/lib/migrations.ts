// The migration level this build expects (highest NNNN in db/migrations). Compiled in by tsup (see tsup.config.ts).
// In dev and tests (no bundle) it is read from the db/migrations folder.
import { existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
declare const __EXPECTED_MIGRATION__: string | undefined;

export function highestMigration(dir: string): string | null {
  if (!existsSync(dir)) return null;
  const v = readdirSync(dir).filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).map((f) => f.slice(0, 4)).sort();
  return v.length ? v[v.length - 1]! : null;
}
export function expectedMigration(): string | null {
  if (typeof __EXPECTED_MIGRATION__ === 'string' && __EXPECTED_MIGRATION__) return __EXPECTED_MIGRATION__;
  const here = dirname(fileURLToPath(import.meta.url));
  for (const d of [resolve(here, '../../../../db/migrations'), resolve(process.cwd(), 'db/migrations'), resolve(process.cwd(), '../../db/migrations')]) {
    const v = highestMigration(d); if (v) return v;
  }
  return null;
}
