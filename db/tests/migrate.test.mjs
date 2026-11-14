import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { admin, closeAll, pool, url } from './helpers.mjs';
import { migrate, listMigrations } from '../migrate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.join(here, '..', 'migrations');
const DBN = 'ari_pst_mig';
const fresh = async () => {
  await admin().query(`DROP DATABASE IF EXISTS ${DBN} WITH (FORCE)`); await admin().query(`CREATE DATABASE ${DBN}`);
  const { readFileSync } = await import('node:fs');
  await pool('postgres', DBN).query(readFileSync(path.join(here, '..', 'bootstrap.sql'), 'utf8'));
};
const m = (dir, extra = {}) => migrate({ url: url('app_migrator', DBN), dir, log: () => {}, ...extra });
afterAll(async () => { await admin().query(`DROP DATABASE IF EXISTS ${DBN} WITH (FORCE)`); await closeAll(); });

describe('migration runner', () => {
  beforeAll(fresh);
  it('migration files are numbered, unique, forward-only (no down scripts)', () => {
    const files = readdirSync(MIG);
    expect(files.every((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f))).toBe(true);
    expect(new Set(files.map((f) => f.slice(0, 4))).size).toBe(files.length);
    expect(files.some((f) => /down|rollback/i.test(f))).toBe(false);
    expect(files.length).toBeGreaterThanOrEqual(10);
  });
  it('dry run changes nothing; the real run applies all in order and records checksums', async () => {
    const dry = await m(MIG, { dryRun: true });
    expect(dry).toHaveLength(listMigrations(MIG).length);
    expect((await pool('postgres', DBN).query(`SELECT to_regclass('portal.samples') t`)).rows[0].t).toBeNull();
    const applied = await m(MIG);
    expect(applied).toEqual(listMigrations(MIG).map((f) => f.name));
    const rows = (await pool('postgres', DBN).query('SELECT version, checksum FROM public.schema_migrations ORDER BY version')).rows;
    expect(rows).toHaveLength(applied.length);
    expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.checksum))).toBe(true);
  });
  it('is idempotent: a second run applies nothing', async () => { expect(await m(MIG)).toEqual([]); });
  it('a concurrent runner is serialised by the advisory lock (no double apply)', async () => {
    const r = await Promise.all([m(MIG), m(MIG)]);
    expect(r.flat()).toEqual([]);
  });
  it('a changed applied file stops the run (checksum), a removed one too', async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'mig-')); cpSync(MIG, tmp, { recursive: true });
    const f = path.join(tmp, '0004_rls_and_grants.sql');
    writeFileSync(f, '-- edited after apply\n' + (await import('node:fs')).readFileSync(f, 'utf8'));
    await expect(m(tmp)).rejects.toThrow(/checksum mismatch for 0004/);
    rmSync(f);
    await expect(m(tmp)).rejects.toThrow(/missing on disk/);
  });
  it('a failing migration rolls back completely (DDL and bookkeeping) and later runs can continue after the fix', async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'mig-')); cpSync(MIG, tmp, { recursive: true });
    writeFileSync(path.join(tmp, '0099_bad.sql'), 'CREATE TABLE portal.half_applied (id int);\nSELECT 1/0;\n');
    await expect(m(tmp)).rejects.toThrow(/0099_bad.sql failed/);
    expect((await pool('postgres', DBN).query(`SELECT to_regclass('portal.half_applied') t`)).rows[0].t).toBeNull();
    expect((await pool('postgres', DBN).query(`SELECT count(*)::int n FROM public.schema_migrations WHERE version='0099'`)).rows[0].n).toBe(0);
    writeFileSync(path.join(tmp, '0099_bad.sql'), 'CREATE TABLE portal.fixed_later (id int);\n');
    expect(await m(tmp)).toEqual(['0099_bad.sql']);
  });
  it('duplicate numbers are rejected', async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'mig-')); cpSync(MIG, tmp, { recursive: true });
    writeFileSync(path.join(tmp, '0001_again.sql'), 'SELECT 1;');
    await expect(m(tmp)).rejects.toThrow(/duplicate migration number 0001/);
  });
  it('refuses to run as a superuser or as the runtime role (RT-05)', async () => {
    await fresh();
    await expect(migrate({ url: url('postgres', DBN), dir: MIG, log: () => {} })).rejects.toThrow(/app_migrator/);
    await expect(migrate({ url: url('app_runtime', DBN), dir: MIG, log: () => {} })).rejects.toThrow();
  });
  it('migrations succeed for a non-superuser owner and leave the migrator unable to read data', async () => {
    await fresh(); await m(MIG);
    const mg = pool('app_migrator', DBN);
    expect((await mg.query('SELECT rolsuper FROM pg_roles WHERE rolname = current_user')).rows[0].rolsuper).toBe(false);
    expect((await mg.query('SELECT count(*)::int n FROM portal.users')).rows[0].n).toBe(0);
    await expect(mg.query(`INSERT INTO portal.centers (id,code,name_en,name_he,contact_role) VALUES ('ctr_${'1'.padStart(26,'1')}','x1','a','b','c')`)).rejects.toThrow(/row-level security/);
  });
});
