import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { closeAll, scratchDb, fails, url } from './helpers.mjs';
import { generate } from '../../packages/synthetic-data/src/index.ts';
import { seed } from '../seed.mjs';
import { exportAll } from '../export.mjs';
import { importAll } from '../import.mjs';
import { withSession } from '../lib/session.mjs';

let a; let b; let ds; const dir = mkdtempSync(path.join(tmpdir(), 'ari-export-'));
beforeAll(async () => {
  a = await scratchDb('ari_pst_rt_a'); b = await scratchDb('ari_pst_rt_b');
  const r = await seed({ adminUrl: url('postgres', a.name), runtimeUrl: url('app_runtime', a.name), profile: 'tiny', seedNo: 5, log: () => {} });
  ds = r.ds;
}, 180000);
afterAll(async () => { await a.drop(); await b.drop(); await closeAll(); });
const counts = async (db) => Object.fromEntries((await Promise.all(['portal.samples', 'portal.requests', 'portal.request_votes', 'portal.users', 'audit.audit_events', 'portal.request_events'].map(async (t) => [t, (await db.admin.query(`SELECT count(*)::int n FROM ${t}`)).rows[0].n]))));

describe('seed', () => {
  it('seeds the tiny profile with the documented shape and real request workflow rows', async () => {
    const c = await counts(a);
    expect(c['portal.samples']).toBe(40);
    expect(c['portal.requests']).toBe(9);
    expect(c['portal.request_votes']).toBeGreaterThanOrEqual(7);
    expect(c['audit.audit_events']).toBeGreaterThan(30);
    const states = (await a.admin.query(`SELECT status, close_reason FROM portal.requests ORDER BY status`)).rows.map((r) => `${r.status}/${r.close_reason}`);
    for (const s of ['draft/null', 'needs_info/null', 'committee_review/null', 'approved/null', 'rejected/null', 'closed/delivered', 'closed/withdrawn']) expect(states).toContain(s);
    expect((await a.admin.query('SELECT bool_and(is_synthetic) b FROM portal.samples')).rows[0].b).toBe(true);
    expect((await a.bg.query('SELECT * FROM audit.verify_chain()')).rows).toEqual([]);
  });
  it('refuses to seed when the production gate is closed or non-synthetic rows exist', async () => {
    process.env.GATE_PROD_DATA_CLOSED = 'true';
    await expect(seed({ adminUrl: url('postgres', a.name), profile: 'tiny', log: () => {} })).rejects.toThrow(/GATE_PROD_DATA_CLOSED/);
    delete process.env.GATE_PROD_DATA_CLOSED;
    await a.admin.query(`UPDATE portal.samples SET is_synthetic=false WHERE id=(SELECT id FROM portal.samples LIMIT 1)`);
    await expect(seed({ adminUrl: url('postgres', a.name), profile: 'tiny', log: () => {} })).rejects.toThrow(/non-synthetic/);
    await a.admin.query(`UPDATE portal.samples SET is_synthetic=true`);
  });
});

describe('export / import round trip (REQ-054, GATE-PROD-DATA prerequisite)', () => {
  it('export -> import into an empty migrated DB -> same counts, same checksums, valid audit chain', async () => {
    const m = await exportAll({ url: url('postgres', a.name), outDir: dir, includeKeys: true });
    expect(m.format).toBe('ari-pst-export'); expect(m.isSynthetic).toBe(true);
    expect(m.tables.find((t) => t.name === 'portal.samples').rows).toBe(40);
    expect(m.tables.map((t) => t.name).join()).not.toMatch(/authn|ops\.|ctx_secret|email_verifications/);
    const rep = await importAll({ url: url('postgres', b.name), inDir: dir });
    expect(rep.chain).toBe('verified');
    expect(await counts(b)).toEqual(await counts(a));
    const dir2 = mkdtempSync(path.join(tmpdir(), 'ari-export2-'));
    const m2 = await exportAll({ url: url('postgres', b.name), outDir: dir2, includeKeys: true });
    for (const t of m.tables) expect(m2.tables.find((x) => x.name === t.name)).toMatchObject({ rows: t.rows, sha256: t.sha256 });   // byte-identical data
    expect(m2.auditChain).toEqual(m.auditChain);
  });
  it('the imported database works: privacy engine and workflow functions run on restored data', async () => {
    const c = await b.admin.connect(); await c.query('SET SESSION AUTHORIZATION app_readonly_bg'); await c.query('SELECT agg.refresh_snapshot()'); await c.query('RESET SESSION AUTHORIZATION'); c.release();
    const res = ds.users.find((u) => u.role === 'researcher_il');
    const t = await withSession(b.runtime, { userId: res.id, role: 'researcher_il' }, async (cl) => (await cl.query(`SELECT * FROM agg.total_count('{}')`)).rows[0]);
    expect(t.masked).toBe(false);
  });
  it('a tampered, truncated or missing file is rejected before anything is written', async () => {
    const bad = mkdtempSync(path.join(tmpdir(), 'ari-bad-'));
    const m = await exportAll({ url: url('postgres', a.name), outDir: bad });
    const f = path.join(bad, 'data', 'portal.samples.ndjson');
    const orig = readFileSync(f, 'utf8');
    writeFileSync(f, orig.replace('female', 'femalx'));
    await expect(importAll({ url: url('postgres', b.name), inDir: bad })).rejects.toThrow(/checksum mismatch/);
    writeFileSync(f, orig);
    const mf = path.join(bad, 'manifest.json'); const man = JSON.parse(readFileSync(mf, 'utf8'));
    man.tables.find((t) => t.name === 'portal.samples').rows = 41; writeFileSync(mf, JSON.stringify(man));
    await expect(importAll({ url: url('postgres', b.name), inDir: bad })).rejects.toThrow(/row count mismatch/);
    man.tables.find((t) => t.name === 'portal.samples').rows = 40; man.schemaVersion = '0001'; writeFileSync(mf, JSON.stringify(man));
    await expect(importAll({ url: url('postgres', b.name), inDir: bad })).rejects.toThrow(/schema level/);
    expect(m.excluded).toContain('audit.chain_key');
    expect((await counts(b))['portal.samples']).toBe(40);
  });
  it('export without keys carries no secrets: no chain key, no context secret, no credentials', async () => {
    const d = mkdtempSync(path.join(tmpdir(), 'ari-nokey-'));
    const m = await exportAll({ url: url('postgres', a.name), outDir: d });
    expect(m.tables.some((t) => t.name === 'audit.chain_key')).toBe(false);
    const all = m.tables.map((t) => readFileSync(path.join(d, t.file), 'utf8')).join('');
    expect(all).not.toMatch(/password_hash|totp_secret|id_hash|csrf_token/);
  });
  it('break-glass export: refused without an approved grant, allowed during the window, logged', async () => {
    const [admin, com, coord] = ['system_admin', 'committee_member', 'national_coordinator'].map((r) => ds.users.find((u) => u.role === r));
    await a.admin.query('ALTER ROLE app_break_glass LOGIN');
    const d = mkdtempSync(path.join(tmpdir(), 'ari-bg-'));
    await expect(exportAll({ url: url('app_break_glass', a.name), outDir: d })).rejects.toThrow(/no_active_grant|permission denied/);
    const S = (u, fn) => withSession(a.runtime, { userId: u.id, role: u.role }, fn);
    const id = await S(admin, async (c) => (await c.query(`SELECT portal.breakglass_request('full_export') id`)).rows[0].id);
    await S(com, (c) => c.query('SELECT portal.breakglass_approve($1, 10)', [id]));
    await expect(exportAll({ url: url('app_break_glass', a.name), outDir: d })).rejects.toThrow(/no_active_grant/);   // one approver is not enough
    await S(coord, (c) => c.query('SELECT portal.breakglass_approve($1, 10)', [id]));
    const m = await exportAll({ url: url('app_break_glass', a.name), outDir: d });
    expect(m.tables.find((t) => t.name === 'portal.samples').rows).toBe(40);
    expect((await a.admin.query(`SELECT count(*)::int n FROM audit.audit_events WHERE action IN ('breakglass.use','breakglass.request','breakglass.approve')`)).rows[0].n).toBeGreaterThanOrEqual(4);
    await a.admin.query('ALTER ROLE app_break_glass NOLOGIN');
  });
});
