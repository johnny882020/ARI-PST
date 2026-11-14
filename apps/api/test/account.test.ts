// Account screens (KNOWN-ISSUES M-2): password reset, change password with step-up, recovery-code status. Synthetic users only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness, type TestUser } from './support/harness.js';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
// Send the queued mails, so that other test files that share this database find their own mail in the first outbox batch.
afterAll(async () => { while ((await h.worker.tick()) > 0) { /* drain */ } await h.close(); });

const RESET = '/api/v1/auth/password-reset/request';
const CONFIRM = '/api/v1/auth/password-reset/confirm';
const NEW_PW = 'a-new-synthetic-phrase-42';

async function resetMails(u: TestUser) {
  return (await h.admin.query(`SELECT template, locale, params FROM ops.notification_outbox WHERE to_user_id = $1 AND template = 'password_reset' ORDER BY created_at`, [u.id])).rows;
}
/** The request answers before the mail is queued (no timing signal), so tests wait for the outbox. */
async function settle(u: TestUser, want: number) {
  for (let i = 0; i < 100; i++) { const m = await resetMails(u); if (m.length >= want) break; await new Promise((r) => setTimeout(r, 20)); }
  await new Promise((r) => setTimeout(r, 100));
  return resetMails(u);
}
async function tokenFor(u: TestUser): Promise<string> {
  const before = (await resetMails(u)).length;
  const r = await h.call(null, 'POST', RESET, { body: { email: u.email } }); expect(r.status, r.body).toBe(202);
  const m = (await settle(u, before + 1)).pop(); expect(m).toBeDefined();
  const link = String(m.params.link); expect(link).toMatch(/\/reset-password\?token=/);
  return new URL(link).searchParams.get('token')!;
}
const live = async (u: TestUser) => (await h.admin.query(`SELECT count(*)::int n FROM authn.sessions WHERE user_id = $1 AND revoked_at IS NULL`, [u.id])).rows[0].n as number;
const audits = async (u: TestUser, action: string) => (await h.admin.query(`SELECT count(*)::int n FROM audit.audit_events WHERE (actor_user_id = $1 OR details->>'actor' = $1) AND action = $2`, [u.id, action])).rows[0].n as number;

describe('password reset', () => {
  it('answers 202 the same way for a known and an unknown address, and mails only the known one', async () => {
    const u = await h.seedUser('researcher_il', null, 'reset1');
    const known = await h.call(null, 'POST', RESET, { body: { email: u.email.toUpperCase() } });
    const unknown = await h.call(null, 'POST', RESET, { body: { email: 'nobody.reset@example.invalid' } });
    expect(known.status).toBe(202); expect(unknown.status).toBe(202);
    expect(known.json).toEqual(unknown.json);
    expect(Object.keys(known.headers).sort()).toEqual(Object.keys(unknown.headers).sort());
    const mails = await settle(u, 1); expect(mails).toHaveLength(1);
    expect(mails[0].params.link).toMatch(/^http:\/\/localhost:8080\/reset-password\?token=[\w-]{20,}$/);
    expect((await h.admin.query(`SELECT count(*)::int n FROM ops.notification_outbox WHERE to_email = 'nobody.reset@example.invalid'`)).rows[0].n).toBe(0);
  });
  it('mails nothing for a suspended account and still answers 202', async () => {
    const u = await h.seedUser('researcher_il', null, 'reset-susp');
    await h.admin.query(`UPDATE portal.users SET status = 'suspended' WHERE id = $1`, [u.id]);
    expect((await h.call(null, 'POST', RESET, { body: { email: u.email } })).status).toBe(202);
    expect(await settle(u, 1)).toHaveLength(0);
  });
  it('limits mails per address: more requests still answer 202 but queue no more mail', async () => {
    const u = await h.seedUser('researcher_il', null, 'reset-rate');
    for (let i = 0; i < 6; i++) expect((await h.call(null, 'POST', RESET, { body: { email: u.email } })).status).toBe(202);
    expect(await settle(u, 4)).toHaveLength(3);
  });
  it('confirm: sets the password, is single use, ends all sessions and writes an audit event', async () => {
    const u = await h.seedUser('national_coordinator', null, 'reset2');
    await h.session(u); await h.session(u); expect(await live(u)).toBe(2);
    const token = await tokenFor(u);
    // a weak password does not use up the token
    const weak = await h.call(null, 'POST', CONFIRM, { body: { token, password: 'aaaaaaaaaaaaaaaa' } });
    expect(weak.status).toBe(422); expect(weak.json.errors[0].field).toBe('password');
    const ok = await h.call(null, 'POST', CONFIRM, { body: { token, password: NEW_PW } }); expect(ok.status, ok.body).toBe(204);
    expect(await live(u)).toBe(0);
    expect(await audits(u, 'auth.password.reset')).toBe(1);
    const again = await h.call(null, 'POST', CONFIRM, { body: { token, password: NEW_PW + 'x' } });
    expect(again.status).toBe(422); expect(again.json.errors[0].field).toBe('token');
    const oldPw = await h.auth.verifyPassword(u.email, u.password); expect(oldPw).toBeNull();
    const newPw = await h.auth.verifyPassword(u.email, NEW_PW); expect(newPw && 'userId' in newPw).toBe(true);
  });
  it('a new request ends the older link; an expired token fails', async () => {
    const u = await h.seedUser('researcher_il', null, 'reset3');
    const first = await tokenFor(u); const second = await tokenFor(u);
    expect((await h.call(null, 'POST', CONFIRM, { body: { token: first, password: NEW_PW } })).status).toBe(422);
    await h.admin.query(`UPDATE authn.challenges SET expires_at = now() - interval '1 second' WHERE user_id = $1 AND kind = 'password_reset'`, [u.id]);
    expect((await h.call(null, 'POST', CONFIRM, { body: { token: second, password: NEW_PW } })).status).toBe(422);
  });
  it('the reset token lives 30 minutes and does not work as an invite token, and the other way round', async () => {
    const u = await h.seedUser('researcher_il', null, 'reset4');
    const token = await tokenFor(u);
    const ttl = (await h.admin.query(`SELECT extract(epoch FROM expires_at - now())::int s FROM authn.challenges WHERE user_id = $1 AND kind = 'password_reset'`, [u.id])).rows[0].s;
    expect(ttl).toBeGreaterThan(29 * 60); expect(ttl).toBeLessThanOrEqual(30 * 60);
    expect((await h.call(null, 'POST', '/api/v1/auth/verify-email', { body: { token, password: NEW_PW } })).status).toBe(422);
    const invite = await h.auth.issueEmailToken(u.id, 'invite');
    expect((await h.call(null, 'POST', CONFIRM, { body: { token: invite, password: NEW_PW } })).status).toBe(422);
    expect((await h.call(null, 'POST', CONFIRM, { body: { token, password: NEW_PW } })).status).toBe(204);
  });
  it('the reset mail renders in he and en and carries the link', async () => {
    const { renderTemplate } = await import('../src/modules/notifications/index.js');
    const en = renderTemplate('password_reset', 'en', { link: 'https://x.invalid/reset-password?token=t' });
    const he = renderTemplate('password_reset', 'he', { link: 'https://x.invalid/reset-password?token=t' });
    expect(en.text).toContain('https://x.invalid/reset-password?token=t'); expect(en.text).toContain('30 minutes');
    expect(he.text).toContain('https://x.invalid/reset-password?token=t'); expect(he.subject).not.toBe(en.subject);
  });
});

describe('change password and recovery codes', () => {
  it('change password needs a fresh step-up and ends the other sessions', async () => {
    const u = await h.seedUser('researcher_il', null, 'chpw');
    const stale = await h.session(u, { mfaAgeMs: 10 * 60_000 });
    const r = await h.call(stale, 'POST', '/api/v1/auth/password', { body: { currentPassword: u.password, newPassword: NEW_PW } });
    expect(r.status).toBe(401); expect(r.json.code).toBe('STEP_UP_REQUIRED');
    const fresh = await h.session(u);
    const wrong = await h.call(fresh, 'POST', '/api/v1/auth/password', { body: { currentPassword: 'not-the-password-1', newPassword: NEW_PW } });
    expect(wrong.status).toBe(422); expect(wrong.json.errors[0].field).toBe('currentPassword');
    const ok = await h.call(fresh, 'POST', '/api/v1/auth/password', { body: { currentPassword: u.password, newPassword: NEW_PW } });
    expect(ok.status, ok.body).toBe(204);
    expect((await h.call(stale, 'GET', '/api/v1/session')).status).toBe(401);
    expect(await live(u)).toBe(1);   // only the new session of this browser
  });
  it('recovery-code status counts unused codes and never returns a code; regenerating needs step-up', async () => {
    const u = await h.seedUser('committee_member', null, 'rc');
    const s = await h.session(u);
    expect((await h.call(s, 'GET', '/api/v1/auth/recovery-codes')).json).toEqual({ unused: 0 });
    const stale = await h.session(u, { mfaAgeMs: 10 * 60_000 });
    const denied = await h.call(stale, 'POST', '/api/v1/auth/recovery-codes'); expect(denied.status).toBe(401); expect(denied.json.code).toBe('STEP_UP_REQUIRED');
    const gen = await h.call(s, 'POST', '/api/v1/auth/recovery-codes'); expect(gen.status).toBe(200); expect(gen.json.recoveryCodes).toHaveLength(10);
    expect(await h.auth.useRecoveryCode(u.id, gen.json.recoveryCodes[0])).toBe(true);
    const st = await h.call(s, 'GET', '/api/v1/auth/recovery-codes'); expect(st.status).toBe(200); expect(st.json).toEqual({ unused: 9 });
    expect(await audits(u, 'auth.recovery.regenerate')).toBe(1);
  });
});
