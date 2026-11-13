import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './support/harness.js';
import { buildFixture, sampleBody, type Fixture } from './support/fixture.js';

let h: Harness; let f: Fixture;
beforeAll(async () => { h = await startHarness(); f = await buildFixture(h); });
afterAll(async () => { await h.close(); });

describe('samples', () => {
  it('coordinator creates, reads, patches with ETag, verifies, retires', async () => {
    const c = await h.session(f.coord);
    const created = await h.call(c, 'POST', '/api/v1/samples', { body: sampleBody(f.centerA) });
    expect(created.status, created.body).toBe(201);
    const code = created.json.sampleCode as string;
    const got = await h.call(c, 'GET', `/api/v1/samples/${code}`);
    expect(got.status, got.body).toBe(200);
    const etag = got.headers.etag as string;
    const bad = await h.call(c, 'PATCH', `/api/v1/samples/${code}`, { body: { availability: 'limited' }, headers: { 'if-match': '"stale"', 'content-type': 'application/merge-patch+json' } });
    expect(bad.status).toBe(412);
    const ok = await h.call(c, 'PATCH', `/api/v1/samples/${code}`, { body: { availability: 'limited' }, headers: { 'if-match': etag, 'content-type': 'application/merge-patch+json' } });
    expect(ok.status, ok.body).toBe(200); expect(ok.json.availability).toBe('limited');
    const clin = await h.session(f.clinA);
    const v = await h.call(clin, 'POST', `/api/v1/samples/${code}/verify`); expect(v.status, v.body).toBe(200);
    const list = await h.call(clin, 'GET', '/api/v1/samples'); expect(list.status, list.body).toBe(200);
    expect(list.json.items.every((s: any) => s.sourceCenterId === f.centerA)).toBe(true);
    const del = await h.call(c, 'POST', `/api/v1/samples/${code}/retire`); expect(del.status, del.body).toBe(204);
  });
  it('rejects identifier-shaped values and unknown fields', async () => {
    const c = await h.session(f.coord);
    const r = await h.call(c, 'POST', '/api/v1/samples', { body: sampleBody(f.centerA, { diagnosisCode: 'x', collectionMonth: '2024-05-17' }) });
    expect(r.status).toBe(422);
    const r2 = await h.call(c, 'POST', '/api/v1/samples', { body: { ...sampleBody(f.centerA), patientName: 'x' } });
    expect(r2.status).toBe(422);
  });
});
