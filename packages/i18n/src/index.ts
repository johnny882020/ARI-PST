import he from "../messages/he.json";
import en from "../messages/en.json";

export const locales = ["he", "en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "he";

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;

export const messages: Record<Locale, Messages> = {
  he: he as Messages,
  en: en as Messages,
};

export function dirFor(locale: Locale): "rtl" | "ltr" {
  return locale === "he" ? "rtl" : "ltr";
}

export function isLocale(v: unknown): v is Locale {
  return v === "he" || v === "en";
}

/** Key shape: area.screen.element (lowerCamel segments, 2+ segments). */
export const KEY_PATTERN = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9_]+)+$/;

/** Locale of a browser Accept-Language style value; falls back to the default (he). */
export function negotiateLocale(preferred: readonly string[] | undefined): Locale {
  for (const p of preferred ?? []) {
    const base = p.toLowerCase().split("-")[0];
    if (base === "he" || base === "iw") return "he";
    if (base === "en") return "en";
  }
  return defaultLocale;
}
