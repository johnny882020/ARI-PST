// Local-accounts AuthPort: Argon2id passwords, TOTP, WebAuthn passkeys, recovery codes, server-side sessions.
// Tables live in schema authn (db-support/0010_api_support.sql). Session ids are random 256-bit tokens; only their SHA-256 is stored.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { EMAIL_TOKEN_PURPOSES, type AuthPort, type Clock, type EmailTokenPurpose, type MfaFactor, type RoleAssignmentRecord, type SessionRecord } from '@ari/domain';
import { randomToken, sha256Buf } from '../../lib/crypto.js';
import { PasswordHasher, passwordPolicy } from './password.js';
import { newTotpSecret, otpauthUri, totpVerify } from './totp.js';

export interface AuthOptions { rpId: string; rpName: string; origin: string; secretsKey: string; argon: { memoryCost: number; timeCost: number; parallelism: number } }
const MAX_FAILS = 5; const LOCK_MS = 15 * 60_000; const CHALLENGE_MS = 5 * 60_000; const INVITE_MS = 7 * 86_400_000;
const DUMMY_HASH_PW = 'dummy-password-for-constant-time';
/** authn.challenges.kind for an e-mail token. The kind equals the purpose; an unknown purpose throws (never a silent default). */
function emailKind(purpose: EmailTokenPurpose): EmailTokenPurpose {
  if (!EMAIL_TOKEN_PURPOSES.includes(purpose)) throw new Error('unknown e-mail token purpose');
  return purpose;
}

export class PgAuth implements AuthPort {
  private hasher: PasswordHasher; private key: Buffer; private dummy: Promise<string>;
  constructor(private pool: pg.Pool, private opt: AuthOptions, private clock: Clock) {
    this.hasher = new PasswordHasher(opt.argon);
    this.key = createHash('sha256').update('ari-pst-secrets-v1:' + opt.secretsKey).digest();
    this.dummy = this.hasher.hash(DUMMY_HASH_PW);
  }
  private q = (text: string, params: unknown[] = []) => this.pool.query<Record<string, any>>(text, params);
  private enc(v: string): string { const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', this.key, iv, { authTagLength: 16 }); const b = Buffer.concat([c.update(v, 'utf8'), c.final()]); return [iv, c.getAuthTag(), b].map((x) => x.toString('base64url')).join('.'); }
  private dec(v: string): string { const [iv, tag, b] = v.split('.').map((x) => Buffer.from(x, 'base64url')); if (!iv || iv.length !== 12 || !tag || tag.length !== 16 || !b) throw new Error('bad ciphertext'); const d = createDecipheriv('aes-256-gcm', this.key, iv, { authTagLength: 16 }); d.setAuthTag(tag); return Buffer.concat([d.update(b), d.final()]).toString('utf8'); }
  private now(): number { return this.clock.now().getTime(); }

  // ----- passwords -----
  hashPassword(pw: string) { return this.hasher.hash(pw); }
  checkPasswordPolicy(pw: string, email?: string) { return passwordPolicy(pw, email); }
  async storePasswordHash(userId: string, hash: string) {
    await this.q(`INSERT INTO authn.credentials (user_id, password_hash) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash, password_changed_at = now(), failed_count = 0, locked_until = NULL`, [userId, hash]);
  }
  async setPassword(userId: string, pw: string) { await this.storePasswordHash(userId, await this.hasher.hash(pw)); }
  async verifyPassword(email: string, password: string) {
    const u = (await this.q('SELECT user_id, status, email_verified FROM authn.find_login($1)', [email.toLowerCase()])).rows[0];
    const cred = u ? (await this.q('SELECT password_hash, failed_count, locked_until FROM authn.credentials WHERE user_id = $1', [u.user_id])).rows[0] : undefined;
    if (!u || !cred || u.status !== 'active' || !u.email_verified) { await this.hasher.verify(await this.dummy, password); return null; }
    if (cred.locked_until && new Date(cred.locked_until).getTime() > this.now()) { await this.hasher.verify(await this.dummy, password); return { locked: true as const }; }
    const ok = await this.hasher.verify(cred.password_hash, password);
    if (!ok) {
      const lock = cred.failed_count + 1 >= MAX_FAILS;
      await this.q('UPDATE authn.credentials SET failed_count = CASE WHEN $2 THEN 0 ELSE failed_count + 1 END, locked_until = CASE WHEN $2 THEN now() + ($3 || \' milliseconds\')::interval ELSE locked_until END WHERE user_id = $1', [u.user_id, lock, String(LOCK_MS)]);
      return null;
    }
    await this.q('UPDATE authn.credentials SET failed_count = 0, locked_until = NULL WHERE user_id = $1', [u.user_id]);
    return { userId: u.user_id as string, mfaFactors: await this.mfaFactorsFor(u.user_id), locked: false };
  }
  // ----- factors -----
  async mfaFactorsFor(userId: string): Promise<MfaFactor[]> {
    const t = (await this.q('SELECT totp_confirmed_at FROM authn.credentials WHERE user_id = $1', [userId])).rows[0];
    const w = (await this.q('SELECT 1 FROM authn.webauthn_credentials WHERE user_id = $1 LIMIT 1', [userId])).rows.length;
    const out: MfaFactor[] = []; if (t?.totp_confirmed_at) out.push('totp'); if (w) out.push('webauthn'); return out;
  }
  async hasMfa(userId: string) { return (await this.mfaFactorsFor(userId)).length > 0; }
  async totpBegin(userId: string, label: string) {
    const secret = newTotpSecret();
    await this.q('UPDATE authn.credentials SET totp_pending_enc = $2 WHERE user_id = $1', [userId, this.enc(secret)]);
    return { secretBase32: secret, otpauthUri: otpauthUri(secret, label, this.opt.rpName) };
  }
  /** Synthetic seed only (jobs/seed-synthetic.ts): stores a confirmed TOTP secret without the enrolment ceremony. */
  async seedTotpSecret(userId: string, secretBase32: string) {
    await this.q('UPDATE authn.credentials SET totp_secret_enc = $2, totp_pending_enc = NULL, totp_confirmed_at = now(), totp_last_step = -1 WHERE user_id = $1', [userId, this.enc(secretBase32)]);
  }
  async totpConfirm(userId: string, code: string) {
    const r = (await this.q('SELECT totp_pending_enc FROM authn.credentials WHERE user_id = $1', [userId])).rows[0];
    if (!r?.totp_pending_enc) return false;
    const step = totpVerify(this.dec(r.totp_pending_enc), code, this.now());
    if (step === null) return false;
    await this.q('UPDATE authn.credentials SET totp_secret_enc = totp_pending_enc, totp_pending_enc = NULL, totp_confirmed_at = now(), totp_last_step = $2 WHERE user_id = $1', [userId, step]);
    return true;
  }
  async totpVerify(userId: string, code: string) {
    const r = (await this.q('SELECT totp_secret_enc, totp_last_step FROM authn.credentials WHERE user_id = $1 AND totp_confirmed_at IS NOT NULL', [userId])).rows[0];
    if (!r?.totp_secret_enc) return false;
    const step = totpVerify(this.dec(r.totp_secret_enc), code, this.now(), Number(r.totp_last_step));
    if (step === null) return false;
    const u = await this.q('UPDATE authn.credentials SET totp_last_step = $2 WHERE user_id = $1 AND totp_last_step < $2', [userId, step]);   // replay protection
    return (u.rowCount ?? 0) > 0;
  }
  async issueRecoveryCodes(userId: string) {
    const codes = Array.from({ length: 10 }, () => { const h = randomBytes(8).toString('hex'); return `${h.slice(0, 8)}-${h.slice(8, 16)}`; });
    await this.q('DELETE FROM authn.recovery_codes WHERE user_id = $1', [userId]);
    for (const c of codes) await this.q('INSERT INTO authn.recovery_codes (user_id, code_hash) VALUES ($1,$2)', [userId, sha256Buf(c)]);
    return codes;
  }
  async useRecoveryCode(userId: string, code: string) {
    const r = await this.q('UPDATE authn.recovery_codes SET used_at = now() WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL', [userId, sha256Buf(code.trim().toLowerCase())]);
    return (r.rowCount ?? 0) > 0;
  }
  // ----- WebAuthn -----
  private async putChallenge(key: string, userId: string, kind: string, webauthn: string | null, ms: number) {
    await this.q(`INSERT INTO authn.challenges (token_hash, user_id, kind, webauthn_challenge, expires_at) VALUES ($1,$2,$3,$4, now() + ($5 || ' milliseconds')::interval)
                  ON CONFLICT (token_hash) DO UPDATE SET webauthn_challenge = EXCLUDED.webauthn_challenge, expires_at = EXCLUDED.expires_at, attempts = 0`, [sha256Buf(key), userId, kind, webauthn, String(ms)]);
  }
  async webauthnRegistrationOptions(userId: string, userName: string) {
    const existing = (await this.q('SELECT credential_id, transports FROM authn.webauthn_credentials WHERE user_id = $1', [userId])).rows;
    const o = await generateRegistrationOptions({
      rpName: this.opt.rpName, rpID: this.opt.rpId, userName, userID: new TextEncoder().encode(userId), attestationType: 'none',
      authenticatorSelection: { userVerification: 'required', residentKey: 'preferred' },
      excludeCredentials: existing.map((c) => ({ id: c.credential_id, transports: c.transports ?? undefined })),
    });
    await this.putChallenge(`wa-reg:${userId}`, userId, 'webauthn_reg', o.challenge, CHALLENGE_MS);
    return o as unknown as Record<string, unknown>;
  }
  private async takeChallenge(key: string, kind: string): Promise<string | null> {
    const r = await this.q('DELETE FROM authn.challenges WHERE token_hash = $1 AND kind = $2 AND expires_at > now() RETURNING webauthn_challenge', [sha256Buf(key), kind]);
    return r.rows[0]?.webauthn_challenge ?? null;
  }
  async webauthnRegistrationVerify(userId: string, response: unknown, name = 'Passkey') {
    const expected = await this.takeChallenge(`wa-reg:${userId}`, 'webauthn_reg'); if (!expected) return false;
    try {
      const v = await verifyRegistrationResponse({ response: response as never, expectedChallenge: expected, expectedOrigin: this.opt.origin, expectedRPID: this.opt.rpId, requireUserVerification: true });
      if (!v.verified || !v.registrationInfo) return false;
      const c = v.registrationInfo.credential;
      await this.q('INSERT INTO authn.webauthn_credentials (credential_id, user_id, public_key, counter, transports, name) VALUES ($1,$2,$3,$4,$5,$6)', [c.id, userId, Buffer.from(c.publicKey), c.counter, c.transports ?? null, name.slice(0, 60)]);
      return true;
    } catch { return false; }
  }
  async webauthnAuthOptions(userId: string) {
    const creds = (await this.q('SELECT credential_id, transports FROM authn.webauthn_credentials WHERE user_id = $1', [userId])).rows;
    const o = await generateAuthenticationOptions({ rpID: this.opt.rpId, userVerification: 'required', allowCredentials: creds.map((c) => ({ id: c.credential_id, transports: c.transports ?? undefined })) });
    await this.putChallenge(`wa-auth:${userId}`, userId, 'webauthn_auth', o.challenge, CHALLENGE_MS);
    return o as unknown as Record<string, unknown>;
  }
  async webauthnAuthVerify(userId: string, response: unknown) {
    const expected = await this.takeChallenge(`wa-auth:${userId}`, 'webauthn_auth'); if (!expected) return false;
    const id = (response as { id?: string })?.id; if (typeof id !== 'string') return false;
    const c = (await this.q('SELECT credential_id, public_key, counter, transports FROM authn.webauthn_credentials WHERE user_id = $1 AND credential_id = $2', [userId, id])).rows[0];
    if (!c) return false;
    try {
      const v = await verifyAuthenticationResponse({ response: response as never, expectedChallenge: expected, expectedOrigin: this.opt.origin, expectedRPID: this.opt.rpId, requireUserVerification: true,
        credential: { id: c.credential_id, publicKey: new Uint8Array(c.public_key), counter: Number(c.counter), transports: c.transports ?? undefined } });
      if (!v.verified) return false;
      await this.q('UPDATE authn.webauthn_credentials SET counter = $2, last_used_at = now() WHERE credential_id = $1', [id, v.authenticationInfo.newCounter]);
      return true;
    } catch { return false; }
  }
  // ----- login challenge and invite tokens -----
  async createChallenge(userId: string) { const t = randomToken(24); await this.putChallenge(t, userId, 'login', null, CHALLENGE_MS); return t; }
  async consumeChallenge(token: string, peek = false) {
    const h = sha256Buf(token);
    const r = peek
      ? await this.q(`SELECT user_id, attempts FROM authn.challenges WHERE token_hash = $1 AND kind = 'login' AND expires_at > now()`, [h])
      : await this.q(`DELETE FROM authn.challenges WHERE token_hash = $1 AND kind = 'login' AND expires_at > now() RETURNING user_id, attempts`, [h]);
    return r.rows[0] ? { userId: r.rows[0].user_id as string, attempts: r.rows[0].attempts as number } : null;
  }
  async failChallenge(token: string) { await this.q(`UPDATE authn.challenges SET attempts = attempts + 1 WHERE token_hash = $1`, [sha256Buf(token)]); }
  /** R-08: the purpose is the stored kind, and consume matches it. A token issued for one purpose never consumes for another.
   *  Kinds 'verify' and 'password_reset' need migration 0016 (CHECK on authn.challenges.kind). */
  async issueEmailToken(userId: string, purpose: EmailTokenPurpose) { const t = randomToken(24); await this.putChallenge(t, userId, emailKind(purpose), null, INVITE_MS); return t; }
  async consumeEmailToken(token: string, purpose: EmailTokenPurpose) {
    const r = await this.q(`DELETE FROM authn.challenges WHERE token_hash = $1 AND kind = $2 AND expires_at > now() RETURNING user_id`, [sha256Buf(token), emailKind(purpose)]);
    return (r.rows[0]?.user_id as string) ?? null;
  }
  // ----- sessions -----
  async createSession(userId: string, o: { mfaAt: number | null; ipHash: string | null; roles: RoleAssignmentRecord[]; displayName: string; locale: 'he' | 'en' }): Promise<SessionRecord> {
    const id = randomToken(32); const csrf = randomToken(24); const now = this.now();
    await this.q('INSERT INTO authn.sessions (id_hash, user_id, created_at, last_seen_at, mfa_at, ip_hash, csrf_token, roles, display_name, locale) VALUES ($1,$2,$3,$3,$4,$5,$6,$7::jsonb,$8,$9)',
      [sha256Buf(id), userId, new Date(now).toISOString(), o.mfaAt === null ? null : new Date(o.mfaAt).toISOString(), o.ipHash, csrf, JSON.stringify(o.roles), o.displayName, o.locale]);
    return { id, userId, createdAt: now, lastSeenAt: now, mfaAt: o.mfaAt, ipHash: o.ipHash, csrfToken: csrf, roles: o.roles, displayName: o.displayName, locale: o.locale };
  }
  async getSession(id: string): Promise<SessionRecord | null> {
    const r = (await this.q('SELECT * FROM authn.sessions WHERE id_hash = $1 AND revoked_at IS NULL', [sha256Buf(id)])).rows[0];
    if (!r) return null;
    return { id, userId: r.user_id, createdAt: new Date(r.created_at).getTime(), lastSeenAt: new Date(r.last_seen_at).getTime(), mfaAt: r.mfa_at ? new Date(r.mfa_at).getTime() : null, ipHash: r.ip_hash, csrfToken: r.csrf_token, roles: r.roles, displayName: r.display_name, locale: r.locale };
  }
  async touchSession(id: string, now: number) { await this.q('UPDATE authn.sessions SET last_seen_at = $2 WHERE id_hash = $1', [sha256Buf(id), new Date(now).toISOString()]); }
  async stepUpSession(id: string, now: number) { await this.q('UPDATE authn.sessions SET mfa_at = $2 WHERE id_hash = $1', [sha256Buf(id), new Date(now).toISOString()]); }
  async rotateSession(): Promise<SessionRecord | null> { return null; }
  async revokeSession(id: string) { await this.q('UPDATE authn.sessions SET revoked_at = now() WHERE id_hash = $1', [sha256Buf(id)]); }
  async revokeAllForUser(userId: string) { await this.q('UPDATE authn.sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]); }
  async listMethods(userId: string) {
    const out: Array<{ id: string; kind: 'passkey' | 'totp'; name: string; addedAt: string; lastUsedAt: string | null }> = [];
    const t = (await this.q('SELECT totp_confirmed_at FROM authn.credentials WHERE user_id = $1 AND totp_confirmed_at IS NOT NULL', [userId])).rows[0];
    if (t) out.push({ id: 'totp', kind: 'totp', name: 'Authenticator app', addedAt: new Date(t.totp_confirmed_at).toISOString(), lastUsedAt: null });
    for (const w of (await this.q('SELECT credential_id, name, created_at, last_used_at FROM authn.webauthn_credentials WHERE user_id = $1 ORDER BY created_at', [userId])).rows)
      out.push({ id: w.credential_id, kind: 'passkey', name: w.name, addedAt: new Date(w.created_at).toISOString(), lastUsedAt: w.last_used_at ? new Date(w.last_used_at).toISOString() : null });
    return out;
  }
  async saveRegistrationMeta(userId: string, institution: string, termsVersion: string | null) {
    await this.q('INSERT INTO authn.registration_meta (user_id, institution, terms_version) VALUES ($1,$2,$3) ON CONFLICT (user_id) DO NOTHING', [userId, institution, termsVersion]);
  }
  // ----- profile -----
  async recordLoginSuccess(userId: string) { await this.q('SELECT authn.touch_login($1)', [userId]); }
  async activeRolesFor(userId: string): Promise<RoleAssignmentRecord[]> {
    return (await this.q('SELECT id, role, center_id, granted_at FROM authn.user_roles($1)', [userId])).rows.map((r) => ({ id: r.id, role: r.role, centerId: r.center_id ?? null, grantedAt: new Date(r.granted_at).toISOString() }));
  }
  async profileFor(userId: string) { const r = (await this.q('SELECT email, display_name, locale FROM authn.profile($1)', [userId])).rows[0]; return r ? { email: r.email as string, displayName: r.display_name as string, locale: r.locale as 'he' | 'en' } : null; }
  async markEmailVerified(userId: string, activate: boolean) { await this.q('SELECT authn.set_verified($1,$2)', [userId, activate]); }
}
