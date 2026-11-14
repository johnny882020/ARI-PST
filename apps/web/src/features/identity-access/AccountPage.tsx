import { Link } from "react-router-dom";
import { Card, LanguageSwitch, ThemeToggle, type Theme } from "@ari/design-system";
import { useState } from "react";
import { useLocale, useT } from "../../app/locale";
import { useSession } from "../../app/session";
import { PageHeading } from "../../shared/page";
import { readPref, writePref } from "../../lib/ui-prefs";

export function AccountPage() {
  const t = useT();
  const { locale, setLocale } = useLocale();
  const { state } = useSession();
  const [theme, setTheme] = useState<Theme>((readPref("ui.theme") as Theme | null) ?? "system");
  return (
    <div className="stack">
      <PageHeading titleKey="account.title" />
      <Card heading={t("account.profile")} headingLevel={2}>
        <p>{state.status === "authenticated" ? state.session.displayName : ""}</p>
        <div className="row"><span>{t("account.language")}</span><LanguageSwitch value={locale} onChange={setLocale} /></div>
        <div className="row"><span>{t("account.theme")}</span><ThemeToggle value={theme} onChange={(th) => { setTheme(th); writePref("ui.theme", th); }} /></div>
      </Card>
      <Card heading={t("account.security")} headingLevel={2}>
        <p>{t("account.security.lead")}</p>
        <div className="row">
          <Link className="ds-btn ds-btn-secondary" to="/account/security"><span className="ds-btn-label">{t("account.security.open")}</span></Link>
          <Link className="ds-btn ds-btn-secondary" to="/account/password"><span className="ds-btn-label">{t("account.password.open")}</span></Link>
          <Link className="ds-btn ds-btn-secondary" to="/account/recovery-codes"><span className="ds-btn-label">{t("account.recovery.open")}</span></Link>
        </div>
      </Card>
    </div>
  );
}
