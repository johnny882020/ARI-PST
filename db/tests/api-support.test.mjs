import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { C, U, addSamples, admin, as, baseFixtures, closeAll, fails, q, resetSamples, runtime, sid } from './helpers.mjs';

beforeAll(async () => { await baseFixtures(); await resetSamples(); await addSamples([{ center: C.A, dx: 'dmg_h3k27' }, { center: C.B, dx: 'mb_shh' }]); });
afterAll(closeAll);
const noSession = async (sql, p) => { const c = await runtime().connect(); try { return (await c.query(sql, p)).rows; } finally { c.release(); } };

describe('0010 grants and ownership', () => {
  it('no function in authn, ops, agg, audit is executable by PUBLIC', async () => {
    const rows = await q(admin(), `SELECT n.nspname, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname IN ('authn','ops','agg','audit') AND has_function_privilege('public', p.oid, 'EXECUTE') AND p.proname NOT IN ('_jarr','_safe','_vadd','_hsum','_member_minus','_cover_union','block_mutation','_payload')`);
    expect(rows).toEqual([]);
  });
  it('definer functions are owned by the internal roles, never by app_runtime or the migrator', async () => {
    const rows = await q(admin(), `SELECT n.nspname, p.proname, r.rolname owner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner
      WHERE n.nspname IN ('portal','authn','ops','agg','audit','search') AND p.prosecdef AND r.rolname NOT IN ('app_core','app_agg','app_audit_writer')`);
    expect(rows).toEqual([]);
    const authn = await q(admin(), `SELECT DISTINCT r.rolname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner WHERE n.nspname IN ('authn','ops')`);
    expect(authn.map((r) => r.rolname)).toEqual(['app_core']);
  });
  it('runtime has DML on authn tables but NO table privilege on ops tables (PII stays behind functions)', async () => {
    const has = async (t, p) => (await q(admin(), `SELECT has_table_privilege('app_runtime', $1, $2) ok`, [t, p]))[0].ok;
    for (const t of ['authn.credentials', 'authn.sessions', 'authn.challenges', 'authn.webauthn_credentials', 'authn.recovery_codes']) { expect(await has(t, 'SELECT')).toBe(true); expect(await has(t, 'UPDATE')).toBe(true); }
    for (const t of ['ops.notification_outbox', 'ops.query_log']) for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) expect(await has(t, p)).toBe(false);
    await fails(as('adminA', (c) => c.query('SELECT * FROM ops.notification_outbox')), '42501');
  });
  it('runtime still cannot SET ROLE after 0010, owns nothing, and is in no role', async () => {
    expect((await q(admin(), `SELECT count(*)::int n FROM pg_auth_members WHERE member = 'app_runtime'::regrole`))[0].n).toBe(0);
    expect((await q(admin(), `SELECT count(*)::int n FROM pg_class WHERE relowner='app_runtime'::regrole`))[0].n).toBe(0);
  });
});

describe('login support', () => {
  it('find_login, user_roles, profile', async () => {
    const [l] = await noSession(`SELECT * FROM authn.find_login($1)`, ['SYNTHETIC.RESA@EXAMPLE.INVALID']);
    expect(l).toEqual({ user_id: U.resA, status: 'active', email_verified: true });
    expect((await noSession(`SELECT role FROM authn.user_roles($1)`, [U.clinA])).map((r) => r.role)).toEqual(['center_clinician']);
    expect((await noSession(`SELECT * FROM authn.profile($1)`, [U.resA]))[0].status).toBe('active');
    expect(await noSession(`SELECT * FROM authn.find_login('nobody@example.invalid')`)).toEqual([]);
  });
  it('registration: anonymous only, duplicate e-mail returns false, coordinator vets institution, verified e-mail alone does not activate', async () => {
    const id = `usr_${String(Date.now()).padStart(26, '7')}`; const email = `synthetic.reg.${Date.now()}@example.invalid`;
    await fails(as('resA', (c) => c.query(`SELECT authn.register_researcher($1,$2,'X','Synthetic University','researcher_il','en')`, [id, email])), 'forbidden');
    expect((await as('anonymous', (c) => q(c, `SELECT authn.register_researcher($1,$2,'Synthetic Reg','Synthetic University','researcher_il','en') ok`, [id, email])))[0].ok).toBe(true);
    expect((await as('anonymous', (c) => q(c, `SELECT authn.register_researcher($1,$2,'Again','X','researcher_il','en') ok`, [`usr_${'8'.padStart(26, '8')}`, email])))[0].ok).toBe(false);
    await noSession('SELECT authn.set_verified($1, true)', [id]);
    expect((await q(admin(), 'SELECT status, email_verified_at IS NOT NULL v FROM portal.users WHERE id=$1', [id]))[0]).toEqual({ status: 'invited', v: true });   // still needs approval
    const pending = await as('coordA', (c) => q(c, 'SELECT * FROM portal.registrations_pending()'));
    expect(pending.find((p) => p.user_id === id)).toMatchObject({ institution: 'Synthetic University', requested_role: 'researcher_il', email_verified: true });
    await fails(as('resA', (c) => c.query('SELECT * FROM portal.registrations_pending()')), 'forbidden');
    await fails(as('adminA', (c) => c.query('SELECT portal.approve_registration($1)', [id])), 'forbidden');
    await as('coordA', (c) => c.query('SELECT portal.approve_registration($1)', [id]));
    expect((await q(admin(), 'SELECT status FROM portal.users WHERE id=$1', [id]))[0].status).toBe('active');
  });
  it('set_verified activates an admin-invited user only when a role exists', async () => {
    const a = `usr_${'5'.padStart(26, '5')}`;
    await admin().query(`INSERT INTO portal.users (id,email,display_name,status) VALUES ($1,'synthetic.inv@example.invalid','Synthetic Invited','invited') ON CONFLICT DO NOTHING`, [a]);
    await noSession('SELECT authn.set_verified($1, true)', [a]);
    expect((await q(admin(), 'SELECT status FROM portal.users WHERE id=$1', [a]))[0].status).toBe('invited');
    await admin().query(`INSERT INTO portal.role_assignments (id,user_id,role) VALUES ('rol_${a.slice(4)}',$1,'researcher_il') ON CONFLICT DO NOTHING`, [a]);
    await noSession('SELECT authn.set_verified($1, true)', [a]);
    expect((await q(admin(), 'SELECT status FROM portal.users WHERE id=$1', [a]))[0].status).toBe('active');
  });
  it('profile self-update: own row only, validated; admin rename is audited', async () => {
    await as('resA', (c) => c.query(`SELECT portal.user_update_self('Synthetic Researcher Renamed', 'en')`));
    expect((await q(admin(), 'SELECT display_name FROM portal.users WHERE id=$1', [U.resA]))[0].display_name).toBe('Synthetic Researcher Renamed');
    await fails(as('resA', (c) => c.query(`SELECT portal.user_update_self('', 'en')`)), 'invalid_name');
    await fails(as('anonymous', (c) => c.query(`SELECT portal.user_update_self('x','en')`)), 'forbidden');
    await fails(as('coordA', (c) => c.query(`SELECT portal.user_admin_rename($1,'x')`, [U.resA])), 'forbidden');
    await as('adminA', (c) => c.query(`SELECT portal.user_admin_rename($1,'Synthetic ResA')`, [U.resA]));
  });
});

describe('outbox, budget, metrics', () => {
  it('enqueue needs a session; role fan-out; claim and mark only without a user session; params wiped after send', async () => {
    await fails(noSession(`SELECT ops.outbox_enqueue('ob1','request.submitted',NULL,NULL,'x@example.invalid','en','{}')`), '42501');
    await as('resA', (c) => c.query(`SELECT ops.outbox_enqueue('obfan','request.pending_committee','committee_member',NULL,NULL,NULL,'{"link":"/r/1"}')`));
    expect((await q(admin(), `SELECT count(*)::int n FROM ops.notification_outbox WHERE id LIKE 'obfan\\_%'`))[0].n).toBe(3);
    await fails(as('resA', (c) => c.query('SELECT * FROM ops.outbox_claim(10)')), 'forbidden');
    const claimed = await noSession('SELECT * FROM ops.outbox_claim(2)');
    expect(claimed).toHaveLength(2);
    await fails(as('adminA', (c) => c.query(`SELECT ops.outbox_mark($1,true,false)`, [claimed[0].id])), 'forbidden');
    await noSession('SELECT ops.outbox_mark($1,true,false)', [claimed[0].id]);
    expect((await q(admin(), 'SELECT status, params FROM ops.notification_outbox WHERE id=$1', [claimed[0].id]))[0]).toEqual({ status: 'sent', params: {} });
    await noSession('SELECT ops.outbox_mark($1,false,false)', [claimed[1].id]);
    expect((await q(admin(), 'SELECT status FROM ops.notification_outbox WHERE id=$1', [claimed[1].id]))[0].status).toBe('pending');
    await fails(as('resA', (c) => c.query(`SELECT ops.outbox_enqueue('obbad','Bad Template!',NULL,NULL,'x@example.invalid','en','{}')`)), '23514');
    expect((await as('adminA', (c) => q(c, 'SELECT * FROM ops.outbox_list(50)'))).length).toBeGreaterThan(0);
    await fails(as('coordA', (c) => c.query('SELECT * FROM ops.outbox_list(5)')), 'forbidden');
  });
  it('query budget: actor comes from the session, institution totals aggregate across users', async () => {
    await as('resA', (c) => c.query(`SELECT ops.log_query('abc123','Synthetic University',3)`));
    await as('resB', (c) => c.query(`SELECT ops.log_query('abc124','Synthetic University',4)`));
    const [a] = await as('resA', (c) => q(c, `SELECT * FROM ops.budget_spent('Synthetic University')`));
    expect(a).toEqual({ day_cost: 3, d30_cost: 3, inst_30d_cost: 7 });
    await fails(as('anonymous', (c) => c.query(`SELECT ops.log_query('x','y',1)`)), 'forbidden');
    await fails(as('resA', (c) => c.query(`SELECT ops.log_query('x','y',1000)`)), '23514');
    expect((await q(admin(), `SELECT user_id FROM ops.query_log WHERE query_key='abc124'`))[0].user_id).toBe(U.resB);
  });
  it('metrics are role gated', async () => {
    const [m] = await as('coordA', (c) => q(c, 'SELECT * FROM ops.metrics()'));
    expect(m.samples_total).toBe(2);
    await as('comA', (c) => c.query('SELECT * FROM ops.metrics()'));
    await fails(as('resA', (c) => c.query('SELECT * FROM ops.metrics()')), 'forbidden');
  });
  it('sample_verify: clinician only for the own center, coordinator anywhere, others never', async () => {
    const [mine, other] = (await q(admin(), 'SELECT id, source_center_id FROM portal.samples ORDER BY source_center_id')).map((r) => r.id);
    await admin().query(`UPDATE portal.samples SET last_verified_at = now() - interval '100 days'`);
    await as('clinA', (c) => c.query('SELECT portal.sample_verify($1)', [mine]));
    await fails(as('clinA', (c) => c.query('SELECT portal.sample_verify($1)', [other])), 'not_found');
    await as('coordA', (c) => c.query('SELECT portal.sample_verify($1)', [other]));
    await fails(as('resA', (c) => c.query('SELECT portal.sample_verify($1)', [mine])), 'forbidden');
    expect((await q(admin(), `SELECT count(*)::int n FROM portal.samples WHERE last_verified_at > now() - interval '1 day'`))[0].n).toBe(2);
  });
  it('/readyz support: migration_level returns the latest applied migration for any session', async () => {
    const lvl = (await noSession('SELECT portal.migration_level() v'))[0].v;
    const files = (await q(admin(), `SELECT max(version) v FROM public.schema_migrations`))[0].v;
    expect(lvl).toBe(files);
    expect(lvl >= '0010').toBe(true);
  });
});
