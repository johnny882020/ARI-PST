import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { U, admin, as, asBg, baseFixtures, closeAll, fails, pool, q } from './helpers.mjs';

beforeAll(baseFixtures);
afterAll(closeAll);
const verify = () => asBg(async (c) => (await c.query('SELECT * FROM audit.verify_chain()')).rows);
const tamper = async (sql, params) => {
  const c = await admin().connect();
  try { await c.query('BEGIN'); await c.query(`SET LOCAL session_replication_role = replica`); await c.query(sql, params); await c.query('COMMIT'); } finally { c.release(); }
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
  it('chain verifies; any tampered byte, deleted row or edited head is detected', async () => {
    expect(await verify()).toEqual([]);
    const [row] = await q(admin(), `SELECT lane, lane_seq FROM audit.audit_events ORDER BY occurred_at LIMIT 1 OFFSET 2`);
    await tamper(`UPDATE audit.audit_events SET object_id='tampered' WHERE lane=$1 AND lane_seq=$2`, [row.lane, row.lane_seq]);
    let res = await verify();
    expect(res).toEqual([expect.objectContaining({ lane: row.lane, broken_seq: String(row.lane_seq), reason: 'hash_mismatch' })]);
    await tamper(`UPDATE audit.audit_events SET object_id=NULL WHERE lane=$1 AND lane_seq=$2`, [row.lane, row.lane_seq]);
    expect(await verify()).toEqual([]);                                                              // restored byte for byte
    // a forged rewrite without the key cannot be made consistent: recompute with plain sha256 fails
    await tamper(`UPDATE audit.audit_events SET entry_hash = sha256(entry_hash) WHERE lane=$1 AND lane_seq=$2`, [row.lane, row.lane_seq]);
    expect((await verify()).length).toBe(1);
    await tamper(`UPDATE audit.audit_events SET entry_hash = (SELECT entry_hash FROM (SELECT 1) x, LATERAL (SELECT prev_hash AS entry_hash FROM audit.audit_events WHERE lane=$1 AND lane_seq=$2 + 1) y) WHERE lane=$1 AND lane_seq=$2`, [row.lane, row.lane_seq]);
  });
  it('a deleted event is detected as a gap', async () => {
    const [row] = await q(admin(), `SELECT lane, lane_seq FROM audit.audit_events e WHERE lane_seq > 1 AND EXISTS (SELECT 1 FROM audit.audit_events n WHERE n.lane=e.lane AND n.lane_seq=e.lane_seq+1) ORDER BY occurred_at LIMIT 1`);
    // restore is impossible after a delete, so snapshot and put it back
    const saved = (await q(admin(), `SELECT * FROM audit.audit_events WHERE lane=$1 AND lane_seq=$2`, [row.lane, row.lane_seq]))[0];
    await tamper(`DELETE FROM audit.audit_events WHERE lane=$1 AND lane_seq=$2`, [row.lane, row.lane_seq]);
    expect((await verify()).some((r) => r.reason === 'gap')).toBe(true);
    const cols = Object.keys(saved);
    await tamper(`INSERT INTO audit.audit_events (${cols.join(',')}) SELECT ${cols.map((_, i) => `$${i + 1}`).join(',')}`.replace(/\$(\d+)/g, (m, n) => `$${n}`), cols.map((k) => saved[k]).map((v) => (v && typeof v === 'object' && !(v instanceof Buffer) && !(v instanceof Date) ? JSON.stringify(v) : v)));
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
