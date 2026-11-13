/**
 * The ONLY module allowed to touch browser storage. Non-sensitive UI preferences only,
 * checked against an allow-list. Every access is wrapped: storage may be blocked or throw.
 */
const ALLOWED = {
  "ui.theme": ["light", "dark", "system"],
  "ui.locale": ["he", "en"],
  "ui.density": ["comfortable", "compact"],
  "ui.sidebarCollapsed": ["true", "false"],
} as const;

export type UiPrefKey = keyof typeof ALLOWED;

export function readPref(key: UiPrefKey): string | null {
  try {
    const v = globalThis.localStorage?.getItem(key) ?? null;
    return v !== null && (ALLOWED[key] as readonly string[]).includes(v) ? v : null;
  } catch {
    return null;
  }
}

export function writePref(key: UiPrefKey, value: string): void {
  if (!(ALLOWED[key] as readonly string[]).includes(value)) return;
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    /* storage blocked: preference lasts for this page view only */
  }
}
