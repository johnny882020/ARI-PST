// RFC 6238 TOTP (HMAC-SHA1, 30 s step, 6 digits) with RFC 4648 base32. No third-party library.
import { createHmac, randomBytes } from 'node:crypto';
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buf: Uint8Array): string {
  let bits = 0, value = 0, out = '';
  for (const b of buf) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s: string): Buffer {
  let bits = 0, value = 0; const out: number[] = [];
  for (const ch of s.replace(/=+$/, '').toUpperCase()) {
    const i = B32.indexOf(ch); if (i < 0) throw new Error('bad base32');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
export const newTotpSecret = (): string => base32Encode(randomBytes(20));
export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', secret).update(buf).digest();
  const off = h[h.length - 1]! & 0xf;
  const code = ((h[off]! & 0x7f) << 24) | (h[off + 1]! << 16) | (h[off + 2]! << 8) | h[off + 3]!;
  return String(code % 10 ** digits).padStart(digits, '0');
}
export const totpStep = (nowMs: number, period = 30): number => Math.floor(nowMs / 1000 / period);
export function totpAt(secretB32: string, nowMs: number): string { return hotp(base32Decode(secretB32), totpStep(nowMs)); }
/** Returns the matched time step (for replay protection) or null. Window: +/- 1 step. */
export function totpVerify(secretB32: string, code: string, nowMs: number, lastUsedStep = -1): number | null {
  if (!/^[0-9]{6}$/.test(code)) return null;
  const secret = base32Decode(secretB32); const cur = totpStep(nowMs);
  for (const d of [0, -1, 1]) {
    const step = cur + d;
    if (step <= lastUsedStep) continue;
    if (hotp(secret, step) === code) return step;
  }
  return null;
}
export function otpauthUri(secretB32: string, label: string, issuer = 'ARI-PST Portal'): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
