// k-anonymity helpers. The counting itself runs in the database (search functions). This is the pure policy.
export const K_FLOOR = 5;
export const K_DEFAULT = 5;
export function validateK(k: number): boolean { return Number.isInteger(k) && k >= K_FLOOR && k <= 100; }
/** UI text. The portal shows "Too few to show" and never the threshold (decision C-09). The label is for logs only. */
export const TOO_FEW_LABEL = 'too_few';
export function displayLabel(n: number | null, k: number, suppressed: boolean): string {
  if (suppressed || n === null || n < k) return TOO_FEW_LABEL;
  return String(n);
}
