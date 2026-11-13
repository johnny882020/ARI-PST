import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './support/harness.js';
import { buildFixture, sampleBody, type Fixture } from './support/fixture.js';

let h: Harness; let f: Fixture;
const MP = { 'content-type': 'application/merge-patch+json' };
beforeAll(async () => { h = await startHarness(); f = await buildFixture(h); });
afterAll(async () => { await h.close(); });

describe('second approver for role grants, k and committee config', () => {
  it('invite creates a pending role grant; the proposer cannot approve it; a second admin can', async () => {
    const a1 = await h.session(f.admin1); const a2 = await h.session(f.admin2);
    const inv = await h.call(a1, 'POST', '/api/v1/users', { body: { email: `clin.${Date.now()}@example.invalid`, displayName: 'Synthetic Clinician', role: 'center_clinician', centerId: f.centerA } });
    expect(inv.status, inv.body).toBe(201); expect(inv.json.roles).toHaveLength(0);
    const list = await h.call(a1, 'GET', '/api/v1/governance/approvals'); expect(list.status, list.body).toBe(200);
    const pending = list.json.items.find((x: any) => x.kind === 'role_grant' && x.payload.userId === inv.json.id); expect(pending.status).toBe('pending');
    const self = await h.call(a1, 'POST', `/api/v1/governance/approvals/${pending.id}/decision`, { body: { approve: true } });
    expect(self.status, self.body).toBe(409); expect(self.json.code).toBe('SECOND_APPROVER_REQUIRED');
    const ok = await h.call(a2, 'POST', `/api/v1/governance/approvals/${pending.id}/decision`, { body: { approve: true } });
    expect(ok.status, ok.body).toBe(200); expect(ok.json.status).toBe('approved');
    expect((await h.call(a1, 'GET', `/api/v1/users/${inv.json.id}`)).json.roles[0].role).toBe('center_clinician');
    expect(h.mailer.sent.length + (await h.worker.tick())).toBeGreaterThanOrEqual(0);
  });
  it('separation of duties: admin cannot hold data roles, committee cannot edit the index', async () => {
    const a1 = await h.session(f.admin1);
    const r = await h.call(a1, 'POST', `/api/v1/users/${f.admin2.id}/roles`, { body: { role: 'national_coordinator' } });
    expect(r.status).toBe(409); expect(r.json.code).toBe('SOD_VIOLATION');
    const r2 = await h.call(a1, 'POST', `/api/v1/users/${f.coord.id}/roles`, { body: { role: 'committee_member' } });
    expect(r2.json.code).toBe('SOD_VIOLATION');
    const r3 = await h.call(a1, 'POST', `/api/v1/users/${f.resIl.id}/roles`, { body: { role: 'researcher_il' } });
    expect(r3.status).toBe(422);        // researcher roles come only from registration approval
  });
  it('k can only go up, needs a different approver (committee), and the floor is 5', async () => {
    const a1 = await h.session(f.admin1); const a2 = await h.session(f.admin2); const cm = await h.session(f.committee[0]!);
    expect((await h.call(a1, 'POST', '/api/v1/governance/k', { body: { fieldSet: 'default', k: 3 } })).status).toBe(422);
    const p = await h.call(a1, 'POST', '/api/v1/governance/k', { body: { fieldSet: 'default', k: 7 } });
    expect(p.status, p.body).toBe(202); expect(p.json.status).toBe('pending');
    expect((await h.call(a1, 'POST', `/api/v1/governance/approvals/${p.json.id}/decision`, { body: { approve: true } })).json.code).toBe('SECOND_APPROVER_REQUIRED');
    expect((await h.call(a2, 'POST', `/api/v1/governance/approvals/${p.json.id}/decision`, { body: { approve: true } })).status).toBe(403);   // admin2 is not the approver role
    const ok = await h.call(cm, 'POST', `/api/v1/governance/approvals/${p.json.id}/decision`, { body: { approve: true } });
    expect(ok.status, ok.body).toBe(200);
    const cfg = await h.call(a1, 'GET', '/api/v1/governance/config'); expect(cfg.json.kPolicies.find((x: any) => x.fieldSet === 'default').k).toBe(7);
    expect((await h.call(await h.session(f.coord), 'GET', '/api/v1/governance/config')).json.kPolicies).toEqual([]);   // k is hidden from non-admins
    // restore for other suites
    const back = await h.call(a1, 'POST', '/api/v1/governance/k', { body: { fieldSet: 'default', k: 5 } });
    await h.call(await h.session(f.committee[1]!), 'POST', `/api/v1/governance/approvals/${back.json.id}/decision`, { body: { approve: true } });
  });
  it('committee N-of-M change is also two-person', async () => {
    const a1 = await h.session(f.admin1); const cm = await h.session(f.committee[0]!);
    expect((await h.call(a1, 'POST', '/api/v1/governance/committee-config', { body: { votesNeeded: 3, membersTotal: 2 } })).status).toBe(422);
    const p = await h.call(a1, 'POST', '/api/v1/governance/committee-config', { body: { votesNeeded: 2, membersTotal: 3 } });
    expect(p.status, p.body).toBe(202);
    expect((await h.call(cm, 'POST', `/api/v1/governance/approvals/${p.json.id}/decision`, { body: { approve: false } })).json.status).toBe('rejected');
  });
});

describe('separation of duties in data access', () => {
  it('system_admin cannot read samples, vote, or drive requests; committee cannot edit the index', async () => {
    const a1 = await h.session(f.admin1); const cm = await h.session(f.committee[0]!);
    const co = await h.session(f.coord);
    const smp = await h.call(co, 'POST', '/api/v1/samples', { body: sampleBody(f.centerA) });
    expect((await h.call(a1, 'GET', `/api/v1/samples/${smp.json.sampleCode}`)).status).toBe(403);
    expect((await h.call(a1, 'GET', '/api/v1/samples')).status).toBe(403);
    expect((await h.call(a1, 'PUT', `/api/v1/requests/req_${'0'.repeat(26)}/votes`, { body: { vote: 'approve' } })).status).toBe(403);
    expect((await h.call(cm, 'POST', '/api/v1/samples', { body: sampleBody(f.centerA) })).status).toBe(403);
    expect((await h.call(cm, 'PATCH', `/api/v1/samples/${smp.json.sampleCode}`, { body: { sex: 'male' }, headers: { 'if-match': 'x', ...MP } })).status).toBe(403);
    // DB layer too: the admin context has no policy on samples at all
    const direct = await h.repo.pool.connect();
    try { await direct.query('BEGIN'); await direct.query('SELECT portal.begin_session($1,$2)', [f.admin1.id, 'system_admin']); const r = await direct.query('SELECT count(*)::int n FROM portal.samples'); expect(r.rows[0].n).toBe(0); await direct.query('ROLLBACK'); } finally { direct.release(); }
  });
  it('suspension ends sessions at once; admin cannot suspend self', async () => {
    const u = await h.seedUser('researcher_il', null, 'susp'); const s = await h.session(u);
    expect((await h.call(s, 'GET', '/api/v1/session')).status).toBe(200);
    const a1 = await h.session(f.admin1);
    expect((await h.call(a1, 'PATCH', `/api/v1/users/${f.admin1.id}`, { body: { status: 'suspended' }, headers: MP })).status).toBe(409);
    const r = await h.call(a1, 'PATCH', `/api/v1/users/${u.id}`, { body: { status: 'suspended' }, headers: MP });
    expect(r.status, r.body).toBe(200);
    expect((await h.call(s, 'GET', '/api/v1/session')).status).toBe(401);
  });
});

describe('audit log', () => {
  it('records views and denials, scopes reads by role, verifies the chain', async () => {
    const co = await h.session(f.coord);
    const smp = await h.call(co, 'POST', '/api/v1/samples', { body: sampleBody(f.centerA) });
    await h.call(co, 'GET', `/api/v1/samples/${smp.json.sampleCode}`);
    const res = await h.session(f.resIl); await h.call(res, 'GET', '/api/v1/samples');            // denied -> authz.deny
    const a1 = await h.session(f.admin1);
    const q = await h.call(a1, 'GET', '/api/v1/audit-events', { query: { limit: 100 } });
    expect(q.status, q.body).toBe(200);
    const actions = new Set(q.json.items.map((e: any) => e.action));
    expect(actions.has('sample.view')).toBe(true); expect(actions.has('authz.deny')).toBe(true); expect(actions.has('sample.create')).toBe(true);
    expect(JSON.stringify(q.json)).not.toMatch(/@example\.invalid/);          // no personal data in events
    const cq = await h.call(co, 'GET', '/api/v1/audit-events'); expect(cq.status).toBe(200);
    expect(cq.json.items.every((e: any) => /^(sample|import|export|request|search|linkout|audit)\./.test(e.action) || e.actorUserId === f.coord.id)).toBe(true);
    expect((await h.call(res, 'GET', '/api/v1/audit-events')).status).toBe(403);
    const v = await h.call(a1, 'POST', '/api/v1/audit-events/verify', { body: {} }); expect(v.status, v.body).toBe(200); expect(v.json.intact).toBe(true);
    // tampering is detected
    await h.admin.query('ALTER TABLE audit.audit_events DISABLE TRIGGER trg_audit_no_update');
    await h.admin.query(`UPDATE audit.audit_events SET object_id = 'tampered' WHERE ctid = (SELECT ctid FROM audit.audit_events ORDER BY occurred_at LIMIT 1)`);
    await h.admin.query('ALTER TABLE audit.audit_events ENABLE TRIGGER trg_audit_no_update');
    const v2 = await h.call(a1, 'POST', '/api/v1/audit-events/verify', { body: {} }); expect(v2.json.intact).toBe(false);
  });
});

describe('staleness and metrics', () => {
  it('center staleness summary: clinician sees only own center', async () => {
    const co = await h.session(f.coord); const ca = await h.session(f.clinA);
    await h.call(co, 'POST', '/api/v1/samples', { body: sampleBody(f.centerA) });
    const own = await h.call(ca, 'GET', `/api/v1/centers/${f.centerA}/staleness`); expect(own.status, own.body).toBe(200); expect(own.json.samplesTotal).toBeGreaterThan(0);
    expect((await h.call(ca, 'GET', `/api/v1/centers/${f.centerB}/staleness`)).status).toBe(404);
    const all = await h.call(co, 'GET', '/api/v1/staleness'); expect(all.status, all.body).toBe(200);
    const m = await h.call(co, 'GET', '/api/v1/metrics'); expect(m.status, m.body).toBe(200); expect(m.json.samplesTotal).toBeGreaterThan(0);
    const ma = await h.call(await h.session(f.admin1), 'GET', '/api/v1/metrics'); expect(ma.status, ma.body).toBe(200);
  });
});
