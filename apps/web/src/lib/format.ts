import type { Locale } from "@ari/i18n";

const TZ = "Asia/Jerusalem";

export function fmtDate(iso: string | null | undefined, locale: Locale): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", { dateStyle: "medium", timeZone: TZ }).format(d);
}

export function fmtDateTime(iso: string | null | undefined, locale: Locale): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: TZ }).format(d);
}

/** collection_month is YYYY-MM only: show month + year. */
export function fmtMonth(ym: string, locale: Locale): string {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return ym;
  return new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)),
  );
}

export function fmtNumber(n: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === "he" ? "he-IL" : "en-GB").format(n);
}

export function fmtRemaining(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
