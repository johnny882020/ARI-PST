/**
 * Link-out from a coded record to the center's own system (two-step coding: the center resolves the code locally).
 * Configured at build time with VITE_CENTER_SYSTEM_URL_TEMPLATE, for example
 *   https://records.center.example/lookup?code={sampleCode}&center={centerCode}
 * Safe default: no template (or an unsafe one) gives no link, and the page shows a labelled reference instead.
 * Only https URLs are allowed. Values are URL-encoded. Only the coded sample id and the center code are ever put in the URL.
 */
export function centerSystemUrl(template: string | undefined | null, v: { sampleCode: string; centerCode: string }): string | null {
  if (!template || typeof template !== "string") return null;
  const filled = template.trim()
    .replace(/\{sampleCode\}/g, encodeURIComponent(v.sampleCode))
    .replace(/\{centerCode\}/g, encodeURIComponent(v.centerCode));
  if (/[{}]/.test(filled)) return null;   // unknown placeholder
  let u: URL;
  try { u = new URL(filled); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password) return null;
  return u.toString();
}

export const CENTER_SYSTEM_URL_TEMPLATE: string | undefined = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_CENTER_SYSTEM_URL_TEMPLATE;
