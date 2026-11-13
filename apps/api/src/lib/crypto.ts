import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');
export const sha256Hex = (v: string | Uint8Array): string => createHash('sha256').update(v).digest('hex');
export const sha256Buf = (v: string | Uint8Array): Buffer => createHash('sha256').update(v).digest();
export const hmacHex = (key: string, v: string): string => createHmac('sha256', key).update(v).digest('hex');
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
/** Salted hash of an IP. The raw address is never stored or logged. */
export const ipHash = (salt: string, ip: string): string => hmacHex(salt, ip).slice(0, 32);
