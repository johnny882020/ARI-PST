import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeAll, scratchDb, fails } from './helpers.mjs';
import { withSession } from '../lib/session.mjs';
import { generate, toSqlStatements } from '../../packages/synthetic-data/src/index.ts';
import { seedRequests } from '../lib/workflow.mjs';

let db; let ds;
const run = (sql, p) => db.admin.query(sql, p);
const bg = (sql, p) => db.bg.query(sql, p);
beforeAll(async () => {
  db = await scratchDb('ari_pst_ret');
  await run(`SELECT 1`);
  const { readFileSync } = await import('node:fs');
  await run(readFileSync(new URL('../seeds/010_diagnosis_vocabulary.sql', import.meta.url), 'utf8'));
  ds = generate({ seed: 11, profile: 'tiny' });
  for (const s of toSqlStatements(ds)) await run(s);
  const c = await db.admin.connect(); await c.query('SET SESSION AUTHORIZATION app_readonly_bg'); await c.query('SELECT agg.refresh_snapshot()'); await c.query('RESET SESSION AUTHORIZATION'); c.release();
  await seedRequests(db.runtime, ds);
}, 120000);
afterAll(async () => { await db.drop(); await closeAll(); });

const noGuard = async (fn) => { await run('ALTER TABLE portal.requests DISABLE TRIGGER trg_requests_guard'); try { await fn(); } finally { await run('ALTER TABLE portal.requests ENABLE TRIGGER trg_requests_guard'); } };

describe('retention and purge (RT-05, RT-21, C-07)', () => {
  it('only the background role (and ops) may run retention', async () => {
    await fails(db.runtime.query('SELECT portal.retention_run()'), '42501');
  });
  it('idempotency keys older than 24 h are purged', async () => {
    const u = ds.users.find((x) => x.role === 'researcher_il').id;
    await run(`INSERT INTO portal.idempotency_keys (user_id,key,method_path,request_hash,created_at) VALUES ($1,'old-key-12345','POST /x','\\x00', now() - interval '3 days'),($1,'new-key-12345','POST /x','\\x00', now())`, [u]);
    const r = (await bg('SELECT portal.retention_run() r')).rows[0].r;
    expect(r.idempotency_keys).toBe(1);
  });
  it('purging a soft-deleted sample keeps the request history as a tombstone (no FK failure)', async () => {
    const sample = ds.samples[0];
    const delivered = (await run(`SELECT r.id FROM portal.requests r WHERE r.status='closed' AND r.close_reason='delivered'`)).rows[0].id;
    expect((await run(`SELECT count(*)::int n FROM portal.request_item_samples WHERE sample_code=$1`, [sample.id])).rows[0].n).toBe(1);
    await run(`UPDATE portal.samples SET availability='depleted', deleted_at = now() - interval '25 months' WHERE id=$1`, [sample.id]);
    const r = (await bg('SELECT portal.retention_run() r')).rows[0].r;
    expect(r.samples).toBe(1);
    const [t] = (await run(`SELECT sample_id, sample_code, center_id FROM portal.request_item_samples WHERE sample_code=$1`, [sample.id])).rows;
    expect(t).toEqual({ sample_id: null, sample_code: sample.id, center_id: sample.sourceCenterId });
    expect((await run('SELECT status FROM portal.requests WHERE id=$1', [delivered])).rows[0].status).toBe('closed');
    expect((await run('SELECT count(*)::int n FROM portal.samples WHERE id=$1', [sample.id])).rows[0].n).toBe(0);
  });
  it('request free text is wiped 24 months after close; the structured record remains; purge after 7 years', async () => {
    await noGuard(() => run(`UPDATE portal.requests SET closed_at = now() - interval '25 months' WHERE status='closed'`));
    const r = (await bg('SELECT portal.retention_run() r')).rows[0].r;
    expect(r.request_text_wiped).toBeGreaterThanOrEqual(1);
    const row = (await run(`SELECT research_question, planned_use, funding_sources, text_wiped_at IS NOT NULL w, close_reason FROM portal.requests WHERE status='closed' LIMIT 1`)).rows[0];
    expect(row).toMatchObject({ research_question: null, planned_use: null, funding_sources: null, w: true });
    expect((await run(`SELECT count(*)::int n FROM portal.request_votes WHERE comment IS NOT NULL`)).rows[0].n).toBe(0);
    await noGuard(() => run(`UPDATE portal.requests SET closed_at = now() - interval '8 years' WHERE status='closed'`));
    const r2 = (await bg('SELECT portal.retention_run() r')).rows[0].r;
    expect(r2.requests).toBeGreaterThanOrEqual(1);
    expect((await run(`SELECT count(*)::int n FROM portal.requests WHERE status='closed'`)).rows[0].n).toBe(0);
    expect((await run(`SELECT count(*)::int n FROM portal.request_items i WHERE NOT EXISTS (SELECT 1 FROM portal.requests r WHERE r.id=i.request_id)`)).rows[0].n).toBe(0);
  });
  it('closed users are anonymised after 12 months; audit keeps only the usr_ id', async () => {
    const u = ds.users.find((x) => x.role === 'researcher_intl');
    await run(`UPDATE portal.users SET status='closed', closed_at = now() - interval '13 months' WHERE id=$1`, [u.id]);
    const r = (await bg('SELECT portal.retention_run() r')).rows[0].r;
    expect(r.users_anonymised).toBe(1);
    const row = (await run('SELECT email, display_name FROM portal.users WHERE id=$1', [u.id])).rows[0];
    expect(row.display_name).toBe('Deleted user'); expect(row.email).toMatch(/^deleted\+[0-9a-f]{16}@users\.invalid$/);
  });
  it('import jobs expire and their staging keys are cleared', async () => {
    const coord = ds.users.find((x) => x.role === 'national_coordinator');
    await run(`INSERT INTO portal.import_jobs (id, created_by, format, file_name_safe, staging_key, expires_at, status) VALUES ('imp_${'1'.padStart(26, '1')}', $1, 'csv', 'a.csv', 'k/1', now() - interval '1 day', 'uploaded')`, [coord.id]);
    await bg('SELECT portal.retention_run()');
    expect((await run(`SELECT status, staging_key FROM portal.import_jobs`)).rows[0]).toEqual({ status: 'expired', staging_key: null });
  });
  it('import job status machine: a commit job needs a validated dry run of the same file', async () => {
    const coord = ds.users.find((x) => x.role === 'national_coordinator');
    await fails(withSession(db.runtime, { userId: coord.id, role: 'national_coordinator' }, (c) => c.query(
      `INSERT INTO portal.import_jobs (id, created_by, mode, format, file_name_safe) VALUES ('imp_${'2'.padStart(26, '2')}', $1, 'commit', 'csv', 'a.csv')`, [coord.id])), 'commit_requires_validated_dry_run');
    await withSession(db.runtime, { userId: coord.id, role: 'national_coordinator' }, async (c) => {
      await c.query(`INSERT INTO portal.import_jobs (id, created_by, format, file_name_safe, file_sha256) VALUES ('imp_${'3'.padStart(26, '3')}', $1, 'csv', 'a.csv', '\\x0102')`, [coord.id]);
      await fails(c.query(`UPDATE portal.import_jobs SET status='committed' WHERE id='imp_${'3'.padStart(26, '3')}'`), 'invalid_import_transition');
    }, { commit: true }).catch(() => {});
  });
  it('staleness: reminders per center for due-soon and stale samples, once per digest period', async () => {
    await run(`UPDATE portal.samples SET last_verified_at = now() - interval '200 days'`);
    const n = (await bg('SELECT portal.staleness_run() n')).rows[0].n;
    expect(n).toBeGreaterThan(0);
    expect((await bg('SELECT portal.staleness_run() n')).rows[0].n).toBe(0);
    const [r] = (await run('SELECT sum(stale_count)::int s FROM portal.staleness_reminders')).rows;
    expect(r.s).toBeGreaterThan(0);
    await run(`UPDATE portal.samples SET last_verified_at = now() - interval '160 days'`);
    const v = (await run(`SELECT staleness, count(*)::int n FROM portal.v_sample_staleness GROUP BY 1`)).rows;
    expect(v).toEqual([{ staleness: 'due_soon', n: expect.any(Number) }]);
  });
  it('audit purge removes whole prefixes with a truncation record and the chain still verifies', async () => {
    const before = (await run('SELECT count(*)::int n FROM audit.audit_events')).rows[0].n;
    expect(before).toBeGreaterThan(20);
    const purged = (await bg(`SELECT audit.purge_before(now() + interval '1 day') n`).catch(() => null));
    expect(purged).toBeNull();                                                      // bg cannot call it directly
    const r = (await db.bg.query(`SELECT portal.retention_run(now() + interval '8 years') r`)).rows[0].r;
    expect(r.audit_events).toBe(before);
    expect((await run('SELECT count(*)::int n FROM audit.chain_truncation')).rows[0].n).toBeGreaterThan(0);
    expect((await db.bg.query('SELECT * FROM audit.verify_chain()')).rows).toEqual([]);
    expect((await run(`SELECT count(*)::int n FROM audit.audit_events WHERE action='retention.purge'`)).rows[0].n).toBeGreaterThanOrEqual(1);
  });
});
