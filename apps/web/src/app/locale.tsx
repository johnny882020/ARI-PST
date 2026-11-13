import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { IntlProvider, useIntl } from "react-intl";
import { DesignSystemProvider } from "@ari/design-system";
import { defaultLocale, dirFor, messages, negotiateLocale, type Locale, type MessageKey } from "@ari/i18n";
import { readPref, writePref } from "../lib/ui-prefs";

interface LocaleCtx {
  locale: Locale;
  dir: "rtl" | "ltr";
  setLocale: (l: Locale) => void;
}
const Ctx = createContext<LocaleCtx | null>(null);

function initialLocale(): Locale {
  const stored = readPref("ui.locale");
  if (stored === "he" || stored === "en") return stored;
  return defaultLocale;
}

export function LocaleProvider({ children, initial }: { children: ReactNode; initial?: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(initial ?? initialLocale());
  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    writePref("ui.locale", l);
  }, []);
  const value = useMemo(() => ({ locale, dir: dirFor(locale), setLocale }), [locale, setLocale]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dirFor(locale);
  }, [locale]);

  return (
    <Ctx.Provider value={value}>
      <IntlProvider
        locale={locale}
        messages={messages[locale]}
        defaultLocale="he"
        onError={(err) => {
          if (import.meta.env.DEV) console.warn(err.code);
        }}
      >
        <DesignSystemProvider locale={locale}>{children}</DesignSystemProvider>
      </IntlProvider>
    </Ctx.Provider>
  );
}

export function useLocale(): LocaleCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("LocaleProvider missing");
  return v;
}

type Values = Record<string, string | number | boolean | Date | null | undefined | ((chunks: React.ReactNode[]) => React.ReactNode)>;

/** Typed message lookup: a missing key is a compile error. */
export function useT() {
  const intl = useIntl();
  return useCallback(
    (key: MessageKey, values?: Values): string => intl.formatMessage({ id: key }, values as never) as string,
    [intl],
  );
}

export { negotiateLocale };
