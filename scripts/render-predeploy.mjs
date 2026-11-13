#!/usr/bin/env node
// Render preDeployCommand for ari-api:  node scripts/render-predeploy.mjs
// Runs before every deploy. Idempotent. A failure aborts the deploy and the old version keeps serving.
//
//   1. BOOTSTRAP  as the Render database user (DATABASE_URL_OWNER). Creates the C-06 roles, sets their
//                 passwords from env (Render generateValue), then runs db/bootstrap.sql unchanged.
//   2. MIGRATE    node db/migrate.mjs as app_migrator (forward-only).
//   3. VOCABULARY loads db/seeds/010_diagnosis_vocabulary.sql when portal.diagnosis_terms is empty (reference data).
//   4. SEED       only when SEED_SYNTHETIC=true or IS_PULL_REQUEST=true, and only when DATA_CLASSIFICATION=synthetic:
//                 node apps/api/dist/jobs/seed-synthetic.js
//
// ASSUMPTION (UNVERIFIED against render.com, verified locally with scripts/sim-render-db.sh): the Render database
// user is NOT a superuser, owns the database, and has CREATEROLE. Nothing here needs superuser. If the user has
// no CREATEROLE the script stops with a clear message before it changes anything.
//
// Env:  DATABASE_URL_OWNER (fromDatabase connectionString)   DB_PASSWORD_MIGRATOR  DB_PASSWORD_RUNTIME  DB_PASSWORD_BG
//       DATA_CLASSIFICATION  SEED_SYNTHETIC  IS_PULL_REQUEST  PREDEPLOY_SKIP_BOOTSTRAP=true (roles managed by hand)
// Logs carry no passwords and no connection strings.
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pg = createRequire(path.join(root, 'db', 'package.json'))('pg');
const env = process.env;
const log = (step, msg) => console.log(JSON.stringify({ job: 'predeploy', step, msg }));
const die = (step, msg) => { console.error(JSON.stringify({ job: 'predeploy', step, ok: false, error: msg })); process.exit(1); };
const truthy = (v) => ['1', 'true', 'yes'].includes(String(v ?? '').toLowerCase());
const need = (k) => { const v = env[k]; if (!v) die('env', `${k} is required`); return v; };

const LOGIN_ROLES = [['app_migrator', 'DB_PASSWORD_MIGRATOR'], ['app_runtime', 'DB_PASSWORD_RUNTIME'], ['app_readonly_bg', 'DB_PASSWORD_BG']];

function roleUrl(ownerUrl, user, password) {
  const u = new URL(ownerUrl);
  u.username = user; u.password = encodeURIComponent(password);
  return u.toString();
}
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;   // SQL literal (ALTER ROLE takes no bind parameters)

async function bootstrap(ownerUrl) {
  const c = new pg.Client({ connectionString: ownerUrl });
  await c.connect();
  try {
    const me = (await c.query('SELECT current_user AS u, r.rolsuper, r.rolcreaterole FROM pg_roles r WHERE r.rolname = current_user')).rows[0];
    if (LOGIN_ROLES.some(([r]) => r === me.u)) die('bootstrap', 'DATABASE_URL_OWNER must not be one of the app_* roles. Use the database user Render created.');
    if (!me.rolsuper && !me.rolcreaterole) {
      die('bootstrap', 'the database user has no CREATEROLE. Create the roles by hand (db/bootstrap.sql as a database admin), set PREDEPLOY_SKIP_BOOTSTRAP=true, see docs/deployment.md');
    }
    await c.query('SELECT pg_advisory_lock(7240002)');
    // 1a. login roles with passwords. Same attributes as db/bootstrap.sql, so its IF NOT EXISTS blocks are no-ops.
    for (const [role, pwVar] of LOGIN_ROLES) {
      const pw = need(pwVar);
      if (pw.length < 16) die('bootstrap', `${pwVar} is too short (min 16)`);
      const exists = (await c.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role])).rowCount > 0;
      if (!exists) await c.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT PASSWORD ${lit(pw)}`);
      else await c.query(`ALTER ROLE ${role} PASSWORD ${lit(pw)}`);
    }
    // 1b. db/bootstrap.sql hands the database to app_migrator. A non-superuser may do that only while it is a
    //     member of app_migrator. The membership is temporary: it is revoked again below.
    if (!me.rolsuper) await c.query('GRANT app_migrator TO CURRENT_USER WITH INHERIT TRUE, SET TRUE');
    try {
      await c.query(readFileSync(path.join(root, 'db', 'bootstrap.sql'), 'utf8'));
      // The Render user must still be able to connect for the next deploy (bootstrap.sql revoked CONNECT from PUBLIC).
      const dbName = (await c.query('SELECT current_database() AS d')).rows[0].d;
      await c.query(`GRANT CONNECT ON DATABASE ${pg.escapeIdentifier(dbName)} TO CURRENT_USER`);
    } finally {
      if (!me.rolsuper) await c.query('REVOKE app_migrator FROM CURRENT_USER');
    }
    // 1c. verify what the security model relies on. Fail the deploy when it does not hold.
    const bad = (await c.query(`SELECT rolname FROM pg_roles WHERE rolname LIKE 'app\\_%' AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb)`)).rows;
    if (bad.length) die('bootstrap', `app roles with elevated attributes: ${bad.map((r) => r.rolname).join(',')}`);
    const member = (await c.query(`SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = 'app_runtime'`)).rowCount;
    if (member) die('bootstrap', 'app_runtime is a member of another role (C-06 forbids this)');
    const db = (await c.query(`SELECT pg_get_userbyid(datdba) AS owner, has_database_privilege('public', datname, 'CONNECT') AS public_connect FROM pg_database WHERE datname = current_database()`)).rows[0];
    if (db.owner !== 'app_migrator') die('bootstrap', 'database owner is not app_migrator after bootstrap');
    if (db.public_connect) die('bootstrap', 'PUBLIC can still connect to the database after bootstrap');
    log('bootstrap', 'roles ok');
  } finally { await c.end().catch(() => {}); }
}

async function vocabulary(migratorUrl) {
  const c = new pg.Client({ connectionString: migratorUrl });
  await c.connect();
  try {
    await c.query('SET ROLE app_core');   // the table owner has FORCE RLS and no policy; app_core is the definer role
    const n = (await c.query('SELECT count(*)::int AS n FROM portal.diagnosis_terms')).rows[0].n;
    if (n > 0) { log('vocabulary', 'present'); return; }
    await c.query('BEGIN');
    await c.query(readFileSync(path.join(root, 'db', 'seeds', '010_diagnosis_vocabulary.sql'), 'utf8'));
    await c.query('COMMIT');
    log('vocabulary', 'loaded');
  } finally { await c.end().catch(() => {}); }
}

function run(step, file, extraEnv) {
  const r = spawnSync(process.execPath, [file], { cwd: root, stdio: 'inherit', env: { ...env, ...extraEnv } });
  if (r.status !== 0) die(step, `exit ${r.status ?? r.signal}`);
}

const ownerUrl = need('DATABASE_URL_OWNER');
const classification = env.DATA_CLASSIFICATION ?? 'synthetic';
const wantSeed = truthy(env.SEED_SYNTHETIC) || truthy(env.IS_PULL_REQUEST);
if (wantSeed && classification !== 'synthetic') die('seed', 'SEED_SYNTHETIC is set but DATA_CLASSIFICATION is not "synthetic". Refusing: synthetic rows never go into a non-synthetic database.');

try {
  if (!truthy(env.PREDEPLOY_SKIP_BOOTSTRAP)) await bootstrap(ownerUrl); else log('bootstrap', 'skipped');
  const migratorUrl = roleUrl(ownerUrl, 'app_migrator', need('DB_PASSWORD_MIGRATOR'));
  const runtimeUrl = roleUrl(ownerUrl, 'app_runtime', need('DB_PASSWORD_RUNTIME'));
  run('migrate', path.join(root, 'db', 'migrate.mjs'), { DATABASE_URL_MIGRATOR: migratorUrl });
  log('migrate', 'ok');
  await vocabulary(migratorUrl);
  if (wantSeed) {
    const job = path.join(root, 'apps', 'api', 'dist', 'jobs', 'seed-synthetic.js');
    if (!existsSync(job)) die('seed', 'apps/api/dist/jobs/seed-synthetic.js is missing. Build the API first.');
    run('seed', job, { DATABASE_URL_MIGRATOR: migratorUrl, DATABASE_URL: runtimeUrl });
    log('seed', 'ok');
  } else log('seed', 'not requested');
} catch (e) {
  die('run', `${e?.code ?? e?.name ?? 'error'}`);
}
