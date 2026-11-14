import type { ComponentType } from "react";
import type { Role } from "@ari/api-client";
import type { MessageKey } from "@ari/i18n";

/** "public": no session. "any": any signed-in role. "enrol": signed in, second factor not set up yet. */
type RoleSet = readonly Role[] | "any" | "public" | "enrol";
export interface RouteDef {
  id: string;
  path: string;
  roles: RoleSet;
  /** Where the route sits: no session needed ("public"), session without role check ("any"). */
  load: () => Promise<{ Component: ComponentType }>;
  nav?: { labelKey: MessageKey; href?: string; prefix?: string };
  /** Public route that stays open with a session (others send a signed-in user home). */
  openWhenSignedIn?: boolean;
}

const RIL = ["researcher_il"] as const;
const RINT = ["researcher_intl"] as const;
const CLIN = ["center_clinician"] as const;
const NC = ["national_coordinator"] as const;
const CM = ["committee_member"] as const;
const ADM = ["system_admin"] as const;
const SEARCHERS = [...RIL, ...RINT, ...CLIN, ...NC, ...CM] as const;

const p = <K extends string>(loader: () => Promise<Record<K, ComponentType>>, key: K) => () => loader().then((m) => ({ Component: m[key] }));

/** Single typed route table. Nav, guards and tests read from it. Mirrors plan/06-frontend/07. */
export const ROUTES: RouteDef[] = [
  { id: "login", path: "/login", roles: "public", load: p(() => import("../features/identity-access/LoginPage"), "LoginPage") },
  { id: "mfa", path: "/login/mfa", roles: "public", load: p(() => import("../features/identity-access/MfaPage"), "MfaPage") },
  { id: "register", path: "/register", roles: "public", load: p(() => import("../features/identity-access/RegisterPage"), "RegisterPage") },
  // Link target of the verification and invitation e-mails (apps/api sends `${origin}/verify-email?token=`).
  { id: "verify-email", path: "/verify-email", roles: "public", openWhenSignedIn: true, load: p(() => import("../features/identity-access/VerifyEmailPage"), "VerifyEmailPage") },
  { id: "verify-email-auth", path: "/auth/verify-email", roles: "public", openWhenSignedIn: true, load: p(() => import("../features/identity-access/VerifyEmailPage"), "VerifyEmailPage") },
  { id: "setup-mfa", path: "/setup-mfa", roles: "enrol", load: p(() => import("../features/identity-access/MfaSetupPage"), "MfaSetupPage") },
  // Account recovery and invitation (KNOWN-ISSUES M-2). apps/api sends `${origin}/reset-password?token=` and `${origin}/invite/<token>`.
  { id: "forgot-password", path: "/forgot-password", roles: "public", load: p(() => import("../features/identity-access/ForgotPasswordPage"), "ForgotPasswordPage") },
  { id: "reset-password", path: "/reset-password", roles: "public", openWhenSignedIn: true, load: p(() => import("../features/identity-access/ResetPasswordPage"), "ResetPasswordPage") },
  { id: "invite", path: "/invite/:token", roles: "public", openWhenSignedIn: true, load: p(() => import("../features/identity-access/InviteAcceptPage"), "InviteAcceptPage") },
  { id: "session-ended", path: "/session-ended", roles: "public", openWhenSignedIn: true, load: p(() => import("../features/identity-access/SessionEndedPage"), "SessionEndedPage") },

  { id: "home", path: "/home", roles: "any", nav: { labelKey: "nav.home" }, load: p(() => import("../features/home/HomePage"), "HomePage") },
  { id: "search", path: "/search", roles: SEARCHERS, nav: { labelKey: "nav.search" }, load: p(() => import("../features/search-discovery/SearchPage"), "SearchPage") },
  { id: "samples", path: "/samples", roles: [...CLIN, ...NC], nav: { labelKey: "nav.samples", prefix: "/samples" }, load: p(() => import("../features/sample-index/SamplesPage"), "SamplesPage") },
  { id: "samples-new", path: "/samples/new", roles: NC, load: p(() => import("../features/sample-index/SampleEntryPage"), "SampleEntryPage") },
  { id: "sample", path: "/samples/:id", roles: [...CLIN, ...NC], load: p(() => import("../features/sample-index/SampleDetailPage"), "SampleDetailPage") },
  { id: "import", path: "/import", roles: NC, nav: { labelKey: "nav.import" }, load: p(() => import("../features/center-ingestion/ImportListPage"), "ImportListPage") },
  { id: "import-new", path: "/import/new", roles: NC, load: p(() => import("../features/center-ingestion/ImportWizardPage"), "ImportWizardPage") },
  { id: "import-job", path: "/import/:jobId", roles: NC, load: p(() => import("../features/center-ingestion/ImportJobPage"), "ImportJobPage") },
  { id: "freshness", path: "/freshness", roles: [...CLIN, ...NC], nav: { labelKey: "nav.freshness" }, load: p(() => import("../features/center-ingestion/FreshnessPage"), "FreshnessPage") },

  { id: "cart", path: "/cart", roles: RIL, load: p(() => import("../features/access-requests/CartPage"), "CartPage") },
  { id: "requests", path: "/requests", roles: [...RIL, ...CLIN, ...NC, ...CM], nav: { labelKey: "nav.requests", prefix: "/requests" }, load: p(() => import("../features/access-requests/RequestsPage"), "RequestsPage") },
  { id: "requests-new", path: "/requests/new", roles: RIL, load: p(() => import("../features/access-requests/RequestFormPage"), "RequestFormPage") },
  { id: "request", path: "/requests/:id", roles: [...RIL, ...CLIN, ...NC, ...CM], load: p(() => import("../features/access-requests/RequestDetailPage"), "RequestDetailPage") },
  { id: "coordination", path: "/requests/:id/coordination", roles: [...CLIN, ...NC], load: p(() => import("../features/access-requests/CoordinationPage"), "CoordinationPage") },
  { id: "precheck", path: "/requests/:id/precheck", roles: NC, load: p(() => import("../features/access-requests/PrecheckPage"), "PrecheckPage") },
  { id: "decision", path: "/requests/:id/decision", roles: CM, load: p(() => import("../features/access-requests/DecisionPage"), "DecisionPage") },
  { id: "committee", path: "/committee", roles: CM, nav: { labelKey: "nav.committee" }, load: p(() => import("../features/admin-governance/CommitteePage"), "CommitteePage") },

  { id: "registrations", path: "/admin/registrations", roles: NC, nav: { labelKey: "nav.registrations" }, load: p(() => import("../features/admin-governance/RegistrationsPage"), "RegistrationsPage") },
  { id: "centers", path: "/admin/centers", roles: [...NC, ...ADM], nav: { labelKey: "nav.centers" }, load: p(() => import("../features/admin-governance/CentersPage"), "CentersPage") },
  { id: "users", path: "/admin/users", roles: ADM, nav: { labelKey: "nav.users" }, load: p(() => import("../features/admin-governance/UsersPage"), "UsersPage") },
  { id: "privacy-settings", path: "/admin/settings/privacy", roles: ADM, nav: { labelKey: "nav.settings" }, load: p(() => import("../features/admin-governance/PrivacySettingsPage"), "PrivacySettingsPage") },
  { id: "audit", path: "/audit", roles: ADM, nav: { labelKey: "nav.audit" }, load: p(() => import("../features/audit-log/AuditPage"), "AuditPage") },

  { id: "account", path: "/account", roles: "any", nav: { labelKey: "nav.account" }, load: p(() => import("../features/identity-access/AccountPage"), "AccountPage") },
  { id: "security", path: "/account/security", roles: "any", load: p(() => import("../features/identity-access/SecurityPage"), "SecurityPage") },
  { id: "change-password", path: "/account/password", roles: "any", load: p(() => import("../features/identity-access/ChangePasswordPage"), "ChangePasswordPage") },
  { id: "recovery-codes", path: "/account/recovery-codes", roles: "any", load: p(() => import("../features/identity-access/RecoveryCodesPage"), "RecoveryCodesPage") },
  { id: "help", path: "/help", roles: "any", load: p(() => import("../features/home/HelpPage"), "HelpPage") },
];

/** Pure helper for tests and nav: may this role set open the route? */
export function canOpen(route: Pick<RouteDef, "roles">, roles: readonly Role[]): boolean {
  if (route.roles === "public" || route.roles === "any" || route.roles === "enrol") return true;
  return route.roles.some((r) => roles.includes(r));
}
