import { useEffect, useState } from "react";
import { SessionTimeoutDialog } from "@ari/design-system";
import { useSession } from "../app/session";

const WARN = Number(import.meta.env.VITE_SESSION_WARN_SECONDS ?? 120);

/** In-memory countdown from the server's expiresAt. Warns before expiry; background tabs do not extend. */
export function SessionTimer() {
  const { state, extend, signOut } = useSession();
  const expiresAt = state.status === "authenticated" ? state.session.expiresAt : null;
  const [remaining, setRemaining] = useState<number>(Infinity);

  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => setRemaining((new Date(expiresAt).getTime() - Date.now()) / 1000);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  useEffect(() => {
    if (expiresAt && remaining <= 0) void signOut("expired");
  }, [remaining, expiresAt, signOut]);

  if (!expiresAt) return null;
  return (
    <SessionTimeoutDialog
      open={remaining <= WARN && remaining > 0}
      secondsRemaining={Math.max(0, remaining)}
      onExtend={() => void extend().catch(() => void signOut("expired"))}
      onSignOut={() => void signOut("user")}
    />
  );
}
