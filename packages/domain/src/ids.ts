// Entity IDs: 3-letter prefix + "_" + 26-char ULID (Crockford base32). Contract pack section 8.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const ID_PREFIXES = {
  user: 'usr', center: 'ctr', sample: 'smp', request: 'req', requestItem: 'rit', step: 'stp',
  decision: 'dec', vote: 'vot', role: 'rol', ethics: 'eth', import: 'imp', audit: 'aud', outbox: 'out',
} as const;
export type IdKind = keyof typeof ID_PREFIXES;
export const ULID_RE = '[0-9A-HJKMNP-TV-Z]{26}';
export function idPattern(kind: IdKind): RegExp { return new RegExp(`^${ID_PREFIXES[kind]}_${ULID_RE}$`); }
export function isId(kind: IdKind, v: unknown): v is string { return typeof v === 'string' && idPattern(kind).test(v); }

export type RandomBytes = (n: number) => Uint8Array;
const defaultRandom: RandomBytes = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

/** 48-bit time + 80-bit randomness, Crockford base32. Monotonic ordering is not guaranteed within one ms. */
export function ulid(nowMs: number, rand: RandomBytes = defaultRandom): string {
  let t = nowMs; let time = '';
  for (let i = 0; i < 10; i++) { time = CROCKFORD[t % 32] + time; t = Math.floor(t / 32); }
  const r = rand(16); let rnd = '';
  for (let i = 0; i < 16; i++) rnd += CROCKFORD[(r[i] ?? 0) & 31];
  return time + rnd;
}
export function newId(kind: IdKind, nowMs: number, rand?: RandomBytes): string {
  return `${ID_PREFIXES[kind]}_${ulid(nowMs, rand)}`;
}
