import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './support/harness.js';
import { buildFixture, sampleBody, type Fixture } from './support/fixture.js';

let h: Harness; let f: Fixture; let codeA: string; let codeB: string;
beforeAll(async () => {
  h = await startHarness(); f = await buildFixture(h);
  const co = await h.session(f.coord);
  codeA = (await h.call(co, 'POST', '/api/v1/samples', { body: sampleBody(f.centerA) })).json.sampleCode;
  codeB = (await h.call(co, 'POST', '/api/v1/samples', { body: sampleBody(f.centerB) })).json.sampleCode;
});
afterAll(async () => { await h.close(); });

describe('IDOR and scoping', () => {
  it('clinician of center A cannot read, list, verify, flag or fetch staleness of center B (404, existence not leaked)', async () => {
    const ca = await h.session(f.clinA);
    expect((await h.call(ca, 'GET', `/api/v1/samples/${codeB}`)).status).toBe(404);
    expect((await h.call(ca, 'POST', `/api/v1/samples/${codeB}/verify`)).status).toBe(404);
    expect((await h.call(ca, 'POST', `/api/v1/samples/${codeB}/flag`, { body: { reasonCode: 'duplicate' } })).status).toBe(404);
    expect((await h.call(ca, 'GET', `/api/v1/samples/smp_${'0'.repeat(26)}`)).status).toBe(404);   // same answer as a missing id
    const l = await h.call(ca, 'GET', '/api/v1/samples', { query: { centerId: f.centerB } });       // client-supplied center is ignored
    expect(l.json.items.every((s: any) => s.sourceCenterId === f.centerA)).toBe(true);
    expect((await h.call(ca, 'GET', `/api/v1/samples/${codeA}`)).status).toBe(200);
    expect((await h.call(ca, 'POST', `/api/v1/samples/${codeA}/flag`, { body: { reasonCode: 'wrong_field' } })).status).toBe(204);
  });
  it('a forged center in the session cannot widen scope: the database derives it from role assignments', async () => {
    const c = await h.repo.pool.connect();
    try {
      await c.query('BEGIN'); await c.query('SELECT portal.begin_session($1,$2)', [f.clinA.id, 'center_clinician']);
      expect((await c.query('SELECT count(*)::int n FROM portal.samples WHERE source_center_id = $1', [f.centerB])).rows[0].n).toBe(0);
      await expect(c.query(`SELECT set_config('app.ctx', 'x|center_clinician|${f.centerB}|deadbeef', true)`).then(() => c.query('SELECT count(*)::int n FROM portal.samples'))).resolves.toBeTruthy();
      expect((await c.query('SELECT count(*)::int n FROM portal.samples')).rows[0].n).toBe(0);     // bad signature: context is void, fail closed
      await c.query('ROLLBACK');
      await c.query('BEGIN'); await expect(c.query('SELECT portal.begin_session($1,$2)', [f.clinA.id, 'national_coordinator'])).rejects.toThrow(); await c.query('ROLLBACK');
    } finally { c.release(); }
  });
  it('requests: other applicants, other roles and clinicians outside the request see 404 or nothing', async () => {
    const a = await h.session(f.resIl); const b = await h.session(f.resIl2);
    const cart = await h.call(a, 'POST', '/api/v1/request-cart/items', { body: { criteria: { diagnosis: ['mb_shh'] } } }); expect(cart.status, cart.body).toBe(201);
    const id = (await h.call(a, 'POST', '/api/v1/request-cart/start', { headers: { 'idempotency-key': 'idor-start-0001' } })).json.id;
    expect((await h.call(b, 'GET', `/api/v1/requests/${id}`)).status).toBe(404);
    expect((await h.call(b, 'GET', `/api/v1/requests/${id}/steps`)).status).toBe(404);
    expect((await h.call(b, 'POST', `/api/v1/requests/${id}/submit`, { headers: { 'idempotency-key': 'idor-sub-00001' } })).status).toBe(404);
    expect((await h.call(b, 'DELETE', `/api/v1/requests/${id}/items/rit_${'0'.repeat(26)}`)).status).toBe(404);
    expect((await h.call(b, 'GET', '/api/v1/requests')).json.items).toHaveLength(0);
    expect((await h.call(await h.session(f.clinA), 'GET', `/api/v1/requests/${id}`)).status).toBe(404);
    expect((await h.call(await h.session(f.committee[0]!), 'GET', `/api/v1/requests/${id}`)).status).toBe(404);   // drafts and pre-committee requests are invisible to the committee
    expect((await h.call(await h.session(f.coord), 'GET', `/api/v1/requests/${id}`)).status).toBe(404);          // so are other people's drafts to the coordinator
  });
  it('external roles can never read sample rows, even through the database', async () => {
    const c = await h.repo.pool.connect();
    try {
      for (const [u, r] of [[f.resIl.id, 'researcher_il'], [f.resIntl.id, 'researcher_intl'], [f.committee[0]!.id, 'committee_member'], [f.admin1.id, 'system_admin']] as const) {
        await c.query('BEGIN'); await c.query('SELECT portal.begin_session($1,$2)', [u, r]);
        expect((await c.query('SELECT count(*)::int n FROM portal.samples')).rows[0].n).toBe(0);
        await c.query('ROLLBACK');
      }
      await c.query('BEGIN'); await c.query('SELECT portal.begin_session(NULL,$1)', ['anonymous']);
      await expect(c.query('SELECT donor_ref FROM portal.samples')).rejects.toThrow(/permission denied/);
      await c.query('ROLLBACK');
    } finally { c.release(); }
  });
});

describe('web-facing endpoints', () => {
  it('methods, recovery login, client errors, csp report, public form, headers', async () => {
    const s = await h.session(f.coord);
    const m = await h.call(s, 'GET', '/api/v1/auth/methods'); expect(m.status, m.body).toBe(200); expect(m.json.items[0]).toMatchObject({ kind: 'totp' });
    const ce = await h.call(null, 'POST', '/api/v1/client-errors', { body: { name: 'TypeError', route: '/search', version: '0.1.0', traceId: 'abc-123' } }); expect(ce.status).toBe(204);
    expect((await h.call(null, 'POST', '/api/v1/client-errors', { body: { name: 'x', route: '/a', version: '1', message: 'free text' } })).status).toBe(422);
    expect((await h.call(null, 'POST', '/api/v1/csp-report', { raw: JSON.stringify({ 'csp-report': { 'blocked-uri': 'https://x.example/a?secret=1' } }), headers: { 'content-type': 'application/csp-report' } })).status).toBe(204);
    const pf = await h.call(null, 'POST', '/api/v1/public/forms/contact', { body: { name: 'Synthetic Visitor', email: 'v@example.invalid', message: 'Hello there' } }); expect(pf.status, pf.body).toBe(202);
    const bot = await h.call(null, 'POST', '/api/v1/public/forms/join', { body: { name: 'Bot', email: 'b@example.invalid', message: 'spam spam', website: 'http://x' } }); expect(bot.status).toBe(202);
    const r = await h.call(null, 'GET', '/api/v1/diagnoses');
    expect(r.headers['strict-transport-security']).toMatch(/max-age=\d+/); expect(r.headers['content-security-policy']).toContain("default-src 'self'");
    expect(r.headers['x-content-type-options']).toBe('nosniff'); expect(r.headers['cache-control']).toBe('no-store');
    const sess = await h.call(await h.session(f.clinA), 'GET', '/api/v1/session'); expect(sess.json.centerId).toBe(f.centerA); expect(sess.json.roles[0].role).toBe('center_clinician');
  });
  it('precheck ask_info -> respond -> back to pre-check; k-policy and role-grant request facades', async () => {
    const a = await h.session(f.resIl);
    await h.call(a, 'POST', '/api/v1/request-cart/items', { body: { criteria: { diagnosis: ['mb_shh'] } } });
    const id = (await h.call(a, 'POST', '/api/v1/request-cart/start', { headers: { 'idempotency-key': 'b6-start-00001' } })).json.id;
    await h.call(a, 'PATCH', `/api/v1/requests/${id}`, { body: { researchQuestion: 'A question', applicantEthicsRef: 'HC-2024-0099', plannedUse: 'Use', fundingSources: 'Grant' }, headers: { 'content-type': 'application/merge-patch+json' } });
    expect((await h.call(a, 'POST', `/api/v1/requests/${id}/submit`, { headers: { 'idempotency-key': 'b6-submit-0001' } })).status).toBe(200);
    const co = await h.session(f.coord);
    const ask = await h.call(co, 'POST', `/api/v1/requests/${id}/precheck`, { body: { outcome: 'ask_info', reasonCode: 'ethics_unclear', note: 'Please clarify the approval scope' } });
    expect(ask.status, ask.body).toBe(200); expect(ask.json.status).toBe('needs_info');
    expect((await h.call(a, 'POST', `/api/v1/requests/${id}/respond`, { body: { message: 'call me 052-123-4567' } })).status).toBe(422);
    const back = await h.call(a, 'POST', `/api/v1/requests/${id}/respond`, { body: { message: 'Scope clarified' } }); expect(back.status, back.body).toBe(200); expect(back.json.status).toBe('precheck');
    expect((await h.call(co, 'POST', `/api/v1/requests/${id}/precheck`, { body: { outcome: 'reject', reasonCode: 'out_of_scope' } })).json.closeReason).toBe('rejected');

    const a1 = await h.session(f.admin1); const cm = await h.session(f.committee[2]!);
    const kp = await h.call(a1, 'GET', '/api/v1/k-policies'); expect(kp.status, kp.body).toBe(200); expect(kp.json.items[0]).toMatchObject({ fieldSet: 'default', pendingChange: null });
    expect((await h.call(a1, 'POST', '/api/v1/k-policies/default/changes', { body: { k: 4, reason: 'lower' } })).status).toBe(422);
    const ch = await h.call(a1, 'POST', '/api/v1/k-policies/default/changes', { body: { k: 6, reason: 'Stricter for pilot' } }); expect(ch.status, ch.body).toBe(202);
    expect(ch.json.pendingChange).toMatchObject({ proposedK: 6, proposedByUserId: f.admin1.id });
    expect((await h.call(a1, 'POST', `/api/v1/k-policy-changes/${ch.json.pendingChange.id}/approve`)).status).toBe(403);   // proposer is not the committee approver role
    const ok = await h.call(cm, 'POST', `/api/v1/k-policy-changes/${ch.json.pendingChange.id}/approve`); expect(ok.status, ok.body).toBe(200); expect(ok.json.k).toBe(6);
    const back2 = await h.call(a1, 'POST', '/api/v1/k-policies/default/changes', { body: { k: 5, reason: 'restore' } });
    expect((await h.call(await h.session(f.committee[1]!), 'POST', `/api/v1/k-policy-changes/${back2.json.pendingChange.id}/approve`)).status).toBe(200);

    const victim = await h.seedUser('researcher_il', null, 'grant'); void victim;
    const nu = await h.call(a1, 'POST', '/api/v1/users', { body: { email: `g.${Date.now()}@example.invalid`, displayName: 'Synthetic Grant', role: 'center_clinician', centerId: f.centerB } }); expect(nu.status, nu.body).toBe(201);
    const rg = await h.call(a1, 'POST', '/api/v1/role-grant-requests', { body: { userId: nu.json.id, role: 'center_clinician', centerId: f.centerA, reason: 'Second center' } });
    expect(rg.status, rg.body).toBe(202); expect(rg.json).toMatchObject({ status: 'pending', requestedByUserId: f.admin1.id, reason: 'Second center' });
    expect((await h.call(a1, 'POST', `/api/v1/role-grant-requests/${rg.json.id}/decision`, { body: { outcome: 'approved' } })).status).toBe(409);
    const dec = await h.call(await h.session(f.admin2), 'POST', `/api/v1/role-grant-requests/${rg.json.id}/decision`, { body: { outcome: 'rejected' } }); expect(dec.status, dec.body).toBe(200); expect(dec.json.status).toBe('rejected');
    expect((await h.call(a1, 'GET', '/api/v1/role-grant-requests')).json.items.length).toBeGreaterThan(0);
  });
});

describe('problem+json contract', () => {
  it('every error is RFC 9457 with code and traceId and no values', async () => {
    const cases: Array<[Awaited<ReturnType<Harness['session']>> | null, string, string, unknown?]> = [
      [null, 'GET', '/api/v1/samples'], [await h.session(f.resIl), 'GET', '/api/v1/samples'], [await h.session(f.coord), 'GET', `/api/v1/samples/smp_${'0'.repeat(26)}`],
      [await h.session(f.coord), 'POST', '/api/v1/samples', { sourceCenterId: 'bad', secret: '0501234567' }], [null, 'GET', '/api/v1/nope'],
    ];
    for (const [s, m, u, b] of cases) {
      const r = await h.call(s, m, u, b === undefined ? {} : { body: b });
      expect(r.res.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(h.contract.validateResponse('listSamples', 403, r.json, 'application/problem+json') ?? []).toEqual([]);
      expect(r.json.traceId).toBeTruthy(); expect(r.body).not.toContain('0501234567'); expect(r.body).not.toContain('bad');
    }
  });
});
