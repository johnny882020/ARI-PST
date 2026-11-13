import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type HTMLAttributes,
  type ReactNode,
  type SVGProps,
} from "react";
import { defaultMessages, type Locale, type MessageKey } from "./messages";

export type { Locale, MessageKey } from "./messages";
export { defaultMessages } from "./messages";

export function cx(...parts: unknown[]): string {
  return parts.filter((p): p is string => typeof p === "string" && p !== "").join(" ");
}

/* ---------- Provider ---------- */
export interface DesignSystemContextValue {
  locale: Locale;
  dir: "rtl" | "ltr";
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
}

const Ctx = createContext<DesignSystemContextValue | null>(null);

function makeT(locale: Locale, overrides?: Partial<Record<Locale, Partial<Record<MessageKey, string>>>>) {
  return (key: MessageKey, vars?: Record<string, string | number>) => {
    const raw = overrides?.[locale]?.[key] ?? defaultMessages[locale][key] ?? defaultMessages.en[key] ?? key;
    return vars ? raw.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : raw;
  };
}

const fallbackValue: DesignSystemContextValue = { locale: "en", dir: "ltr", t: makeT("en") };

export interface DesignSystemProviderProps {
  locale: Locale;
  messages?: Partial<Record<Locale, Partial<Record<MessageKey, string>>>>;
  /** Also set lang and dir on <html>. Use once at the app root. */
  syncDocument?: boolean;
  children?: ReactNode;
}

export function DesignSystemProvider({ locale, messages, syncDocument, children }: DesignSystemProviderProps) {
  const dir = locale === "he" ? "rtl" : "ltr";
  const t = useMemo(() => makeT(locale, messages), [locale, messages]);
  const value = useMemo(() => ({ locale, dir, t }) as DesignSystemContextValue, [locale, dir, t]);
  useEffect(() => {
    if (!syncDocument) return;
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
  }, [syncDocument, locale, dir]);
  return (
    <Ctx.Provider value={value}>
      <div className="ds-root" lang={locale} dir={dir}>
        {children}
      </div>
    </Ctx.Provider>
  );
}

export function useDesignSystem(): DesignSystemContextValue {
  return useContext(Ctx) ?? fallbackValue;
}

/* ---------- Bidi helpers ---------- */
export function Bdi({ dir = "auto", ...rest }: HTMLAttributes<HTMLElement> & { dir?: "auto" | "ltr" | "rtl" }) {
  return <bdi dir={dir} {...rest} />;
}

/** Isolated left-to-right run: codes, ISO dates, numbers, e-mail, URLs. */
export function Ltr({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return <span dir="ltr" className={cx("ds-ltr", className)} {...rest} />;
}

/* ---------- Primitives ---------- */
export function VisuallyHidden({ children, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className="ds-vh" {...rest}>
      {children}
    </span>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg className="ds-spinner" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export type IconName =
  | "check"
  | "x"
  | "info"
  | "alert"
  | "search"
  | "sun"
  | "moon"
  | "globe"
  | "lock"
  | "chevron-start"
  | "chevron-end"
  | "arrow-up"
  | "arrow-down"
  | "sort"
  | "filter"
  | "menu"
  | "copy"
  | "dash";

const MIRROR: ReadonlySet<IconName> = new Set(["chevron-start", "chevron-end"]);

const PATHS: Record<IconName, ReactNode> = {
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5v.01" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3.5l9.5 16.5h-19z" />
      <path d="M12 10v4.5M12 17v.01" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" />
    </>
  ),
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  "chevron-start": <path d="M15 5l-7 7 7 7" />,
  "chevron-end": <path d="M9 5l7 7-7 7" />,
  "arrow-up": <path d="M12 19V5M6 11l6-6 6 6" />,
  "arrow-down": <path d="M12 5v14M6 13l6 6 6-6" />,
  sort: <path d="M8 9l4-4 4 4M8 15l4 4 4-4" />,
  filter: <path d="M4 6h16l-6 7v5l-4 2v-7z" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  copy: (
    <>
      <rect x="8" y="8" width="11" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h1" />
    </>
  ),
  dash: <path d="M6 12h12" />,
};

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  size?: number;
}

/** Decorative icon. Always pair it with text or an aria-label on the control. */
export function Icon({ name, size = 20, className, ...rest }: IconProps) {
  return (
    <svg
      className={cx("ds-icon", MIRROR.has(name) && "ds-icon-mirror", className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}

/* ---------- Theme ---------- */
export type Theme = "light" | "dark" | "system";
const THEME_KEY = "ari-theme";

function readStoredTheme(): Theme {
  try {
    const v = window.localStorage.getItem(THEME_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* storage unavailable: fall back to system */
  }
  return "system";
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore */
  }
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => (typeof window === "undefined" ? "system" : readStoredTheme()));
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
  }, [theme]);
  const set = useCallback((t: Theme) => {
    setTheme(t);
    applyTheme(t);
  }, []);
  return [theme, set];
}
