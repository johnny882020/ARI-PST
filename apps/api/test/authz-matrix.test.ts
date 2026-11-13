// Generated from the OpenAPI x-roles of every operation: every role against every endpoint (decision C-10, RT-07).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OPERATION_ACCESS, ROLES, rolesFor, type Role } from '@ari/domain';
import { startHarness, type Harness, type TestUser } from './support/harness.js';
import { buildFixture, type Fixture } from './support/fixture.js';

let h: Harness; let f: Fixture; let users: Record<string, TestUser>;
beforeAll(async () => {
  h = await startHarness(); f = await buildFixture(h);
  users = { researcher_il: f.resIl, researcher_intl: f.resIntl, center_clinician: f.clinA, national_coordinator: f.coord, committee_member: f.committee[0]!, system_admin: f.admin1 };
});
afterAll(async () => { await h.close(); });

const Z = '0'.repeat(26);
const fill = (path: string) => path.replace(/\{(\w+)\}/g, (_m, n: string) => ({ sampleId: `smp_${Z}`, requestId: `req_${Z}`, jobId: `imp_${Z}`, userId: `usr_${Z}`, id: `usr_${Z}`, centerId: `ctr_${Z}`, format: 'csv', form: 'contact', stepKey: 'delivery', itemId: `rit_${Z}`, assignmentId: `rol_${Z}`, approvalId: `chg_${Z}` } as Record<string, string>)[n] ?? 'x');
const CREDENTIAL_OPS = new Set(['stepUp', 'enrollTotpConfirm', 'webauthnRegisterVerify', 'login', 'verifyMfa', 'recoverMfa', 'webauthnOptions']);
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

describe('authz matrix', () => {
  it('x-roles in the contract equal the one capability table', async () => {
    for (const op of h.contract.operations) {
      const t = rolesFor(op.operationId);
      expect(op.xRoles, op.operationId).toEqual(t === 'public' ? 'public' : [...t]);
    }
    expect(Object.keys(OPERATION_ACCESS).sort()).toEqual(h.contract.operations.map((o) => o.operationId).sort());
  });
  it('every role x every endpoint', async () => {
    const problems: string[] = []; let cells = 0;
    for (const op of h.contract.operations) {
      if (!METHODS.has(op.method)) continue;
      const url = fill(op.fullPath);
      for (const role of ROLES) {
        cells++;
        const allowed = rolesFor(op.operationId);
        const may = allowed === 'public' || allowed.includes(role);
        const sess = role === 'anonymous' ? null : await h.session(users[role]!);
        const r = await h.call(sess, op.method, url, { body: op.method === 'GET' || op.method === 'DELETE' ? undefined : {} });
        if (r.status >= 500 && !(op.operationId === 'readyz')) problems.push(`${op.operationId} ${role}: ${r.status} ${r.body.slice(0, 120)}`);
        if (may) { if (r.status === 401 && !CREDENTIAL_OPS.has(op.operationId)) problems.push(`${op.operationId} ${role} should pass authz, got ${r.status}`); }
        else {
          const want = role === 'anonymous' ? 401 : 403;
          if (r.status !== want) problems.push(`${op.operationId} ${role} should be ${want}, got ${r.status}`);
        }
      }
    }
    expect(cells).toBeGreaterThan(500);
    expect(problems).toEqual([]);
  });
});
