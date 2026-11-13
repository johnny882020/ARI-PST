#!/usr/bin/env node
// Full export: NDJSON per table + manifest.json with sha256 checksums (REQ-054, REQ-070, round trip prerequisite of GATE-PROD-DATA).
//   DATABASE_URL_EXPORT=postgres://... node db/export.mjs --out ./export-dir [--include-keys]
// Login: app_break_glass (needs an active two-approver grant, calls portal.breakglass_begin()) or an ops superuser.
// The export is one REPEATABLE READ snapshot. A manifest signature (detached) is the operator's job (A2 defines the key).
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import pg from 'pg';
import { EXPORT_TABLES, KEY_TABLES } from './lib/tables.mjs';

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

export async function exportAll({ url, outDir, includeKeys = false, appVersion = '0.1.0' }) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    if ((await client.query('SELECT session_user u')).rows[0].u === 'app_break_glass') await client.query('SELECT portal.breakglass_begin()');
    mkdirSync(path.join(outDir, 'data'), { recursive: true });
    const tables = [];
    for (const t of [...EXPORT_TABLES, ...(includeKeys ? KEY_TABLES : [])]) {
      const [s, n] = t.split('.');
      const pk = (await client.query(`SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
        WHERE i.indrelid = $1::regclass AND i.indisprimary ORDER BY array_position(i.indkey::int2[], a.attnum)`, [`${s}.${n}`])).rows.map((r) => `"${r.attname}"`);
      const rows = (await client.query(`SELECT to_jsonb(t)::text AS j FROM ${s}.${n} t ORDER BY ${pk.length ? pk.map((c) => `t.${c}`).join(',') : '1'}`)).rows;
      const body = rows.map((r) => r.j).join('\n') + (rows.length ? '\n' : '');
      const file = `data/${t}.ndjson`;
      writeFileSync(path.join(outDir, file), body);
      tables.push({ name: t, file, rows: rows.length, sha256: sha(Buffer.from(body)) });
    }
    const version = (await client.query('SELECT max(version) v FROM public.schema_migrations')).rows[0].v;
    const synthetic = (await client.query('SELECT bool_and(is_synthetic) b FROM portal.samples')).rows[0].b;
    const heads = (await client.query(`SELECT lane, last_seq::text, encode(last_hash,'hex') last_hash FROM audit.chain_head ORDER BY lane`)).rows;
    await client.query('COMMIT');
    const manifest = {
      format: 'ari-pst-export', formatVersion: '1.0', createdAt: new Date().toISOString(), schemaVersion: version, appVersion,
      isSynthetic: synthetic !== false, scope: 'full', tables, auditChain: { lanes: heads },
      excluded: ['authn.*', 'ops.*', 'agg.*', 'portal.ctx_secret', 'portal.email_verifications', ...(includeKeys ? [] : ['audit.chain_key'])],
    };
    writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    return manifest;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = process.argv.slice(2);
  const out = a[a.indexOf('--out') + 1];
  if (!process.env.DATABASE_URL_EXPORT || !out) { console.error('usage: DATABASE_URL_EXPORT=... node db/export.mjs --out DIR [--include-keys]'); process.exit(2); }
  exportAll({ url: process.env.DATABASE_URL_EXPORT, outDir: out, includeKeys: a.includes('--include-keys') })
    .then((m) => console.log(`exported ${m.tables.reduce((s, t) => s + t.rows, 0)} rows in ${m.tables.length} files`))
    .catch((e) => { console.error(e.message); process.exit(1); });
}
