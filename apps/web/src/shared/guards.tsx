import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Skeleton } from "@ari/design-system";
import type { Role } from "@ari/api-client";
import { needsMfaSetup, useSession } from "../app/session";
import { Forbidden403 } from "./errors";
import { homeFor } from "../lib/permissions";
import { safeNext } from "../lib/safe-path";

/** Client guards are UX only. The API enforces every rule. */
export function RequireSession({ roles }: { roles?: readonly Role[] }) {
  const { state } = useSession();
  const loc = useLocation();
  if (state.status === "loading") return <div className="narrow" style={{ padding: "2rem" }}><Skeleton lines={4} /></div>;
  if (state.status === "anonymous") {
    const next = safeNext(loc.pathname + loc.search, "/");
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  // Enrolment-only session: every protected call would be refused, so send the user to the one screen that works.
  if (needsMfaSetup(state.session)) return <Navigate to="/setup-mfa" replace />;
  if (roles && !state.roles.some((r) => roles.includes(r))) return <Forbidden403 />;
  return <Outlet />;
}

/** Signed in, second factor not required yet. Only the factor set-up screen sits behind this guard. */
export function RequireEnrolmentSession() {
  const { state } = useSession();
  if (state.status === "loading") return <div className="narrow" style={{ padding: "2rem" }}><Skeleton lines={4} /></div>;
  if (state.status === "anonymous") return <Navigate to="/login" replace />;
  return <Outlet />;
}

export function PublicOnly() {
  const { state } = useSession();
  if (state.status === "authenticated") return <Navigate to={needsMfaSetup(state.session) ? "/setup-mfa" : homeFor(state.roles)} replace />;
  return <Outlet />;
}

export function RoleHome() {
  const { state } = useSession();
  if (state.status !== "authenticated") return null;
  return <Navigate to={homeFor(state.roles)} replace />;
}
