#!/usr/bin/env node
// Seed synthetic data.  node db/seed.mjs --profile tiny --seed 1 [--reference-only] [--no-requests]
//   DATABASE_URL_ADMIN   a login that bypasses RLS (superuser or BYPASSRLS). Loads centers, users, samples.
//   DATABASE_URL_RUNTIME app_runtime login. Used to create requests through the real functions.
// Guards (spec 09 rule 3): refuses when GATE_PROD_DATA_CLOSED=true, and refuses to run if any non-synthetic sample exists.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import { generate, toSqlStatements } from '../packages/synthetic-data/src/index.ts';
import { seedRequests } from './lib/workflow.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

export async function seed({ adminUrl, runtimeUrl, profile = 'tiny', seedNo = 1, referenceOnly = false, requests = true, log = console.log }) {
  if (process.env.GATE_PROD_DATA_CLOSED === 'true') throw new Error('refusing to generate synthetic data: GATE_PROD_DATA_CLOSED=true');
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const bad = await admin.query('SELECT count(*)::int AS n FROM portal.samples WHERE is_synthetic = false');
    if (bad.rows[0].n > 0) throw new Error('refusing to seed: non-synthetic samples exist');
    await admin.query(readFileSync(path.join(here, 'seeds', '010_diagnosis_vocabulary.sql'), 'utf8').replace(/^/, '')).catch((e) => {
      if (e.code !== '23505') throw e;   // vocabulary already loaded
    });
    if (referenceOnly) return { reference: true };
    const ds = generate({ seed: seedNo, profile });
    await admin.query('BEGIN');
    for (const stmt of toSqlStatements(ds)) await admin.query(stmt);
    await admin.query('COMMIT');
    await admin.query('SET SESSION AUTHORIZATION app_readonly_bg');
    const epoch = (await admin.query('SELECT agg.refresh_snapshot() AS e')).rows[0].e;
    await admin.query('RESET SESSION AUTHORIZATION');
    log(`seeded ${ds.samples.length} samples, ${ds.users.length} users, epoch ${epoch}`);
    let reqs = {};
    if (requests && runtimeUrl) {
      const pool = new pg.Pool({ connectionString: runtimeUrl, max: 2 });
      try { reqs = await seedRequests(pool, ds); } finally { await pool.end(); }
      log(`seeded ${Object.keys(reqs).length} requests`);
    }
    return { ds, requests: reqs };
  } finally {
    await admin.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = process.argv.slice(2);
  const get = (k, d) => (a.includes(k) ? a[a.indexOf(k) + 1] : d);
  seed({ adminUrl: process.env.DATABASE_URL_ADMIN, runtimeUrl: process.env.DATABASE_URL_RUNTIME, profile: get('--profile', 'tiny'),
    seedNo: Number(get('--seed', 1)), referenceOnly: a.includes('--reference-only'), requests: !a.includes('--no-requests') })
    .catch((e) => { console.error(e.message); process.exit(1); });
}
