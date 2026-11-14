import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGIN, startHarness, type Harness, type TestUser } from './support/harness.js';
import { buildFixture, type Fixture } from './support/fixture.js';
import { totpAt } from '../src/adapters/auth-local/totp.js';

let h: Harness; let f: Fixture;
beforeAll(async () => { h = await startHarness(); f = await buildFixture(h); });
afterAll(async () => { await h.close(); });

/** Raw browser-like client: keeps cookies. */
function browser() {
  const jar = new Map<string, string>();
  let csrf = '';
  const store = (res: any) => { for (const c of ([] as string[]).concat(res.headers['set-cookie'] ?? [])) { const [kv] = c.split(';'); const [k, v] = kv!.split('='); if (c.includes('Max-Age=0') || c.includes('Expires=Thu, 01 Jan 1970')) jar.delete(k!); else jar.set(k!, v!); } };
  async function req(method: string, url: string, body?: unknown, extra: Record<string, string> = {}) {
    const headers: Record<string, string> = { origin: ORIGIN, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), ...extra };
    if (csrf && !('x-csrf-token' in extra)) headers['x-csrf-token'] = csrf;
    const res = await h.app.inject({ method: method as 'GET', url, headers, ...(body !== undefined ? { payload: body as object } : {}) });
    store(res);
    return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : undefined, res };
  }
  return { jar, req, setCsrf: (v: string) => { csrf = v; }, get csrf() { return csrf; } };
}
async function bootstrap(b: ReturnType<typeof browser>) { const r = await b.req('GET', '/api/v1/auth/csrf'); b.setCsrf(r.json.csrfToken); return r; }
async function resetReplay(u: TestUser) { await h.admin.query('UPDATE authn.credentials SET totp_last_step = -1, failed_count = 0, locked_until = NULL WHERE user_id = $1', [u.id]); }
const code = (u: TestUser, offset = 0) => totpAt(u.totpSecret, Date.now() + offset * 30000);

describe('login, MFA, cookies, CSRF', () => {
  it('rejects unsafe requests without the double-submit token', async () => {
    const b = browser();
    const r = await b.req('POST', '/api/v1/auth/login', { email: f.resIl.email, password: f.resIl.password });
    expect(r.status).toBe(403); expect(r.json.code).toBe('CSRF_INVALID');
    await bootstrap(b);
    const bad = await b.req('POST', '/api/v1/auth/login', { email: f.resIl.email, password: f.resIl.password }, { 'x-csrf-token': 'wrong-token-value-0000000000' });
    expect(bad.status).toBe(403);
    const crossOrigin = await b.req('POST', '/api/v1/auth/login', { email: f.resIl.email, password: f.resIl.password }, { origin: 'https://evil.example' });
    expect(crossOrigin.status).toBe(403);
  });
  it('password + TOTP creates a __Host-sid cookie (HttpOnly, Secure, SameSite=Strict, no Domain)', async () => {
    const b = browser(); await bootstrap(b);
    const wrong = await b.req('POST', '/api/v1/auth/login', { email: f.resIl.email, password: 'wrong-password-value' });
    expect(wrong.status).toBe(401);
    const l = await b.req('POST', '/api/v1/auth/login', { email: f.resIl.email, password: f.resIl.password });
    expect(l.status, JSON.stringify(l.json)).toBe(200); expect(l.json.factors).toEqual(['totp']);
    const badCode = await b.req('POST', '/api/v1/auth/mfa/verify', { challengeToken: l.json.challengeToken, totpCode: '000000' });
    expect(badCode.status).toBe(401);
    const ok = await b.req('POST', '/api/v1/auth/mfa/verify', { challengeToken: l.json.challengeToken, totpCode: code(f.resIl, 1) });
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
    const sc = ([] as string[]).concat(ok.res.headers['set-cookie'] as string[]).find((c) => c.startsWith('__Host-sid='))!;
    expect(sc).toMatch(/HttpOnly/i); expect(sc).toMatch(/Secure/i); expect(sc).toMatch(/SameSite=Strict/i); expect(sc).toMatch(/Path=\//); expect(sc).not.toMatch(/Domain=/i);
    b.setCsrf(ok.json.csrfToken);
    b.setCsrf(b.jar.get('__Host-csrf')!); const sess = await b.req('GET', '/api/v1/session'); expect(sess.status).toBe(200); expect(sess.json.roles[0].role).toBe('researcher_il');
    expect((await b.req('GET', '/api/v1/me')).json.email).toBe(f.resIl.email);
    // the CSRF header must equal the session token
    expect((await b.req('POST', '/api/v1/session/extend', undefined, { 'x-csrf-token': 'different-token-0000000000000' })).status).toBe(403);
    expect((await b.req('POST', '/api/v1/session/extend')).status).toBe(200);
    // logout ends the session
    expect((await b.req('POST', '/api/v1/auth/logout')).status).toBe(204);
    expect((await b.req('GET', '/api/v1/session')).status).toBe(401);
  });
  it('locks the account after repeated wrong passwords and hides user existence', async () => {
    const u = await h.seedUser('researcher_il', null, 'lock');
    const b = browser(); await bootstrap(b);
    const unknown = await b.req('POST', '/api/v1/auth/login', { email: 'nobody@example.invalid', password: 'whatever-password-1' });
    expect(unknown.status).toBe(401);
    for (let i = 0; i < 5; i++) await b.req('POST', '/api/v1/auth/login', { email: u.email, password: 'wrong-password-value' });
    const locked = await b.req('POST', '/api/v1/auth/login', { email: u.email, password: u.password });
    // R-07: a locked account answers like an unknown address. The lock-out stays internal and audited.
    expect(locked.status).toBe(401);
    expect(locked.res.headers['content-type']).toMatch(/application\/problem\+json/);
    const strip = (j: Record<string, unknown>) => { const { traceId: _t, ...rest } = j; return rest; };
    expect(strip(locked.json)).toEqual(strip(unknown.json));
    expect(locked.res.headers['retry-after']).toBeUndefined();
    const audit = await h.admin.query(`SELECT count(*)::int AS n FROM audit.audit_events WHERE action = 'auth.login.fail' AND details->>'reason' = 'locked' AND trace_id = $1`, [locked.res.headers['x-trace-id']]);
    expect(audit.rows[0].n).toBe(1);
  });
  it('one password step creates one session, even with two parallel valid factors (R-05)', async () => {
    const u = await h.seedUser('researcher_il', null, 'race'); await resetReplay(u);
    const [rc1, rc2] = await h.auth.issueRecoveryCodes(u.id);
    const b = browser(); await bootstrap(b);
    const l = await b.req('POST', '/api/v1/auth/login', { email: u.email, password: u.password });
    expect(l.status).toBe(200);
    const tries = await Promise.all([
      b.req('POST', '/api/v1/auth/mfa/verify', { challengeToken: l.json.challengeToken, recoveryCode: rc1 }),
      b.req('POST', '/api/v1/auth/mfa/verify', { challengeToken: l.json.challengeToken, recoveryCode: rc2 }),
      b.req('POST', '/api/v1/auth/mfa/verify', { challengeToken: l.json.challengeToken, totpCode: code(u) }),
    ]);
    expect(tries.filter((t) => t.status === 200)).toHaveLength(1);
    expect(tries.filter((t) => t.status === 401)).toHaveLength(2);
    const n = await h.admin.query('SELECT count(*)::int AS n FROM authn.sessions WHERE user_id = $1', [u.id]);
    expect(n.rows[0].n).toBe(1);
  });
  it('the session lists mfaEnrolled (R-06)', async () => {
    const s = await h.session(f.resIl);
    const r = await h.call(s, 'GET', '/api/v1/session');
    expect(r.status, r.body).toBe(200); expect(r.json.mfaEnrolled).toBe(true);
  });
  it('an e-mail token is valid only for its own purpose (R-08)', async () => {
    const u = await h.seedUser('researcher_il', null, 'purpose');
    const reset = await h.auth.issueEmailToken(u.id, 'password_reset');
    expect(await h.auth.consumeEmailToken(reset, 'invite')).toBeNull();
    expect(await h.auth.consumeEmailToken(reset, 'verify')).toBeNull();
    expect(await h.auth.consumeEmailToken(reset, 'password_reset')).toBe(u.id);
    expect(await h.auth.consumeEmailToken(reset, 'password_reset')).toBeNull();     // one use only
    const invite = await h.auth.issueEmailToken(u.id, 'invite');
    expect(await h.auth.consumeEmailToken(invite, 'password_reset')).toBeNull();
    expect(await h.auth.consumeEmailToken(invite, 'invite')).toBe(u.id);
    const verify = await h.auth.issueEmailToken(u.id, 'verify');
    expect(await h.auth.consumeEmailToken(verify, 'verify')).toBe(u.id);
    // the login challenge path does not accept an e-mail token
    const other = await h.auth.issueEmailToken(u.id, 'invite');
    expect(await h.auth.consumeChallenge(other)).toBeNull();
  });
  it('malformed JSON is 400 and an unknown media type is 415, both problem+json (R-10)', async () => {
    const b = browser(); await bootstrap(b);
    const bad = await h.app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin: ORIGIN, cookie: `__Host-csrf=${b.csrf}`, 'x-csrf-token': b.csrf, 'content-type': 'application/json' }, payload: '{"email":' });
    expect(bad.statusCode).toBe(400); expect(bad.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(JSON.parse(bad.body)).toMatchObject({ status: 400, code: 'MALFORMED_REQUEST', type: '/problems/malformed-request' });
    const media = await h.app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin: ORIGIN, cookie: `__Host-csrf=${b.csrf}`, 'x-csrf-token': b.csrf, 'content-type': 'text/x-unknown' }, payload: 'email' });
    expect(media.statusCode).toBe(415); expect(media.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(JSON.parse(media.body)).toMatchObject({ status: 415, code: 'UNSUPPORTED_MEDIA_TYPE', type: '/problems/unsupported-media-type' });
    const patch = await h.call(await h.session(f.resIl), 'PATCH', '/api/v1/me', { raw: '{"displayName":', headers: { 'content-type': 'application/merge-patch+json' } });
    expect(patch.status).toBe(400); expect(patch.json.code).toBe('MALFORMED_REQUEST');
  });
  it('TOTP codes cannot be replayed (step-up)', async () => {
    const u = await h.seedUser('national_coordinator', null, 'replay'); await resetReplay(u);
    const s = await h.session(u);
    const c = code(u);
    const a = await h.call(s, 'POST', '/api/v1/auth/step-up', { body: { totpCode: c } }); expect(a.status, a.body).toBe(200);
    const again = await h.call(s, 'POST', '/api/v1/auth/step-up', { body: { totpCode: c } }); expect(again.status).toBe(401);
  });
});

describe('session timeouts (C-02) and step-up', () => {
  it('idle timeout: 30 min researchers, 15 min staff', async () => {
    const s1 = await h.session(f.resIl); const s2 = await h.session(f.coord);
    const id = (x: { cookie: string }) => x.cookie.match(/__Host-sid=([^;]+)/)![1]!;
    const { sha256Buf } = await import('../src/lib/crypto.js');
    await h.admin.query(`UPDATE authn.sessions SET last_seen_at = now() - interval '20 minutes' WHERE id_hash = $1`, [sha256Buf(id(s1))]);
    await h.admin.query(`UPDATE authn.sessions SET last_seen_at = now() - interval '20 minutes' WHERE id_hash = $1`, [sha256Buf(id(s2))]);
    expect((await h.call(s1, 'GET', '/api/v1/session')).status).toBe(200);
    expect((await h.call(s2, 'GET', '/api/v1/session')).status).toBe(401);
    await h.admin.query(`UPDATE authn.sessions SET last_seen_at = now() - interval '31 minutes' WHERE id_hash = $1`, [sha256Buf(id(s1))]);
    expect((await h.call(s1, 'GET', '/api/v1/session')).status).toBe(401);
  });
  it('absolute timeout: 8 h, 4 h for admin', async () => {
    const { sha256Buf } = await import('../src/lib/crypto.js');
    const a = await h.session(f.admin1); const r = await h.session(f.resIl);
    const id = (x: { cookie: string }) => x.cookie.match(/__Host-sid=([^;]+)/)![1]!;
    await h.admin.query(`UPDATE authn.sessions SET created_at = now() - interval '5 hours', last_seen_at = now() WHERE id_hash = $1`, [sha256Buf(id(a))]);
    await h.admin.query(`UPDATE authn.sessions SET created_at = now() - interval '5 hours', last_seen_at = now() WHERE id_hash = $1`, [sha256Buf(id(r))]);
    expect((await h.call(a, 'GET', '/api/v1/session')).status).toBe(401);
    expect((await h.call(r, 'GET', '/api/v1/session')).status).toBe(200);
    await h.admin.query(`UPDATE authn.sessions SET created_at = now() - interval '9 hours', last_seen_at = now() WHERE id_hash = $1`, [sha256Buf(id(r))]);
    expect((await h.call(r, 'GET', '/api/v1/session')).status).toBe(401);
  });
  it('sensitive operations need a second factor no older than 5 minutes', async () => {
    const old = await h.session(f.admin1, { mfaAgeMs: 10 * 60_000 });
    const r = await h.call(old, 'POST', `/api/v1/users/${f.coord.id}/roles`, { body: { role: 'center_clinician', centerId: f.centerA } });
    expect(r.status).toBe(401); expect(r.json.code).toBe('STEP_UP_REQUIRED');
  });
  it('an enrolment-only session (no factor yet) cannot reach data', async () => {
    const u = await h.seedUser('researcher_il', null, 'nofactor');
    await h.admin.query('UPDATE authn.credentials SET totp_secret_enc = NULL, totp_confirmed_at = NULL WHERE user_id = $1', [u.id]);
    const b = browser(); await bootstrap(b);
    const l = await b.req('POST', '/api/v1/auth/login', { email: u.email, password: u.password });
    expect(l.json.enrollmentRequired).toBe(true);
    const v = await b.req('POST', '/api/v1/auth/mfa/verify', { challengeToken: l.json.challengeToken });
    expect(v.status, JSON.stringify(v.json)).toBe(200); b.setCsrf(v.json.csrfToken);
    expect((await b.req('GET', '/api/v1/request-cart')).status).toBe(401);
    const start = await b.req('POST', '/api/v1/auth/enrol/totp'); expect(start.status).toBe(200);
    const bad = await b.req('POST', '/api/v1/auth/enrol/totp/confirm', { code: '123456' }); expect(bad.status).toBe(401);
    const done = await b.req('POST', '/api/v1/auth/enrol/totp/confirm', { code: totpAt(start.json.secret, Date.now()) });
    expect(done.status, JSON.stringify(done.json)).toBe(200); expect(done.json.recoveryCodes).toHaveLength(10);
    expect((await b.req('GET', '/api/v1/request-cart')).status).toBe(200);
    // a recovery code works once
    const b2 = browser(); await bootstrap(b2);
    const l2 = await b2.req('POST', '/api/v1/auth/login', { email: u.email, password: u.password });
    const rc = done.json.recoveryCodes[0];
    expect((await b2.req('POST', '/api/v1/auth/mfa/verify', { challengeToken: l2.json.challengeToken, recoveryCode: rc })).status).toBe(200);
    b2.setCsrf(b2.jar.get('__Host-csrf')!);
    const l3 = await b2.req('POST', '/api/v1/auth/login', { email: u.email, password: u.password });
    expect((await b2.req('POST', '/api/v1/auth/mfa/verify', { challengeToken: l3.json.challengeToken, recoveryCode: rc })).status).toBe(401);
  });
  it('adding a factor to an enrolled account needs a fresh step-up', async () => {
    const old = await h.session(f.coord, { mfaAgeMs: 10 * 60_000 });
    for (const path of ['/api/v1/auth/enrol/totp', '/api/v1/auth/enrol/totp/confirm', '/api/v1/auth/enrol/webauthn/options']) {
      const r = await h.call(old, 'POST', path, path.endsWith('confirm') ? { body: { code: '123456' } } : {});
      expect(r.status, path).toBe(401); expect(r.json.code, path).toBe('STEP_UP_REQUIRED');
    }
    const fresh = await h.session(f.coord);
    expect((await h.call(fresh, 'POST', '/api/v1/auth/enrol/webauthn/options')).status).toBe(200);
  });
  it('passkey registration options are issued for the signed-in user', async () => {
    const s = await h.session(f.coord);
    const r = await h.call(s, 'POST', '/api/v1/auth/enrol/webauthn/options');
    expect(r.status, r.body).toBe(200); expect(r.json.rp.id).toBe('localhost'); expect(r.json.authenticatorSelection.userVerification).toBe('required'); expect(r.json.attestation).toBe('none');
  });
});

describe('researcher self-registration with coordinator approval (ASSUMPTION-03)', () => {
  it('register -> verify email -> pending -> approve -> login', async () => {
    const b = browser(); await bootstrap(b);
    const email = `new.researcher.${Date.now()}@example.invalid`; const password = 'a-long-unique-passphrase-9';
    const weak = await b.req('POST', '/api/v1/auth/register', { email, password: 'short', displayName: 'Synthetic New', institution: 'Synthetic University', termsVersion: '2026-01', isIsraeliAcademic: true });
    expect(weak.status).toBe(422);
    const r = await b.req('POST', '/api/v1/auth/register', { email, password, displayName: 'Synthetic New', institution: 'Synthetic University', termsVersion: '2026-01', isIsraeliAcademic: true });
    expect(r.status, JSON.stringify(r.json)).toBe(202);
    const dup = await b.req('POST', '/api/v1/auth/register', { email, password, displayName: 'Synthetic New', institution: 'Synthetic University', termsVersion: '2026-01', isIsraeliAcademic: true });
    expect(dup.status).toBe(202);                     // same answer for an existing address
    await h.worker.tick();
    const mail = h.mailer.sent.find((m) => m.to === email)!; expect(mail).toBeTruthy();
    const token = /token=([^\s]+)/.exec(mail.text)![1]!;
    expect((await b.req('POST', '/api/v1/auth/login', { email, password })).status).toBe(401);     // not approved yet
    expect((await b.req('POST', '/api/v1/auth/verify-email', { token: 'x'.repeat(30) })).status).toBe(422);
    expect((await b.req('POST', '/api/v1/auth/verify-email', { token })).status).toBe(204);
    const co = await h.session(f.coord);
    const pend = await h.call(co, 'GET', '/api/v1/registrations'); // step-up is fresh in h.session
     expect(pend.status, pend.body).toBe(200);
    const row = pend.json.items.find((x: any) => x.email === email); expect(row).toBeTruthy();
    expect(row.institution).toBe('Synthetic University'); expect(row.status).toBe('pending');
    const ap = await h.call(co, 'POST', `/api/v1/registrations/${row.id}/decision`, { body: { outcome: 'approved' } }); expect(ap.status, ap.body).toBe(200);
    expect(ap.json.status).toBe('approved');
    const l = await b.req('POST', '/api/v1/auth/login', { email, password }); expect(l.status).toBe(200); expect(l.json.enrollmentRequired).toBe(true);
    // a researcher cannot approve anybody
    const res = await h.session(f.resIl); expect((await h.call(res, 'POST', `/api/v1/registrations/${row.id}/decision`, { body: { outcome: 'approved' } })).status).toBe(403);
  });
});
