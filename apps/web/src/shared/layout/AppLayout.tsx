import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AppShell, Badge, Button, LanguageSwitch, ThemeToggle, type NavItem, type Theme } from "@ari/design-system";
import { unwrap } from "@ari/api-client";
import { useLocale, useT } from "../../app/locale";
import { useSession } from "../../app/session";
import { ROUTES } from "../../routes/route-table";
import { api } from "../../lib/api";
import { qk } from "../../lib/query";
import { readPref, writePref } from "../../lib/ui-prefs";
import { useState } from "react";
import { ErrorBoundary, RootErrorFallback } from "../errors";
import { SessionTimer } from "../SessionTimer";

function CartBadge() {
  const t = useT();
  const q = useQuery({ queryKey: qk.cart, queryFn: () => unwrap(api.GET("/request-cart")) });
  const n = q.data?.items.length ?? 0;
  return (
    <Link to="/cart" className="ds-btn ds-btn-quiet" aria-label={t("nav.cart.count", { count: n })}>
      <span className="ds-btn-label">{t("nav.cart")} {n > 0 ? <Badge tone="primary">{n}</Badge> : null}</span>
    </Link>
  );
}

export function AppLayout() {
  const t = useT();
  const { locale, setLocale } = useLocale();
  const { state, signOut } = useSession();
  const loc = useLocation();
  const [theme, setTheme] = useState<Theme>((readPref("ui.theme") as Theme | null) ?? "system");
  const authed = state.status === "authenticated" ? state : null;

  const items: NavItem[] = authed
    ? ROUTES.filter((r) => r.nav && r.roles !== "public" && (r.roles === "any" || r.roles.some((x) => authed.roles.includes(x)))).map((r) => ({
        id: r.id,
        label: t(r.nav!.labelKey),
        href: r.nav!.href ?? r.path,
        current: loc.pathname === (r.nav!.href ?? r.path) || (r.nav!.prefix ? loc.pathname.startsWith(r.nav!.prefix) : false),
      }))
    : [];

  return (
    <AppShell
      brand={<Link to="/" className="brand-link"><strong>ARI-PST</strong> <span className="brand-sub">× Tech4Cancer</span></Link>}
      nav={items}
      navLabel={t("shell.nav.label")}
      renderLink={(it, props) => <NavLink to={it.href} className={props.className} aria-current={props["aria-current"]} onClick={props.onClick}>{props.children}</NavLink>}
      headerActions={
        <>
          {authed?.permissions.has("cart.use") ? <CartBadge /> : null}
          <LanguageSwitch value={locale} onChange={setLocale} />
          <ThemeToggle value={theme} onChange={(th) => { setTheme(th); writePref("ui.theme", th); }} />
          {authed ? (
            <span className="user-menu">
              <span className="user-name">{authed.session.displayName}</span>
              <Button size="sm" variant="secondary" onClick={() => void signOut("user")}>{t("shell.signOut")}</Button>
            </span>
          ) : null}
        </>
      }
      footer={<p className="footer-note">{t("privacy.badge")} · <Link to="/help">{t("nav.help")}</Link></p>}
    >
      <ErrorBoundary fallback={() => <RootErrorFallback />}>
        <Outlet />
      </ErrorBoundary>
      <SessionTimer />
    </AppShell>
  );
}

/** Minimal chrome for login / registration / session-ended. */
export function PublicLayout() {
  const t = useT();
  const { locale, setLocale } = useLocale();
  const [theme, setTheme] = useState<Theme>((readPref("ui.theme") as Theme | null) ?? "system");
  return (
    <div className="public-wrap">
      <a className="ds-skip" href="#main">{t("shell.skip")}</a>
      <header className="public-head">
        <strong>ARI-PST</strong> <span className="brand-sub">× Tech4Cancer</span>
        <span className="spacer" />
        <LanguageSwitch value={locale} onChange={setLocale} />
        <ThemeToggle value={theme} onChange={(th) => { setTheme(th); writePref("ui.theme", th); }} />
      </header>
      <main id="main" className="narrow" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="footer-note">{t("privacy.badge")}</footer>
    </div>
  );
}
