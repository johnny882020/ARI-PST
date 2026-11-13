import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './support/harness.js';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.close(); });

describe('smoke', () => {
  it('livez and readyz', async () => {
    const a = await h.call(null, 'GET', '/api/livez'); expect(a.status).toBe(200);
    const b = await h.call(null, 'GET', '/api/readyz'); expect(b.status).toBe(200);
  });
  it('lists diagnoses publicly', async () => {
    const r = await h.call(null, 'GET', '/api/v1/diagnoses'); expect(r.status).toBe(200); expect(r.json.items.length).toBeGreaterThan(3);
  });
});
