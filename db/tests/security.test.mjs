import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { C, U, addSamples, admin, as, baseFixtures, closeAll, fails, pool, q, resetSamples, runtime, sid } from './helpers.mjs';
import { withSession } from '../lib/session.mjs';

beforeAll(async () => {
  await baseFixtures();
  await resetSamples();
  await addSamples([{ center: C.A, dx: 'dmg_h3k27' }, { center: C.A, dx: 'dmg_h3k27' }, { center: C.B, dx: 'mb_shh' }]);
});
afterAll(closeAll);

describe('role model (C-06): no SET ROLE, signed context', () => {
  it('app_runtime cannot SET ROLE to any internal or other role', async () => {
    for (const r of ['app_core', 'app_agg', 'app_audit_writer', 'app_migrator', 'app_break_glass', 'app_readonly_bg', 'postgres']) {
      const c = await runtime().connect();
      try { await fails(c.query(`SET ROLE ${r}`), '42501'); } finally { c.release(); }
    }
  });
  it('app_runtime is not superuser, not BYPASSRLS, not owner of any object', async () => {
    const [r] = await q(admin(), `SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname='app_runtime'`);
    expect(r).toEqual({ rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false });
    const owned = await q(admin(), `SELECT count(*)::int n FROM pg_class c WHERE relowner = 'app_runtime'::regrole`);
    expect(owned[0].n).toBe(0);
  });
  it('a forged session context fails closed (cannot read other centers by setting GUCs)', async () => {
    const c = await runtime().connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.ctx', 'usr_x|center_clinician|${C.B}|deadbeef', true)`);
      await c.query(`SELECT set_config('app.center_id', '${C.B}', true)`);
      expect((await q(c, 'SELECT count(*)::int n FROM portal.samples'))[0].n).toBe(0);
      expect((await q(c, 'SELECT portal.cur_role() r'))[0].r).toBeNull();
      await c.query('ROLLBACK');
    } finally { c.release(); }
  });
  it('begin_session derives the center from role assignments and rejects unassigned roles', async () => {
    await as('clinA', async (c) => expect((await q(c, 'SELECT portal.cur_center_id() c'))[0].c).toBe(C.A));
    await fails(as('clinA', () => {}).then(() => withSession(runtime(), { userId: U.clinA, role: 'national_coordinator' }, () => {})), 'session_denied');
    await fails(withSession(runtime(), { userId: U.plain, role: 'researcher_il' }, () => {}), 'session_denied');
  });
  it('a session cannot be switched inside one transaction', async () => {
    await fails(as('resA', (c) => c.query(`SELECT portal.begin_session('${U.coordA}', 'national_coordinator')`)), 'session_already_started');
  });
  it('suspended users cannot start a session', async () => {
    await admin().query(`UPDATE portal.users SET status='suspended' WHERE id=$1`, [U.plain]);
    await admin().query(`INSERT INTO portal.role_assignments (id,user_id,role) VALUES ('rol_${U.plain.slice(4)}',$1,'researcher_il') ON CONFLICT DO NOTHING`, [U.plain]);
    await fails(withSession(runtime(), { userId: U.plain, role: 'researcher_il' }, () => {}), 'session_denied');
  });
});

describe('samples: external roles have NO access, staff are scoped', () => {
  it.each(['resA', 'intl', 'anonymous', 'comA', 'adminA'])('%s sees zero sample rows and cannot write', async (who) => {
    await as(who, async (c) => {
      expect((await q(c, 'SELECT count(*)::int n FROM portal.samples'))[0].n).toBe(0);
      expect((await q(c, 'SELECT count(*)::int n FROM portal.sample_attached_data'))[0].n).toBe(0);
    });
    await fails(as(who, (c) => c.query(`INSERT INTO portal.samples (id, source_center_id, diagnosis_code, age_band_at_diagnosis, sex, sample_type,
       availability, clinical_timepoint, collection_month, contact_ref) VALUES ('${sid(1)}','${C.A}','dmg_h3k27','3_lt6','female','ffpe','available','diagnosis','2024-05','x')`)), '42501');
  });
  it('no context at all returns zero rows', async () => {
    const c = await runtime().connect();
    try { expect((await q(c, 'SELECT count(*)::int n FROM portal.samples'))[0].n).toBe(0); } finally { c.release(); }
  });
  it('clinician sees only the own center; coordinator sees all', async () => {
    await as('clinA', async (c) => {
      const rows = await q(c, 'SELECT source_center_id FROM portal.v_samples');
      expect(rows.length).toBe(2);
      expect(new Set(rows.map((r) => r.source_center_id))).toEqual(new Set([C.A]));
    });
    await as('clinB', async (c) => expect((await q(c, 'SELECT count(*)::int n FROM portal.v_samples'))[0].n).toBe(1));
    await as('coordA', async (c) => expect((await q(c, 'SELECT count(*)::int n FROM portal.v_samples'))[0].n).toBe(3));
  });
  it('clinician cannot write samples; coordinator can', async () => {
    await fails(as('clinA', (c) => c.query(`UPDATE portal.samples SET availability='limited'`)).then((r) => { if (r.rowCount === 0) throw new Error('denied'); }), 'denied');
    await as('coordA', async (c) => {
      const r = await c.query(`UPDATE portal.samples SET last_verified_at = now() WHERE id = '${sid(1001)}'`);
      expect(r.rowCount).toBe(1);
    });
  });
  it('donor_ref cannot be read by any runtime context (column grant)', async () => {
    await fails(as('coordA', (c) => c.query('SELECT donor_ref FROM portal.samples')), '42501');
    await fails(as('coordA', (c) => c.query('SELECT * FROM portal.samples')), '42501');
  });
  it('the table owner (migrator) cannot read samples: FORCE RLS has no owner policy', async () => {
    const r = await q(pool('app_migrator'), 'SELECT count(*)::int n FROM portal.samples');
    expect(r[0].n).toBe(0);
  });
  it('RT-05: attached_data sync trigger works under FORCE RLS for a coordinator', async () => {
    await as('coordA', async (c) => {
      await c.query(`INSERT INTO portal.samples (id, source_center_id, diagnosis_code, age_band_at_diagnosis, sex, sample_type, availability, clinical_timepoint, collection_month, contact_ref)
        VALUES ('${sid(1)}','${C.A}','dmg_h3k27','3_lt6','female','ffpe','available','diagnosis','2024-05','x')`);
      await c.query(`INSERT INTO portal.sample_attached_data (sample_id, data_type) VALUES ('${sid(1)}','wes'),('${sid(1)}','mri')`);
      const [r] = await q(c, `SELECT attached_data FROM portal.v_samples WHERE id='${sid(1)}'`);
      expect(r.attached_data).toEqual(['wes', 'mri']);
      await c.query(`UPDATE portal.sample_attached_data SET is_available=false WHERE sample_id='${sid(1)}' AND data_type='mri'`);
      expect((await q(c, `SELECT attached_data FROM portal.v_samples WHERE id='${sid(1)}'`))[0].attached_data).toEqual(['wes']);
    });
  });
  it('donor consistency: samples of one donor must agree on diagnosis, sex, age and center', async () => {
    await as('coordA', async (c) => {
      const donor = (await q(c, `SELECT portal.sample_donor_ref('${sid(1)}') d`))[0].d;
      await c.query(`INSERT INTO portal.samples (id, donor_ref, source_center_id, diagnosis_code, age_band_at_diagnosis, sex, sample_type, availability, clinical_timepoint, collection_month, contact_ref)
        VALUES ('${sid(2)}','${donor}','${C.A}','dmg_h3k27','3_lt6','female','frozen','available','diagnosis','2024-05','x')`);
    });
    await fails(as('coordA', async (c) => {
      const donor = (await q(c, `SELECT portal.sample_donor_ref('${sid(1)}') d`))[0].d;
      await c.query(`INSERT INTO portal.samples (id, donor_ref, source_center_id, diagnosis_code, age_band_at_diagnosis, sex, sample_type, availability, clinical_timepoint, collection_month, contact_ref)
        VALUES ('${sid(3)}','${donor}','${C.A}','mb_shh','3_lt6','female','frozen','available','diagnosis','2024-05','x')`);
    }), 'donor_inconsistent');
    await as('coordA', async (c) => expect((await q(c, `SELECT portal.donor_correct('${sid(1)}','mb_shh',NULL,NULL) n`))[0].n).toBe(2));
  });
  it('ethics approval must belong to the sample center', async () => {
    await admin().query(`INSERT INTO portal.ethics_approvals (id, center_id, approval_ref) VALUES ('eth_${'1'.padStart(26, '0')}', $1, 'SYNTH-ETH-B-001') ON CONFLICT DO NOTHING`, [C.B]);
    await fails(as('coordA', (c) => c.query(`UPDATE portal.samples SET ethics_approval_id='eth_${'1'.padStart(26, '0')}' WHERE id='${sid(1001)}'`)), 'ethics_center_mismatch');
  });
});

describe('users, roles, reference data and audit are not writable directly', () => {
  it('runtime has no direct DML on users, role_assignments, k_policies, committee_config, audit', async () => {
    for (const who of ['adminA', 'coordA', 'resA']) {
      await fails(as(who, (c) => c.query(`UPDATE portal.users SET status='active'`)), '42501');
      await fails(as(who, (c) => c.query(`INSERT INTO portal.role_assignments (id,user_id,role) VALUES ('rol_${'9'.padStart(26, '0')}','${U.resA}','system_admin')`)), '42501');
      await fails(as(who, (c) => c.query(`UPDATE portal.k_policies SET k=2`)), '42501');
      await fails(as(who, (c) => c.query(`UPDATE portal.committee_config SET votes_needed=2`)), '42501');
      await fails(as(who, (c) => c.query('SELECT 1 FROM audit.audit_events')), '42501');
      await fails(as(who, (c) => c.query('SELECT portal.begin_session($1, $2)', [U.resA, 'researcher_il'])), 'session_already_started');
    }
  });
  it('k_policies and committee_config are not visible to external roles (RT-28)', async () => {
    await as('resA', async (c) => expect((await q(c, 'SELECT count(*)::int n FROM portal.k_policies'))[0].n).toBe(0));
    await as('adminA', async (c) => expect((await q(c, 'SELECT count(*)::int n FROM portal.k_policies'))[0].n).toBeGreaterThan(0));
  });
  it('users: self only for researchers; staff roles see all; others see nobody else', async () => {
    await as('resA', async (c) => expect((await q(c, 'SELECT id FROM portal.users')).map((r) => r.id)).toEqual([U.resA]));
    await as('coordA', async (c) => expect((await q(c, 'SELECT count(*)::int n FROM portal.users'))[0].n).toBeGreaterThan(5));
  });
  it('anonymous cannot call staff functions', async () => {
    await fails(as('anonymous', (c) => c.query(`SELECT portal.user_invite('x@example.invalid','X')`)), 'forbidden');
    await fails(as('anonymous', (c) => c.query('SELECT * FROM agg.total_count($1)', ['{}'])), 'forbidden');
  });
  it('k floor: CHECK k >= 5 holds even for a superuser', async () => {
    await fails(admin().query(`UPDATE portal.k_policies SET k=4 WHERE field_set='default'`), '23514');
    await fails(admin().query(`INSERT INTO portal.k_policies (field_set,k) VALUES ('diagnosis', 3)`), '23514');
  });
  it('definer-owned objects: runtime cannot execute internal functions', async () => {
    for (const f of ['audit.record_internal(NULL,NULL,NULL,\'x.y\',NULL,NULL,\'allow\',NULL,\'{}\')', 'audit.purge_before(now())', 'portal._ctx_sig(\'x\')', `portal._transition('req_x','closed','system')`]) {
      await fails(as('adminA', (c) => c.query(`SELECT ${f}`)), '42501');
    }
  });
});
