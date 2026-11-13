import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { withSession } from '../lib/session.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const HOST = process.env.TEST_DB_HOST ?? '127.0.0.1';
export const PORT = Number(process.env.TEST_DB_PORT ?? 55432);
export const DB = process.env.TEST_DB_NAME ?? 'ari_pst_test';
export const url = (user, db = DB) => `postgres://${user}@${HOST}:${PORT}/${db}`;
export const pools = {};
export function pool(user, db = DB) {
  const key = `${user}@${db}`;
  return (pools[key] ??= new pg.Pool({ connectionString: url(user, db), max: 8 }));
}
export const admin = () => pool('postgres');
export const runtime = () => pool('app_runtime');
export async function closeAll() { await Promise.all(Object.values(pools).map((p) => p.end())); for (const k of Object.keys(pools)) delete pools[k]; }

// ---- fixed ids (valid ulid_text) ----
const id = (prefix, n) => `${prefix}_${String(n).padStart(26, '0')}`;
export const C = { A: id('ctr', 1), B: id('ctr', 2), C: id('ctr', 3) };
export const U = {
  adminA: id('usr', 1), adminB: id('usr', 2), coordA: id('usr', 3), coordB: id('usr', 4),
  comA: id('usr', 5), comB: id('usr', 6), comC: id('usr', 7), resA: id('usr', 8), resB: id('usr', 9), intl: id('usr', 10),
  clinA: id('usr', 11), clinB: id('usr', 12), plain: id('usr', 13),
};
export const ROLE = { adminA: 'system_admin', adminB: 'system_admin', coordA: 'national_coordinator', coordB: 'national_coordinator',
  comA: 'committee_member', comB: 'committee_member', comC: 'committee_member', resA: 'researcher_il', resB: 'researcher_il',
  intl: 'researcher_intl', clinA: 'center_clinician', clinB: 'center_clinician' };

/** Idempotent base fixtures, loaded as superuser (bypasses RLS). Everything is synthetic. */
export async function baseFixtures() {
  const a = admin();
  await a.query(readFileSync(path.join(here, '..', 'seeds', '010_diagnosis_vocabulary.sql'), 'utf8')).catch((e) => { if (e.code !== '23505') throw e; });
  await a.query(`INSERT INTO portal.centers (id, code, name_en, name_he, contact_role) VALUES
    ($1,'synth_a','Synthetic Center A','מרכז סינתטי א','Center research coordinator'),
    ($2,'synth_b','Synthetic Center B','מרכז סינתטי ב','Center research coordinator'),
    ($3,'synth_c','Synthetic Center C','מרכז סינתטי ג','Center research coordinator') ON CONFLICT DO NOTHING`, [C.A, C.B, C.C]);
  for (const [k, uid] of Object.entries(U)) {
    await a.query(`INSERT INTO portal.users (id,email,display_name,status,email_verified_at) VALUES ($1,$2,$3,'active',now()) ON CONFLICT DO NOTHING`,
      [uid, `synthetic.${k.toLowerCase()}@example.invalid`, `Synthetic ${k}`]);
  }
  const centerOf = { clinA: C.A, clinB: C.B };
  for (const [k, role] of Object.entries(ROLE)) {
    await a.query(`INSERT INTO portal.role_assignments (id,user_id,role,center_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [`rol_${U[k].slice(4)}`, U[k], role, centerOf[k] ?? null]);
  }
}

/** Run as app_runtime inside one txn with a session context. */
export const as = (who, fn, opts) => withSession(runtime(), { userId: who === 'anonymous' ? null : U[who], role: who === 'anonymous' ? 'anonymous' : ROLE[who] }, fn, opts);
export const q = async (c, sql, p) => (await c.query(sql, p)).rows;

/** Expect a SQL error. Matches on SQLSTATE code or message substring. */
export async function fails(promise, match) {
  let err;
  try { await promise; } catch (e) { err = e; }
  if (!err) throw new Error(`expected an error matching ${match}, but the call succeeded`);
  if (match && !(err.code === match || String(err.message).includes(match))) throw new Error(`expected ${match}, got ${err.code}: ${err.message}`);
  return err;
}

let sampleCounter = 1000;
export const sid = (n) => `smp_${String(n).padStart(26, '0')}`;
export async function resetSamples() {
  const a = admin();
  await a.query('DELETE FROM portal.samples');
}
/** Insert samples as superuser. rows: {n, center, dx, sex, age, type, donor, availability, tp} */
export async function addSamples(rows) {
  const a = admin();
  for (const r of rows) {
    await a.query(`INSERT INTO portal.samples (id, donor_ref, source_center_id, diagnosis_code, age_band_at_diagnosis, sex, sample_type, availability,
      clinical_timepoint, collection_month, contact_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'2024-05','Center research coordinator')`,
      [sid(++sampleCounter), r.donor ?? sampleCounter.toString(16).padStart(32, '0'), r.center, r.dx, r.age ?? '3_lt6', r.sex ?? 'female',
       r.type ?? 'ffpe', r.availability ?? 'available', r.tp ?? 'diagnosis']);
  }
}
export async function refreshSnapshot() {
  const c = await admin().connect();
  try { await c.query('SET SESSION AUTHORIZATION app_readonly_bg'); const r = await c.query('SELECT agg.refresh_snapshot() AS e'); await c.query('RESET SESSION AUTHORIZATION'); return r.rows[0].e; }
  finally { c.release(); }
}
export async function asBg(fn) {
  const c = await pool('app_readonly_bg').connect();
  try { return await fn(c); } finally { c.release(); }
}
