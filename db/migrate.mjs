#!/usr/bin/env node
// Forward-only migration runner. Plain node + pg.
//   node db/migrate.mjs [--dry-run] [--dir db/migrations]
// DATABASE_URL_MIGRATOR must log in as app_migrator (never a superuser, never the runtime role).
// schema_migrations(version, name, checksum, applied_at). A checksum mismatch on an applied file stops the run.
// Each file runs in ONE transaction together with its bookkeeping row. A concurrent runner is blocked by an advisory lock.
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const dirArg = args.indexOf('--dir');
const dir = dirArg >= 0 ? path.resolve(args[dirArg + 1]) : path.join(here, 'migrations');
const url = process.env.DATABASE_URL_MIGRATOR;
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain && !url) { console.error('DATABASE_URL_MIGRATOR is required'); process.exit(2); }

export function listMigrations(d) {
  return readdirSync(d).filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort().map((f) => {
    const sql = readFileSync(path.join(d, f), 'utf8');
    return { version: f.slice(0, 4), name: f, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  });
}

export async function migrate({ url, dir, dryRun = false, log = console.log }) {
  const files = listMigrations(dir);
  const versions = new Set();
  for (const f of files) { if (versions.has(f.version)) throw new Error(`duplicate migration number ${f.version}`); versions.add(f.version); }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const applied = [];
  try {
    await client.query('SELECT pg_advisory_lock(7240001)');
    await client.query(`CREATE SCHEMA IF NOT EXISTS public AUTHORIZATION CURRENT_USER`).catch(() => {});
    await client.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (
      version text PRIMARY KEY, name text NOT NULL, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const done = new Map((await client.query('SELECT version, name, checksum FROM public.schema_migrations')).rows.map((r) => [r.version, r]));
    for (const [v, r] of done) {
      const f = files.find((x) => x.version === v);
      if (!f) throw new Error(`applied migration ${v} (${r.name}) is missing on disk`);
      if (f.checksum !== r.checksum) throw new Error(`checksum mismatch for ${f.name}: applied migrations are immutable (forward-only)`);
    }
    for (const f of files) {
      if (done.has(f.version)) continue;
      if (dryRun) { log(`[dry-run] would apply ${f.name}`); applied.push(f.name); continue; }
      log(`applying ${f.name}`);
      try {
        await client.query('BEGIN');
        await client.query(f.sql);
        await client.query('INSERT INTO public.schema_migrations (version, name, checksum) VALUES ($1,$2,$3)', [f.version, f.name, f.checksum]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`migration ${f.name} failed: ${e.message}`);
      }
      applied.push(f.name);
    }
    if (!applied.length) log('up to date');
  } finally {
    await client.query('SELECT pg_advisory_unlock(7240001)').catch(() => {});
    await client.end();
  }
  return applied;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate({ url, dir, dryRun }).catch((e) => { console.error(e.message); process.exit(1); });
}
