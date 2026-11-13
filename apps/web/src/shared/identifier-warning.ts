/** Client-side hint only (non-blocking). The server does the real identifier check. */
export function looksIdentifying(text: string): boolean {
  if (/\b\d{9}\b/.test(text)) return true; // 9-digit ID-like sequence
  if (/[\w.+-]+@[\w-]+\.[\w.-]+/.test(text)) return true; // e-mail-like
  if (/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/.test(text)) return true; // exact date
  return false;
}
