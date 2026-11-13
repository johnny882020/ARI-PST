import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { U, admin, as, asBg, baseFixtures, closeAll, fails, pool, q } from './helpers.mjs';

beforeAll(baseFixtures);
afterAll(closeAll);
const verify = () => asBg(async (c) => (await c.query('SELECT * FROM audit.verify_chain()')).rows);
/** Apply a tamper inside a transaction, verify as the background verifier, then roll everything back. */
const tamperVerify = async (sql, params = []) => {
  const c = await admin().connect();
  try {
    await c.query('BEGIN'); await c.query(`SET LOCAL session_replication_role = replica`);
    await c.query(sql, params);
    await c.query('SET SESSION AUTHORIZATION app_readonly_bg');
    return (await c.query('SELECT * FROM audit.verify_chain()')).rows;
  } finally { await c.query('ROLLBACK').catch(() => {}); await c.query('RESET SESSION AUTHORIZATION').catch(() => {}); c.release(); }
};

describe('audit log (RT-09)', () => {
  it('actor and role come from the signed session, not from the caller', async () => {
    await as('coordA', (c) => c.query(`SELECT audit.record('sample.view','sample','smp_x')`));
    const [e] = await q(admin(), `SELECT actor_user_id, actor_role FROM audit.audit_events WHERE action='sample.view' ORDER BY occurred_at DESC LIMIT 1`);
    expect(e).toEqual({ actor_user_id: U.coordA, actor_role: 'national_coordinator' });
    // there is no parameter that accepts an actor; a forged context writes an anonymous, actor-less event
    const c = await pool('app_runtime').connect();
    try {
      await c.query('BEGIN'); await c.query(`SELECT set_config('app.ctx', '${U.adminA}|system_admin||forged', true)`);
      await c.query(`SELECT audit.record('request.approve')`); await c.query('COMMIT');
    } finally { c.release(); }
    const [f] = await q(admin(), `SELECT actor_user_id, actor_role FROM audit.audit_events WHERE action='request.approve' ORDER BY occurred_at DESC LIMIT 1`);
    expect(f).toEqual({ actor_user_id: null, actor_role: 'anonymous' });
  });
  it('only app_audit_writer holds INSERT; nobody else can write, update, delete or truncate', async () => {
    const privs = await q(admin(), `SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_schema='audit' AND table_name='audit_events' AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')`);
    expect(new Set(privs.filter((p) => p.privilege_type === 'INSERT').map((p) => p.grantee))).toEqual(new Set(['app_audit_writer']));
    for (const u of ['app_runtime', 'app_migrator', 'app_readonly_bg']) {
      await fails(pool(u).query(`INSERT INTO audit.audit_events (lane,lane_seq,id,occurred_at,action,outcome,key_version,prev_hash,entry_hash) VALUES (0,999,'aud_${'9'.padStart(26, '0')}',now(),'a.b','allow',1,'\\x00','\\x00')`), '42501');
    }
    const w = pool('app_audit_writer');
    await fails(w.query(`UPDATE audit.audit_events SET outcome='deny'`), '42501');
    await fails(w.query(`DELETE FROM audit.audit_events`), '42501');
    await fails(w.query(`TRUNCATE audit.audit_events`), '42501');
    await fails(admin().query(`DELETE FROM audit.audit_events`), '42501');                         // trigger blocks even a superuser
  });
  it('record_trusted is only callable by the audit-writer login (auth adapter)', async () => {
    await fails(as('adminA', (c) => c.query(`SELECT audit.record_trusted('usr_x','system_admin',NULL,'auth.login.success')`)), '42501');
    await pool('app_audit_writer').query(`SELECT audit.record_trusted('${U.resA}','researcher_il',NULL,'auth.login.success','user','${U.resA}')`);
    const [e] = await q(admin(), `SELECT actor_user_id FROM audit.audit_events WHERE action='auth.login.success' ORDER BY occurred_at DESC LIMIT 1`);
    expect(e.actor_user_id).toBe(U.resA);
  });
  it('denial events survive the rollback of the failed action', async () => {
    const before = (await q(admin(), `SELECT count(*)::int n FROM audit.audit_events WHERE action='authz.deny'`))[0].n;
    await fails(as('resA', async (c) => { await c.query(`SELECT audit.record('sample.view')`); await c.query(`SELECT portal.request_cast_vote('req_x','approve',NULL,NULL)`); }), 'forbidden');
    expect((await q(admin(), `SELECT count(*)::int n FROM audit.audit_events WHERE action='authz.deny'`))[0].n).toBe(before);
    await as('resA', (c) => c.query(`SELECT audit.record_denial('authz.deny','request','req_x','role_not_allowed')`));        // new transaction after rollback
    const [d] = await q(admin(), `SELECT outcome, details FROM audit.audit_events WHERE action='authz.deny' ORDER BY occurred_at DESC LIMIT 1`);
    expect(d).toMatchObject({ outcome: 'deny', details: { reason: 'role_not_allowed' } });
    const lost = await q(admin(), `SELECT count(*)::int n FROM audit.audit_events WHERE action='sample.view' AND occurred_at > now() - interval '1 second' AND actor_user_id='${U.resA}'`);
    expect(lost[0].n).toBe(0);                                                                      // the rolled-back business event is gone, the denial is not
  });
  it('chain verifies; any tampered byte, forged hash or deleted row is detected', async () => {
    expect(await verify()).toEqual([]);
    const [row] = await q(admin(), `SELECT lane, lane_seq FROM audit.audit_events e WHERE EXISTS (SELECT 1 FROM audit.audit_events n WHERE n.lane=e.lane AND n.lane_seq=e.lane_seq+1) ORDER BY occurred_at LIMIT 1`);
    const where = [row.lane, row.lane_seq];
    expect(await tamperVerify(`UPDATE audit.audit_events SET object_id='tampered' WHERE lane=$1 AND lane_seq=$2`, where))
      .toEqual([expect.objectContaining({ lane: row.lane, broken_seq: String(row.lane_seq), reason: 'hash_mismatch' })]);
    expect(await tamperVerify(`UPDATE audit.audit_events SET outcome='deny' WHERE lane=$1 AND lane_seq=$2`, where)).toHaveLength(1);
    // an attacker without the HMAC key cannot repair the entry with a plain SHA-256
    expect(await tamperVerify(`UPDATE audit.audit_events SET object_id='x', entry_hash = sha256(convert_to('x','UTF8')) WHERE lane=$1 AND lane_seq=$2`, where)).toHaveLength(1);
    expect((await tamperVerify(`DELETE FROM audit.audit_events WHERE lane=$1 AND lane_seq=$2`, where)).some((r) => r.reason === 'gap')).toBe(true);
    expect(await tamperVerify(`UPDATE audit.chain_head SET last_seq = last_seq + 1 WHERE lane=$1`, [row.lane])).toEqual([expect.objectContaining({ reason: 'head_mismatch' })]);
    expect(await verify()).toEqual([]);                                                              // nothing persisted
  });
  it('no global lock: concurrent writers do not block each other and the chain stays valid and gapless', async () => {
    await baseFixtures();
    const t0 = Date.now();
    await Promise.all(Array.from({ length: 80 }, (_, i) => as(['coordA', 'resA', 'comA', 'clinA'][i % 4], (c) => c.query(`SELECT audit.record('search.aggregate','search',$1)`, [`q${i}`]))));
    expect(Date.now() - t0).toBeLessThan(20000);
    expect(await verify()).toEqual([]);
    const lanes = await q(admin(), `SELECT h.lane, h.last_seq, (SELECT count(*) FROM audit.audit_events e WHERE e.lane=h.lane)::int n, (SELECT min(lane_seq) FROM audit.audit_events e WHERE e.lane=h.lane) mn FROM audit.chain_head h`);
    for (const l of lanes) if (l.n) expect(Number(l.last_seq) - Number(l.mn) + 1).toBe(l.n);
    expect(lanes.filter((l) => l.n > 0).length).toBeGreaterThan(1);                                  // writers spread over lanes
  });
  it('long open transactions on one lane do not stop other writers (SKIP LOCKED lane choice)', async () => {
    const holder = await pool('app_audit_writer').connect();
    await holder.query('BEGIN'); await holder.query(`SELECT audit.record_trusted('usr_x','system',NULL,'audit.verify.ok')`);   // holds one lane lock
    const t0 = Date.now();
    await as('coordA', (c) => c.query(`SELECT audit.record('sample.view')`));
    expect(Date.now() - t0).toBeLessThan(2000);
    await holder.query('COMMIT'); holder.release();
  });
  it('audit reads are scoped by role and themselves audited (audit.read)', async () => {
    const admins = await as('adminA', (c) => q(c, `SELECT * FROM audit.read_events(now() - interval '1 day', now(), NULL, 1000)`));
    expect(admins.length).toBeGreaterThan(10);
    const com = await as('comA', (c) => q(c, `SELECT * FROM audit.read_events(now() - interval '1 day', now(), NULL, 1000)`));
    expect(com.every((e) => e.action.startsWith('request.') || e.actor_user_id === U.comA)).toBe(true);
    const res = await as('resA', (c) => q(c, `SELECT * FROM audit.read_events(now() - interval '1 day', now(), NULL, 1000)`));
    expect(res.every((e) => e.actor_user_id === U.resA)).toBe(true);
    await fails(as('anonymous', (c) => c.query('SELECT * FROM audit.read_events()')), 'forbidden');
    expect((await q(admin(), `SELECT count(*)::int n FROM audit.audit_events WHERE action='audit.read'`))[0].n).toBeGreaterThanOrEqual(3);
  });
  it('anchor material is available to the verifier and admin only; verify logs its result', async () => {
    const a = await asBg(async (c) => (await c.query('SELECT * FROM audit.anchor()')).rows);
    expect(a).toHaveLength(8); expect(a[0].anchor_hmac).toMatch(/^[0-9a-f]{64}$/);
    expect((await as('resA', (c) => q(c, 'SELECT * FROM audit.anchor()'))).length).toBe(0);
    await fails(as('resA', (c) => c.query('SELECT * FROM audit.verify_chain()')), 'forbidden');
    expect((await q(admin(), `SELECT count(*)::int n FROM audit.audit_events WHERE action IN ('audit.verify.ok','audit.verify.fail')`))[0].n).toBeGreaterThan(2);
  });
  it('request transitions and role changes are audited with server-side actor', async () => {
    const rid = await as('resA', async (c) => (await q(c, `SELECT portal.request_create('audit-test-key-1') id`))[0].id);
    await as('resA', (c) => c.query('SELECT portal.request_withdraw($1)', [rid]));
    await as('adminA', (c) => c.query(`SELECT portal.change_propose('k_policy','{"field_set":"audit_t","k":9}')`));
    const cid = (await q(admin(), `SELECT id FROM portal.change_requests WHERE payload->>'field_set'='audit_t'`))[0].id;
    await as('comA', (c) => c.query('SELECT portal.change_approve($1,10)', [cid]));
    await admin().query(`DELETE FROM portal.k_policies WHERE field_set='audit_t'`);
    await as('comA', (c) => c.query('SELECT * FROM audit.read_events()'));
    const rows = await q(admin(), `SELECT DISTINCT action FROM audit.audit_events`);
    const actions = rows.map((r) => r.action);
    for (const a of ['request.state_changed', 'role.grant', 'k.change', 'audit.read']) expect(actions).toContain(a);
  });
  it('no identifier-shaped values in any audit row (canary scan)', async () => {
    const text = (await q(admin(), `SELECT string_agg(coalesce(object_id,'') || coalesce(details::text,''), ' ') t FROM audit.audit_events`))[0].t ?? '';
    expect(text).not.toMatch(/[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/);
    expect(text).not.toMatch(/\b\d{9}\b/);
  });
});
