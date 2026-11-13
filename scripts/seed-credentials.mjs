#!/usr/bin/env node
// Prints the sign-in list for the SYNTHETIC users that apps/api/src/jobs/seed-synthetic.ts creates.
//   SEED_USER_PASSWORD='<value from the Render Dashboard, service ari-api, Environment>' node scripts/seed-credentials.mjs
// Output: e-mail, role, the TOTP secret (base32, add it to an authenticator app) and the current 6-digit code.
// All users share SEED_USER_PASSWORD. Synthetic accounts only: they exist only where SEED_SYNTHETIC=true ran.
// Do not paste the output into tickets or chat.
import { createHmac } from 'node:crypto';
const pw = process.env.SEED_USER_PASSWORD;
if (!pw) { console.error('SEED_USER_PASSWORD is required'); process.exit(2); }
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const b32 = (buf) => { let bits = 0, v = 0, o = ''; for (const b of buf) { v = (v << 8) | b; bits += 8; while (bits >= 5) { o += B32[(v >>> (bits - 5)) & 31]; bits -= 5; } } return bits ? o + B32[(v << (5 - bits)) & 31] : o; };
const key = (email) => createHmac('sha256', pw).update('ari-pst-seed-totp:' + email).digest().subarray(0, 20);
const code = (k) => { const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000))); const h = createHmac('sha1', k).update(c).digest(); const o = h[19] & 15; return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0'); };
const USERS = [['admin.a', 'system_admin'], ['admin.b', 'system_admin'], ['coordinator.a', 'national_coordinator'], ['coordinator.b', 'national_coordinator'],
  ['committee.a', 'committee_member'], ['committee.b', 'committee_member'], ['committee.c', 'committee_member'],
  ['researcher.a', 'researcher_il'], ['researcher.b', 'researcher_il'], ['researcher.c', 'researcher_il'], ['intl.a', 'researcher_intl'],
  ['clinician.a', 'center_clinician'], ['clinician.b', 'center_clinician'], ['clinician.c', 'center_clinician (profile preview only)']];
console.log('password for every user: the value of SEED_USER_PASSWORD\n');
for (const [slug, role] of USERS) { const email = `synthetic.${slug}@example.invalid`; const k = key(email); console.log(`${email.padEnd(44)} ${role.padEnd(40)} totp ${b32(k)}  now ${code(k)}`); }
