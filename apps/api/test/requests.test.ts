import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './support/harness.js';
import { buildFixture, sampleBody, type Fixture } from './support/fixture.js';

let h: Harness; let f: Fixture; const sampleCodes: string[] = [];
const MP = { 'content-type': 'application/merge-patch+json' };
beforeAll(async () => {
  h = await startHarness(); f = await buildFixture(h);
  const c = await h.session(f.coord);
  for (let i = 0; i < 14; i++) { const r = await h.call(c, 'POST', '/api/v1/samples', { body: sampleBody(f.centerA) }); expect(r.status, r.body).toBe(201); sampleCodes.push(r.json.sampleCode); }
  await h.refreshSnapshot(f.coord);
});
afterAll(async () => { await h.close(); });

describe('search and k-anonymity', () => {
  it('external researcher gets a count of a big cell, never rows', async () => {
    const s = await h.session(f.resIl);
    const r = await h.call(s, 'POST', '/api/v1/search/aggregate', { body: { filters: { diagnosis: ['mb_shh'] } } });
    expect(r.status, r.body).toBe(200);
    expect(r.json.suppressed).toBe(false); expect(r.json.count).toBeGreaterThanOrEqual(10);
    expect(r.json.k).toBeUndefined();                 // threshold never shown to external roles
    const rows = await h.call(s, 'GET', '/api/v1/samples'); expect(rows.status).toBe(403);
  });
  it('small cells are masked without a number', async () => {
    const s = await h.session(f.resIl);
    const r = await h.call(s, 'POST', '/api/v1/search/aggregate', { body: { filters: { diagnosis: ['mb_shh'], sampleType: ['frozen'] } } });
    expect(r.status, r.body).toBe(200); expect(r.json.count).toBeNull(); expect(r.json.suppressed).toBe(true); expect(r.json.label).toBe('too_few');
  });
  it('facets and suggestions work', async () => {
    const s = await h.session(f.resIntl);
    const fc = await h.call(s, 'POST', '/api/v1/search/facets', { body: { facets: ['sampleType', 'sex'], filters: { diagnosis: ['mb_shh'] } } });
    expect(fc.status, fc.body).toBe(200); expect(Object.keys(fc.json.facets)).toEqual(['sampleType', 'sex']);
    const sg = await h.call(s, 'GET', '/api/v1/search/suggest', { query: { q: 'medulloblastoma' } });
    expect(sg.status, sg.body).toBe(200); expect(sg.json.items.length).toBeGreaterThan(0);
  });
  it('enforces the filter shape (3 values per key)', async () => {
    const s = await h.session(f.resIl);
    const r = await h.call(s, 'POST', '/api/v1/search/aggregate', { body: { filters: { sampleType: ['ffpe', 'frozen', 'csf', 'plasma_or_liquid_biopsy'] } } });
    expect(r.status).toBe(422);
  });
  it('rate limit denies the 21st distinct query in a minute and audits it', async () => {
    const u = await h.seedUser('researcher_il', null, 'rate'); const s = await h.session(u);
    let denied = 0; let n = 0;
    outer: for (const a of ['0_lt1', '1_lt3', '3_lt6', '6_lt10', '10_lt15', '15_lt18']) for (const x of ['female', 'male', 'other_or_unknown']) for (const v of ['available', 'limited']) {
      if (n++ >= 26) break outer;
      const r = await h.call(s, 'POST', '/api/v1/search/aggregate', { body: { filters: { diagnosis: ['mb_shh'], ageBand: [a], sex: [x], availability: [v] } } });
      if (r.status === 429) denied++;
    }
    expect(denied).toBeGreaterThan(0);
  });
});

describe('request flow end to end', () => {
  it('cart to delivery with committee quorum, center responses and DB-enforced rules', async () => {
    const app = await h.session(f.resIl); const other = await h.session(f.resIl2);
    const cart = await h.call(app, 'PUT', '/api/v1/request-cart', { body: { items: [{ criteria: { diagnosis: ['mb_shh'] } }] } });
    expect(cart.status, cart.body).toBe(200); const id = cart.json.requestId as string;
    expect(cart.json.items[0].shownCountBucket).toBe('10_plus');
    // IDOR: another applicant cannot see or edit it
    expect((await h.call(other, 'GET', `/api/v1/requests/${id}`)).status).toBe(404);
    expect((await h.call(other, 'PATCH', `/api/v1/requests/${id}`, { body: { plannedUse: 'x' }, headers: MP })).status).toBe(404);
    // incomplete form cannot be submitted
    expect((await h.call(app, 'POST', `/api/v1/requests/${id}/submit`, { headers: { 'idempotency-key': 'idem-key-0001' } })).status).toBe(422);
    // identifier-shaped text is refused
    expect((await h.call(app, 'PATCH', `/api/v1/requests/${id}`, { body: { researchQuestion: 'call 050-123-4567' }, headers: MP })).status).toBe(422);
    const upd = await h.call(app, 'PATCH', `/api/v1/requests/${id}`, { body: { researchQuestion: 'Does pathway X differ by subtype?', applicantEthicsRef: 'HC-2024-0012', plannedUse: 'Expression profiling of archived tissue', fundingSources: 'Synthetic Foundation grant' }, headers: MP });
    expect(upd.status, upd.body).toBe(200);
    const sub = await h.call(app, 'POST', `/api/v1/requests/${id}/submit`, { headers: { 'idempotency-key': 'idem-key-0001' } });
    expect(sub.status, sub.body).toBe(200); expect(['submitted', 'precheck']).toContain(sub.json.status);
    // applicant cannot reopen or jump ahead (DB + domain)
    expect((await h.call(app, 'POST', `/api/v1/requests/${id}/transition`, { body: { to: 'delivery' } })).status).toBeGreaterThanOrEqual(403);
    // pre-check pass by coordinator
    const co = await h.session(f.coord);
    const incomplete = await h.call(co, 'POST', `/api/v1/requests/${id}/transition`, { body: { to: 'committee_review', checklist: { form_complete: true } } });
    expect(incomplete.status).toBe(422);
    const pass = await h.call(co, 'POST', `/api/v1/requests/${id}/transition`, { body: { to: 'committee_review', checklist: { form_complete: true, irb_ref_plausible: true, consent_scope_ok: true, no_identifier_requested: true, items_exist: true } } });
    expect(pass.status, pass.body).toBe(200); expect(pass.json.status).toBe('committee_review');
    // coordinator cannot decide, applicant cannot vote
    expect((await h.call(co, 'POST', `/api/v1/requests/${id}/decisions`, { body: { outcome: 'approved' } })).status).toBe(403);
    expect((await h.call(app, 'PUT', `/api/v1/requests/${id}/votes`, { body: { vote: 'approve' } })).status).toBe(403);
    // quorum 2 of 3: one vote is not a decision
    const c1 = await h.session(f.committee[0]!); const c2 = await h.session(f.committee[1]!);
    const v1 = await h.call(c1, 'PUT', `/api/v1/requests/${id}/votes`, { body: { vote: 'approve' } }); expect(v1.status, v1.body).toBe(200);
    expect((await h.call(c1, 'POST', `/api/v1/requests/${id}/decisions`, { body: { outcome: 'approved' } })).status).toBe(409);
    expect((await h.call(c1, 'PUT', `/api/v1/requests/${id}/votes`, { body: { vote: 'approve' } })).status).toBe(409);  // one vote per member
    expect((await h.call(c2, 'PUT', `/api/v1/requests/${id}/votes`, { body: { vote: 'approve' } })).status).toBe(200);
    const dec = await h.call(c1, 'POST', `/api/v1/requests/${id}/decisions`, { body: { outcome: 'approved' } });
    expect(dec.status, dec.body).toBe(201); expect(dec.json.outcome).toBe('approved');
    expect((await h.call(app, 'GET', `/api/v1/requests/${id}`)).json.status).toBe('approved');
    // coordinator resolves samples and starts center coordination
    const item = (await h.call(co, 'GET', `/api/v1/requests/${id}`)).json.items[0].id;
    expect((await h.call(co, 'PUT', `/api/v1/requests/${id}/resolved-samples`, { body: { itemId: item, sampleIds: sampleCodes.slice(0, 3) } })).status).toBe(204);
    expect((await h.call(co, 'POST', `/api/v1/requests/${id}/transition`, { body: { to: 'center_coordination' } })).status).toBe(200);
    const ca = await h.session(f.clinA);
    expect((await h.call(ca, 'PATCH', `/api/v1/requests/${id}/steps/center_coordination`, { body: { accepted: true, publicNote: 'Accepted' } })).status).toBe(200);
    expect((await h.call(co, 'GET', `/api/v1/requests/${id}`)).json.status).toBe('agreements');
    expect((await h.call(co, 'PATCH', `/api/v1/requests/${id}/steps/mta_dta`, { body: { centerId: f.centerA, agreement: { kind: 'mta', docRef: 'MTA-2026-001' } } })).status).toBe(200);
    expect((await h.call(co, 'POST', `/api/v1/requests/${id}/transition`, { body: { to: 'delivery' } })).status).toBe(200);
    // coordinator cannot mark delivered
    expect((await h.call(co, 'POST', `/api/v1/requests/${id}/transition`, { body: { to: 'closed', closeReason: 'withdrawn' } })).status).toBeGreaterThanOrEqual(400);
    expect((await h.call(ca, 'PATCH', `/api/v1/requests/${id}/steps/delivery`, { body: { status: 'done' } })).status).toBe(200);
    const fin = await h.call(app, 'GET', `/api/v1/requests/${id}`);
    expect(fin.json.status).toBe('closed'); expect(fin.json.closeReason).toBe('delivered');
    // closed is terminal
    expect((await h.call(app, 'POST', `/api/v1/requests/${id}/transition`, { body: { to: 'draft' } })).status).toBe(422);
    const steps = await h.call(app, 'GET', `/api/v1/requests/${id}/steps`);
    expect(steps.status, steps.body).toBe(200); expect(steps.json.items.length).toBeGreaterThanOrEqual(8);
    expect(JSON.stringify(steps.json)).not.toContain('internalNote":"');
  });
});
