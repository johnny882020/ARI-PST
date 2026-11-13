import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isApiProblem, unwrap, unwrapVoid, type Role, type Session } from "@ari/api-client";
import { api, onUnauthorized, setCsrfFallback } from "../lib/api";
import { qk } from "../lib/query";
import { permissionsFor, type Permission } from "../lib/permissions";
import { useNavigate } from "react-router-dom";

export type SessionState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "authenticated"; session: Session; roles: Role[]; permissions: Set<Permission>; centerId: string | null };

/**
 * True for an enrolment-only session: signed in with a password, no second factor yet.
 * The API (SessionView.mfaEnrolled) lets such a session add a factor and sign out, nothing else.
 */
export function needsMfaSetup(s: Session): boolean {
  return (s as Session & { mfaEnrolled?: boolean }).mfaEnrolled === false;
}

const Ctx = createContext<{
  state: SessionState;
  setSession: (s: Session) => void;
  signOut: (reason?: "user" | "expired") => Promise<void>;
  extend: () => Promise<Session>;
} | null>(null);

const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("ari-session");

/** Clears every piece of client state that could hold protected data. */
function wipe(qc: ReturnType<typeof useQueryClient>) {
  qc.clear();
  setCsrfFallback(undefined);
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const q = useQuery({
    queryKey: qk.session,
    queryFn: async (): Promise<Session | null> => {
      try {
        return await unwrap(api.GET("/auth/session"));
      } catch (e) {
        if (isApiProblem(e) && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
    retry: false,
  });

  const session = q.data ?? null;
  useEffect(() => setCsrfFallback(session?.csrfToken), [session]);

  const setSession = useCallback(
    (s: Session) => {
      qc.setQueryData(qk.session, s);
      channel?.postMessage({ type: "extended" });
    },
    [qc],
  );

  const expire = useCallback(() => {
    wipe(qc);
    qc.setQueryData(qk.session, null);
    navigate("/session-ended", { replace: true, state: { next: window.location.pathname } });
  }, [navigate, qc]);

  const signOut = useCallback(
    async (reason: "user" | "expired" = "user") => {
      if (reason === "user") {
        try {
          await unwrapVoid(api.POST("/auth/logout"));
        } catch {
          /* session may already be gone */
        }
        channel?.postMessage({ type: "signed_out" });
        wipe(qc);
        qc.setQueryData(qk.session, null);
        // replace() drops history state; HTML is no-store so Back shows nothing.
        window.location.replace("/login");
      } else {
        expire();
      }
    },
    [expire, qc],
  );

  const extend = useCallback(async () => {
    const s = await unwrap(api.POST("/session/extend"));
    setSession(s);
    return s;
  }, [setSession]);

  // Any 401 from the API triggers the expiry flow once.
  useEffect(() => onUnauthorized(() => { if (qc.getQueryData(qk.session)) expire(); }), [expire, qc]);

  // Multi-tab: sign-out anywhere signs out everywhere.
  useEffect(() => {
    if (!channel) return;
    const h = (ev: MessageEvent) => {
      if (ev.data?.type === "signed_out") {
        wipe(qc);
        window.location.replace("/login");
      } else if (ev.data?.type === "extended") {
        void qc.invalidateQueries({ queryKey: qk.session });
      }
    };
    channel.addEventListener("message", h);
    return () => channel.removeEventListener("message", h);
  }, [qc]);

  const state = useMemo<SessionState>(() => {
    if (q.isPending) return { status: "loading" };
    if (!session) return { status: "anonymous" };
    const roles = session.roles.map((r) => r.role);
    return { status: "authenticated", session, roles, permissions: permissionsFor(roles), centerId: session.activeCenterId ?? null };
  }, [q.isPending, session]);

  const value = useMemo(() => ({ state, setSession, signOut, extend }), [state, setSession, signOut, extend]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error("SessionProvider missing");
  return v;
}

export function useCan(permission: Permission): boolean {
  const { state } = useSession();
  return state.status === "authenticated" && state.permissions.has(permission);
}
