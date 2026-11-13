// Identifier guards G1..G6 (plan/03-data-integration/yaml/import-columns.yaml). REQ-042: no direct identifiers, ever.
// A hit rejects the value. The value itself is never returned, logged or stored.
export type GuardId = 'G1' | 'G2' | 'G3' | 'G4' | 'G5' | 'G6';
export const GUARDS: ReadonlyArray<{ id: GuardId; name: string; re: RegExp | null }> = [
  { id: 'G1', name: 'israeli_id_like', re: /(?<![0-9])[0-9]{9}(?![0-9])/ },
  { id: 'G2', name: 'phone_like', re: /(?<![0-9])(\+?972|0)[- ]?[0-9]{1,2}[- ]?[0-9]{3}[- ]?[0-9]{4}(?![0-9])/ },
  { id: 'G3', name: 'email_like', re: /[^\s@]+@[^\s@]+\.[^\s@]+/ },
  { id: 'G4', name: 'full_date_like', re: /(?<![0-9])([0-9]{1,2}[./-][0-9]{1,2}[./-][0-9]{2,4}|[0-9]{4}-[0-9]{2}-[0-9]{2})(?![0-9])/ },
  { id: 'G5', name: 'long_digit_run', re: /(?<![0-9])[0-9]{7,}(?![0-9])/ },
  { id: 'G6', name: 'free_text_cell', re: null },
];
export const MAX_CELL_LENGTH = 64;
export interface ScanOptions { maxLength?: number | null }

/** Normalise unicode digits (Arabic-Indic, fullwidth) and strip zero-width/bidi marks so they cannot hide a pattern. */
export function normalizeForScan(v: string): string {
  return v
    .normalize('NFKC')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[​-‏‪-‮⁦-⁩﻿]/g, '');
}
/** Returns the first guard that matches, or null. maxLength null disables G6 (used for long applicant text). */
export function scanValue(value: unknown, opts: ScanOptions = {}): GuardId | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'bigint') return scanValue(String(value), opts);
  if (typeof value !== 'string') return null;
  const s = normalizeForScan(value);
  const max = opts.maxLength === undefined ? MAX_CELL_LENGTH : opts.maxLength;
  if (max !== null && s.length > max) return 'G6';
  for (const g of GUARDS) if (g.re && g.re.test(s)) return g.id;
  return null;
}
export function scanObjectDeep(obj: unknown, opts: ScanOptions = {}, path = ''): Array<{ field: string; guard: GuardId }> {
  const hits: Array<{ field: string; guard: GuardId }> = [];
  if (typeof obj === 'string' || typeof obj === 'number') {
    const g = scanValue(obj, opts); if (g) hits.push({ field: path || '$', guard: g });
  } else if (Array.isArray(obj)) {
    obj.forEach((v, i) => hits.push(...scanObjectDeep(v, opts, `${path}[${i}]`)));
  } else if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) hits.push(...scanObjectDeep(v, opts, path ? `${path}.${k}` : k));
  }
  return hits;
}
/** Israeli ID checksum (Luhn-like). Used only to raise confidence in tests; G1 rejects any 9-digit run regardless. */
export function israeliIdChecksumOk(id: string): boolean {
  if (!/^[0-9]{9}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) { let d = Number(id[i]) * ((i % 2) + 1); if (d > 9) d -= 9; sum += d; }
  return sum % 10 === 0;
}
