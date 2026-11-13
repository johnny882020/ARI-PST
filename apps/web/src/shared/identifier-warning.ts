import type { MessageKey } from "@ari/i18n";

/**
 * Client-side identifier guard for free text. It blocks the form before anything is sent.
 * The rules mirror the server guards G1..G5 in `packages/domain/src/identifier-guard.ts`
 * (same patterns, same order, same normalisation). The server check stays the real control;
 * keep the two lists in step. The matched text is never returned, logged or stored.
 */
export type IdentifierKind = "idNumber" | "phone" | "email" | "date" | "digits";

const GUARDS: ReadonlyArray<{ kind: IdentifierKind; re: RegExp }> = [
  { kind: "idNumber", re: /(?<![0-9])[0-9]{9}(?![0-9])/ }, // G1: 9-digit run (national ID shape)
  { kind: "phone", re: /(?<![0-9])(\+?972|0)[- ]?[0-9]{1,2}[- ]?[0-9]{3}[- ]?[0-9]{4}(?![0-9])/ }, // G2
  { kind: "email", re: /[^\s@]+@[^\s@]+\.[^\s@]+/ }, // G3
  { kind: "date", re: /(?<![0-9])([0-9]{1,2}[./-][0-9]{1,2}[./-][0-9]{2,4}|[0-9]{4}-[0-9]{2}-[0-9]{2})(?![0-9])/ }, // G4: exact date
  { kind: "digits", re: /(?<![0-9])[0-9]{7,}(?![0-9])/ }, // G5: long digit run
];

/** Unicode digits (Arabic-Indic, fullwidth) and zero-width / bidi marks cannot hide a pattern. */
export function normalizeForScan(v: string): string {
  return v
    .normalize("NFKC")
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "");
}

/** First rule that matches, or null. */
export function identifierKind(text: string | null | undefined): IdentifierKind | null {
  if (!text) return null;
  const s = normalizeForScan(text);
  for (const g of GUARDS) if (g.re.test(s)) return g.kind;
  return null;
}

export function looksIdentifying(text: string | null | undefined): boolean {
  return identifierKind(text) !== null;
}

const MESSAGE: Record<IdentifierKind, MessageKey> = {
  idNumber: "form.error.identifier.idNumber",
  phone: "form.error.identifier.phone",
  email: "form.error.identifier.email",
  date: "form.error.identifier.date",
  digits: "form.error.identifier.digits",
};

/** i18n key of the message for this text, or undefined when the text is clean. */
export function identifierMessageKey(text: string | null | undefined): MessageKey | undefined {
  const k = identifierKind(text);
  return k ? MESSAGE[k] : undefined;
}
