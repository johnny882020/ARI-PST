#!/usr/bin/env node
// Import an export into an EMPTY, migrated database (restore / migration path).
//   DATABASE_URL_ADMIN=postgres://<superuser or BYPASSRLS owner> node db/import.mjs --in ./export-dir
// Steps: verify manifest sha256 and row counts of every file -> truncate target data tables -> load (FK checks and triggers off
// for the load, i.e. session_replication_role=replica) -> reset sequences -> compare counts -> verify the audit hash chain when keys were exported.
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import pg from 'pg';

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

export async function importAll({ url, inDir, log = () => {} }) {
  const manifest = JSON.parse(readFileSync(path.join(inDir, 'manifest.json'), 'utf8'));
  if (manifest.format !== 'ari-pst-export') throw new Error('not an ari-pst export');
  const bodies = new Map();
  for (const t of manifest.tables) {
    const f = path.join(inDir, t.file);
    if (!existsSync(f)) throw new Error(`missing file ${t.file}`);
    const buf = readFileSync(f);
    if (sha(buf) !== t.sha256) throw new Error(`checksum mismatch: ${t.file}`);
    const lines = buf.toString('utf8').split('\n').filter(Boolean);
    if (lines.length !== t.rows) throw new Error(`row count mismatch: ${t.file}`);
    bodies.set(t.name, lines);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const level = (await client.query('SELECT max(version) v FROM public.schema_migrations')).rows[0].v;
    if (level !== manifest.schemaVersion) throw new Error(`schema level ${level} differs from export ${manifest.schemaVersion}`);
    await client.query('BEGIN');
    await client.query('SET LOCAL session_replication_role = replica');
    await client.query(`TRUNCATE ${manifest.tables.map((t) => t.name).join(', ')} CASCADE`);
    for (const t of manifest.tables) {
      const lines = bodies.get(t.name);
      for (let i = 0; i < lines.length; i += 500) {
        await client.query(`INSERT INTO ${t.name} SELECT r.* FROM jsonb_populate_recordset(NULL::${t.name}, $1::jsonb) r`, [`[${lines.slice(i, i + 500).join(',')}]`]);
      }
      log(`loaded ${t.name} (${lines.length})`);
    }
    // sequences owned by serial columns
    const seqs = (await client.query(`SELECT s.schemaname, s.sequencename, d.refobjid::regclass::text tbl, a.attname FROM pg_sequences s
      JOIN pg_class c ON c.relname = s.sequencename AND c.relnamespace = s.schemaname::regnamespace JOIN pg_depend d ON d.objid = c.oid AND d.deptype = 'a'
      JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid`)).rows;
    for (const q of seqs) await client.query(`SELECT setval('${q.schemaname}.${q.sequencename}', coalesce((SELECT max("${q.attname}") FROM ${q.tbl}), 0) + 1, false)`);
    for (const t of manifest.tables) {
      const n = (await client.query(`SELECT count(*)::int n FROM ${t.name}`)).rows[0].n;
      if (n !== t.rows) throw new Error(`post-load count mismatch ${t.name}: ${n} vs ${t.rows}`);
    }
    await client.query('COMMIT');
    let chain = 'skipped (no chain key in export)';
    if (manifest.tables.some((t) => t.name === 'audit.chain_key')) {
      await client.query('SET SESSION AUTHORIZATION app_readonly_bg');
      const broken = (await client.query('SELECT * FROM audit.verify_chain(false)')).rows;
      await client.query('RESET SESSION AUTHORIZATION');
      if (broken.length) throw new Error(`audit chain broken after import: ${JSON.stringify(broken)}`);
      chain = 'verified';
    }
    return { tables: manifest.tables.length, rows: manifest.tables.reduce((s, t) => s + t.rows, 0), chain, schemaVersion: manifest.schemaVersion };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = process.argv.slice(2);
  const inDir = a[a.indexOf('--in') + 1];
  if (!process.env.DATABASE_URL_ADMIN || !inDir) { console.error('usage: DATABASE_URL_ADMIN=... node db/import.mjs --in DIR'); process.exit(2); }
  importAll({ url: process.env.DATABASE_URL_ADMIN, inDir, log: console.log }).then((r) => console.log(JSON.stringify(r))).catch((e) => { console.error(e.message); process.exit(1); });
}
