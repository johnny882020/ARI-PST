// Seeded PRNG (mulberry32). Never use Math.random() in this package.
export interface Rng {
  next(): number;
  int(maxExclusive: number): number;
  pick<T>(items: readonly T[]): T;
  weighted<T>(items: readonly (readonly [T, number])[]): T;
  chance(p: number): boolean;
}
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number): number => Math.floor(next() * n);
  return {
    next,
    int,
    pick: <T>(items: readonly T[]): T => items[int(items.length)] as T,
    weighted: <T>(items: readonly (readonly [T, number])[]): T => {
      const total = items.reduce((s, [, w]) => s + w, 0);
      let r = next() * total;
      for (const [v, w] of items) { r -= w; if (r < 0) return v; }
      return items[items.length - 1]![0];
    },
    chance: (p: number): boolean => next() < p,
  };
}
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** Prefixed ULID-shaped id (26 Crockford chars). Random, not time-based, so it is deterministic per seed. */
export function makeId(rng: Rng, prefix: string): string {
  let s = '';
  for (let i = 0; i < 26; i++) s += CROCKFORD[rng.int(32)];
  return `${prefix}_${s}`;
}
export function hex32(rng: Rng): string {
  let s = '';
  for (let i = 0; i < 32; i++) s += '0123456789abcdef'[rng.int(16)];
  return s;
}
