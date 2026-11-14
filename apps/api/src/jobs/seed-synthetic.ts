// Synthetic seed for previews, the demo and local runs. Started by scripts/render-predeploy.mjs when SEED_SYNTHETIC=true
// (or IS_PULL_REQUEST=true). NEVER runs unless DATA_CLASSIFICATION=synthetic, and refuses when a non-synthetic sample exists.
//
// Needs no superuser (Render has none):
//   DATABASE_URL_MIGRATOR  app_migrator. It may SET ROLE app_core (the definer role that has RLS policies on portal.*).
//   DATABASE_URL           app_runtime. Credentials (authn.*) and requests go through the same paths the API uses.
//   SEED_USER_PASSWORD     one password for every synthetic user (min 16 chars). Each user's TOTP secret is derived from
//                          it and the e-mail address, so `node scripts/seed-credentials.mjs` can print the sign-in list.
//   SEED_PROFILE (tiny|preview, default preview)   SEED_NUMBER (default 1)
// Idempotent: rows use fixed ids (ON CONFLICT DO NOTHING); requests are created only on the first run.
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { generate, toSqlStatements, type Profile } from '@ari/synthetic-data';
import { loadConfig } from '../config.js';
import { PgAuth } from '../adapters/auth-local/index.js';
import { base32Encode } from '../adapters/auth-local/totp.js';
import { systemClock } from '../adapters/clock/index.js';
import { safeErrorName } from './alert.js';
import { failJob } from './run.js';

const out = (o: Record<string, unknown>) => console.log(JSON.stringify({ job: 'seed-synthetic', ...o }));
/** A refusal ends the run with a fixed reason text (no values). main().catch logs it, sends the failure alert and exits. */
class SeedRefused extends Error { constructor(readonly reason: string, readonly exitCode: number) { super(reason); this.name = 'SeedRefused'; } }
const fail = (error: string, code = 1): never => { throw new SeedRefused(error, code); };
/** Deterministic per-user TOTP secret (base32, 160 bit). Same formula in scripts/seed-credentials.mjs. */
export const seedTotpSecret = (password: string, email: string): string => base32Encode(createHmac('sha256', password).update('ari-pst-seed-totp:' + email).digest().subarray(0, 20));

async function main(): Promise<void> {
  const env = process.env;
  if ((env.DATA_CLASSIFICATION ?? 'synthetic').toLowerCase() !== 'synthetic') fail('DATA_CLASSIFICATION is not synthetic: refusing to seed', 2);
  if (env.GATE_PROD_DATA_CLOSED === 'true') fail('GATE_PROD_DATA_CLOSED=true: refusing to seed synthetic data', 2);
  const migratorUrl = env.DATABASE_URL_MIGRATOR ?? fail('DATABASE_URL_MIGRATOR missing', 2);
  const password = env.SEED_USER_PASSWORD ?? fail('SEED_USER_PASSWORD missing', 2);
  if (password.length < 16) fail('SEED_USER_PASSWORD is too short (min 16)', 2);
  const profile = (env.SEED_PROFILE ?? 'preview') as Profile;
  if (!['tiny', 'preview'].includes(profile)) fail('SEED_PROFILE must be tiny or preview', 2);
  const config = loadConfig();
  const root = env.REPO_ROOT ?? process.cwd();

  const ds = generate({ seed: Number(env.SEED_NUMBER ?? 1), profile });
  const stmts = toSqlStatements(ds);
  const isSampleStmt = (s: string) => /INSERT INTO portal\.(samples|sample_attached_data)\b/.test(s);
  const m = new pg.Client({ connectionString: migratorUrl });
  const runtime = new pg.Pool({ connectionString: config.databaseUrl, max: 2 });
  await m.connect();
  try {
    await m.query('SET ROLE app_core');
    if ((await m.query('SELECT count(*)::int AS n FROM portal.samples WHERE is_synthetic = false')).rows[0].n > 0) fail('non-synthetic samples exist: refusing to seed', 2);
    const firstRun = (await m.query('SELECT count(*)::int AS n FROM portal.samples')).rows[0].n === 0;
    await m.query('BEGIN');
    for (const s of stmts.filter((x) => !isSampleStmt(x))) await m.query(s);          // centers, users, ethics, roles
    await m.query('COMMIT');

    // Vocabulary (reference data). The pre-deploy step loads it when app_core may; otherwise load it here through a
    // coordinator session, the same path a coordinator uses in the app (see plan/requests/INT-to-B1.md).
    if ((await m.query('SELECT count(*)::int AS n FROM portal.diagnosis_terms')).rows[0].n === 0) {
      const coord = ds.users.find((u) => u.role === 'national_coordinator')!;
      const c = await runtime.connect();
      try {
        await c.query('BEGIN'); await c.query('SELECT portal.begin_session($1,$2)', [coord.id, 'national_coordinator']);
        await c.query(readFileSync(resolve(root, 'db/seeds/010_diagnosis_vocabulary.sql'), 'utf8'));
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; } finally { c.release(); }
    }
    await m.query('BEGIN');
    for (const s of stmts.filter(isSampleStmt)) await m.query(s);
    await m.query('COMMIT');

    // Credentials: password + confirmed TOTP for every synthetic user (through the auth adapter, as app_runtime).
    const auth = new PgAuth(runtime, { rpId: config.webauthn.rpId, rpName: config.webauthn.rpName, origin: config.webauthn.origin, secretsKey: config.secretsKey, argon: config.argon }, systemClock);
    const hash = await auth.hashPassword(password);
    for (const u of ds.users) { await auth.storePasswordHash(u.id, hash); await auth.seedTotpSecret(u.id, seedTotpSecret(password, u.email)); }

    await m.query('RESET ROLE');
    const epoch = (await m.query('SELECT agg.refresh_snapshot() AS e')).rows[0].e;      // allowed for session_user app_migrator
    let requests = 0;
    if (firstRun && env.SEED_REQUESTS !== 'false') {
      const { seedRequests } = await import(pathToFileURL(resolve(root, 'db/lib/workflow.mjs')).href) as { seedRequests: (pool: pg.Pool, d: unknown) => Promise<Record<string, string>> };
      requests = Object.keys(await seedRequests(runtime, ds)).length;
    }
    out({ ok: true, profile, firstRun, centers: ds.centers.length, users: ds.users.length, samples: ds.samples.length, requests, snapshotEpoch: epoch });
  } finally { await m.end().catch(() => undefined); await runtime.end().catch(() => undefined); }
}
main().catch(async (e) => {
  if (e instanceof SeedRefused) await failJob('seed-synthetic', e.name, e.exitCode, { reason: e.reason });
  else await failJob('seed-synthetic', safeErrorName(e));
});
