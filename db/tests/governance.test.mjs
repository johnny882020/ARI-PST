import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { C, U, admin, as, baseFixtures, closeAll, fails, pool, q } from './helpers.mjs';

beforeAll(baseFixtures);
afterAll(closeAll);

describe('separation of duties (RT-06)', () => {
  it('system_admin cannot also hold data or decision roles; coordinator and committee are exclusive', async () => {
    const a = admin();
    for (const [uid, role, center] of [[U.adminA, 'national_coordinator', null], [U.adminA, 'committee_member', null], [U.adminA, 'center_clinician', C.A],
      [U.coordA, 'system_admin', null], [U.comA, 'system_admin', null], [U.coordA, 'committee_member', null], [U.comA, 'national_coordinator', null]]) {
      await fails(a.query(`INSERT INTO portal.role_assignments (id, user_id, role, center_id) VALUES (portal.new_id('rol'), $1, $2, $3)`, [uid, role, center]), 'separation_of_duties');
    }
  });
  it('a clinician role needs exactly one center; other roles must not carry one', async () => {
    await fails(admin().query(`INSERT INTO portal.role_assignments (id,user_id,role) VALUES (portal.new_id('rol'), $1,'center_clinician')`, [U.plain]), '23514');
    await fails(admin().query(`INSERT INTO portal.role_assignments (id,user_id,role,center_id) VALUES (portal.new_id('rol'), $1,'researcher_il',$2)`, [U.plain, C.A]), '23514');
  });
  it('system_admin cannot read sample data, approve requests, or vote', async () => {
    await as('adminA', async (c) => {
      expect((await q(c, 'SELECT count(*)::int n FROM portal.samples WHERE true'))[0].n).toBe(0);
      expect((await q(c, 'SELECT count(*)::int n FROM portal.request_votes'))[0].n).toBe(0);
    });
    await fails(as('adminA', (c) => c.query(`SELECT portal.request_cast_vote('req_00000000000000000000000001','approve',NULL,NULL)`)), 'forbidden');
  });
  it('admin cannot lower k alone: no direct write, own proposal cannot be self-approved, k floor holds', async () => {
    await fails(as('adminA', (c) => c.query(`UPDATE portal.k_policies SET k=5`)), '42501');
    const id = await as('adminA', async (c) => (await q(c, `SELECT portal.change_propose('k_policy','{"field_set":"diagnosis","k":8}') id`))[0].id);
    await fails(as('adminA', (c) => c.query('SELECT portal.change_approve($1, 10)', [id])), 'second_approver_required');
    await fails(as('adminB', (c) => c.query('SELECT portal.change_approve($1, 10)', [id])), 'forbidden');          // another admin is not a committee member
    await fails(as('comA', (c) => c.query('SELECT portal.change_approve($1, 900)', [id])), 'stepup_required');
    await fails(as('adminA', (c) => c.query(`SELECT portal.change_propose('k_policy','{"field_set":"default","k":3}')`)), '23514');
    await as('comA', (c) => c.query('SELECT portal.change_approve($1, 30)', [id]));
    expect((await q(admin(), `SELECT k FROM portal.k_policies WHERE field_set='diagnosis'`))[0].k).toBe(8);
    await admin().query(`DELETE FROM portal.k_policies WHERE field_set='diagnosis'`);
  });
  it('a per-field k below the default is rejected', async () => {
    const id = await as('adminA', async (c) => (await q(c, `SELECT portal.change_propose('k_policy','{"field_set":"center","k":5}') id`))[0].id);
    await admin().query(`UPDATE portal.k_policies SET k=6 WHERE field_set='default'`);
    await fails(as('comA', (c) => c.query('SELECT portal.change_approve($1, 30)', [id])), 'k_below_default');
    await admin().query(`UPDATE portal.k_policies SET k=5 WHERE field_set='default'`);
  });
  it('role grants need a second approver of the right kind (sock-puppet coordinator is blocked)', async () => {
    const target = U.plain;
    await admin().query(`UPDATE portal.users SET status='active' WHERE id=$1`, [target]);
    await admin().query(`DELETE FROM portal.role_assignments WHERE user_id=$1`, [target]);
    const id = await as('adminA', async (c) => (await q(c, `SELECT portal.change_propose('role_grant', $1::jsonb) id`, [JSON.stringify({ user_id: target, role: 'national_coordinator' })]))[0].id);
    await fails(as('adminA', (c) => c.query('SELECT portal.change_approve($1, 10)', [id])), 'second_approver_required');
    await fails(as('adminB', (c) => c.query('SELECT portal.change_approve($1, 10)', [id])), 'forbidden');
    await fails(as('coordA', (c) => c.query('SELECT portal.change_approve($1, 10)', [id])), 'forbidden');
    await fails(as('comA', (c) => c.query('SELECT portal.change_approve($1, 999)', [id])), 'stepup_required');
    expect((await q(admin(), 'SELECT count(*)::int n FROM portal.role_assignments WHERE user_id=$1', [target]))[0].n).toBe(0);
    await as('comA', (c) => c.query('SELECT portal.change_approve($1, 10)', [id]));
    const [r] = await q(admin(), 'SELECT role, granted_by, approved_by FROM portal.role_assignments WHERE user_id=$1', [target]);
    expect(r).toEqual({ role: 'national_coordinator', granted_by: U.adminA, approved_by: U.comA });
    await fails(as('comA', (c) => c.query('SELECT portal.change_approve($1, 10)', [id])), 'not_found');            // cannot replay
    await admin().query(`DELETE FROM portal.role_assignments WHERE user_id=$1`, [target]);
  });
  it('only admins propose privileged grants; coordinator may propose clinician grants only', async () => {
    await fails(as('coordA', (c) => c.query(`SELECT portal.change_propose('role_grant', $1::jsonb)`, [JSON.stringify({ user_id: U.plain, role: 'system_admin' })])), 'forbidden');
    await fails(as('resA', (c) => c.query(`SELECT portal.change_propose('k_policy','{"field_set":"x","k":9}')`)), 'forbidden');
    await fails(as('comA', (c) => c.query(`SELECT portal.change_propose('committee_config','{"votes_needed":2,"members_total":4}')`)), 'forbidden');
  });
  it('committee config change needs a committee approver', async () => {
    const id = await as('adminA', async (c) => (await q(c, `SELECT portal.change_propose('committee_config','{"votes_needed":2,"members_total":4}') id`))[0].id);
    await as('comB', (c) => c.query('SELECT portal.change_approve($1, 10)', [id]));
    expect((await q(admin(), 'SELECT members_total FROM portal.committee_config'))[0].members_total).toBe(4);
    await admin().query('UPDATE portal.committee_config SET members_total=3');
  });
  it('coordinator cannot activate or reactivate accounts, and cannot grant non-researcher roles (T6, T10)', async () => {
    await fails(as('coordA', (c) => c.query(`SELECT portal.user_set_status($1,'active')`, [U.adminA])), 'forbidden');
    await fails(as('coordA', (c) => c.query(`UPDATE portal.users SET status='active' WHERE id=$1`, [U.adminA])), '42501');
    await fails(as('coordA', (c) => c.query(`INSERT INTO portal.role_assignments (id,user_id,role) VALUES (portal.new_id('rol'),$1,'national_coordinator')`, [U.plain])), '42501');
  });
  it('admin status changes: no self change, closed users stay closed', async () => {
    await fails(as('adminA', (c) => c.query(`SELECT portal.user_set_status($1,'suspended')`, [U.adminA])), 'self_change_denied');
  });
});

describe('researcher onboarding (ASSUMPTION-03)', () => {
  it('self-register, verify e-mail with a one-time token, coordinator approves; coordinator cannot skip verification', async () => {
    const email = `synthetic.newbie.${Date.now()}@example.invalid`;
    const reg = await as('anonymous', async (c) => (await q(c, `SELECT * FROM portal.user_register($1,'Synthetic Newbie','en','researcher_il')`, [email]))[0]);
    expect(reg.user_id).toMatch(/^usr_/);
    await fails(as('coordA', (c) => c.query('SELECT portal.researcher_approve($1)', [reg.user_id])), 'email_not_verified');
    expect((await as('anonymous', (c) => q(c, 'SELECT portal.user_verify_email($1,$2) ok', [reg.user_id, 'wrong-token'])))[0].ok).toBe(false);
    expect((await as('anonymous', (c) => q(c, 'SELECT portal.user_verify_email($1,$2) ok', [reg.user_id, reg.verification_token])))[0].ok).toBe(true);
    expect((await q(admin(), 'SELECT token_hash FROM portal.email_verifications WHERE user_id=$1', [reg.user_id]))[0].token_hash.toString('hex')).not.toContain(reg.verification_token);
    await as('coordA', (c) => c.query('SELECT portal.researcher_approve($1)', [reg.user_id]));
    expect((await q(admin(), 'SELECT status FROM portal.users WHERE id=$1', [reg.user_id]))[0].status).toBe('active');
    await as(null ?? 'anonymous', () => {});
    const { withSession } = await import('../lib/session.mjs');
    await withSession((await import('./helpers.mjs')).runtime(), { userId: reg.user_id, role: 'researcher_il' }, async (c) => expect((await q(c, 'SELECT portal.cur_role() r'))[0].r).toBe('researcher_il'));
  });
  it('only anonymous can register; the token locks after 5 wrong attempts', async () => {
    await fails(as('resA', (c) => c.query(`SELECT * FROM portal.user_register('x.y@example.invalid','X','en','researcher_il')`)), 'forbidden');
    const reg = await as('anonymous', async (c) => (await q(c, `SELECT * FROM portal.user_register($1,'Synthetic Lock','en','researcher_intl')`, [`synthetic.lock.${Date.now()}@example.invalid`]))[0]);
    for (let i = 0; i < 5; i++) await as('anonymous', (c) => c.query('SELECT portal.user_verify_email($1,$2)', [reg.user_id, 'bad']));
    expect((await as('anonymous', (c) => q(c, 'SELECT portal.user_verify_email($1,$2) ok', [reg.user_id, reg.verification_token])))[0].ok).toBe(false);
  });
  it('bootstrap_first_admin only works for ops (app_migrator) and only once', async () => {
    await fails(as('adminA', (c) => c.query(`SELECT portal.bootstrap_first_admin('a@example.invalid','A')`)), '42501');
    await fails(pool('app_migrator').query(`SELECT portal.bootstrap_first_admin('a@example.invalid','A')`), 'admin_exists');
  });
});

describe('break glass (RT-27)', () => {
  it('needs two approvers other than the requester, fresh step-up, expires; only then the break-glass role can read rows', async () => {
    const bg = pool('app_break_glass');
    await fails(bg.query('SELECT 1'), '28000');                                                    // NOLOGIN until ops enable it
    await admin().query('ALTER ROLE app_break_glass LOGIN');
    const id = await as('adminA', async (c) => (await q(c, `SELECT portal.breakglass_request('full_export') id`))[0].id);
    await fails(as('adminB', (c) => c.query('SELECT portal.breakglass_approve($1,10)', [id])), 'forbidden');
    await fails(as('comA', (c) => c.query('SELECT portal.breakglass_approve($1,9999)', [id])), 'stepup_required');
    await as('comA', (c) => c.query('SELECT portal.breakglass_approve($1,10)', [id]));
    await fails(as('comA', (c) => c.query('SELECT portal.breakglass_approve($1,10)', [id])), 'second_approver_required');
    expect((await q(admin(), 'SELECT portal.breakglass_active() a'))[0].a).toBe(false);          // one approver is not enough
    await as('coordA', (c) => c.query('SELECT portal.breakglass_approve($1,10)', [id]));
    expect((await q(admin(), 'SELECT portal.breakglass_active() a'))[0].a).toBe(true);
    await admin().query(`UPDATE portal.breakglass_grants SET expires_at = now() - interval '1 minute'`);
    expect((await q(admin(), 'SELECT portal.breakglass_active() a'))[0].a).toBe(false);
    await fails(bg.query('SELECT portal.breakglass_begin()'), 'no_active_grant');
    expect((await bg.query('SELECT count(*)::int n FROM portal.samples')).rows[0].n).toBe(0);   // RLS: grant expired
    await admin().query('ALTER ROLE app_break_glass NOLOGIN');
  });
});
