import { useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Alert, Button, Input } from "@ari/design-system";
import { unwrap, type Session } from "@ari/api-client";
import { api } from "../../lib/api";
import { useT } from "../../app/locale";
import { useSession } from "../../app/session";
import { PageHeading } from "../../shared/page";
import { problemMessageKey } from "../../shared/problem-message";
import { homeFor } from "../../lib/permissions";
import { safeNext } from "../../lib/safe-path";
import { authFlow } from "./auth-flow";
import { classifyPasskeyError, getAssertion, passkeysSupported } from "../../lib/webauthn";

export function MfaPage() {
  const t = useT();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { setSession } = useSession();
  const flow = authFlow.get();
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!flow) return <Navigate to="/login" replace />;

  const done = (s: Session) => {
    authFlow.clear();
    setSession(s);
    const roles = s.roles.map((r) => r.role);
    nav(safeNext(params.get("next"), homeFor(roles)), { replace: true });
  };
  const fail = (key: string) => { setMsg(key); setBusy(false); setCode(""); };

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      done(recovery
        ? await unwrap(api.POST("/auth/mfa/recovery", { body: { challengeToken: flow.token, recoveryCode: code.trim() } }))
        : await unwrap(api.POST("/auth/mfa/verify", { body: { challengeToken: flow.token, totpCode: code.replace(/\s/g, "") } })));
    } catch (er) { fail(problemMessageKey(er)); }
  };

  const passkey = async () => {
    setBusy(true); setMsg(null);
    try {
      const options = await unwrap(api.POST("/auth/webauthn/options", { body: { challengeToken: flow.token } }));
      const assertion = await getAssertion(options);
      done(await unwrap(api.POST("/auth/mfa/verify", { body: { challengeToken: flow.token, webauthnAssertion: assertion } })));
    } catch (er) {
      const c = classifyPasskeyError(er);
      fail(c === "cancelled" ? "auth.passkey.cancelled" : problemMessageKey(er));
    }
  };

  return (
    <>
      <PageHeading titleKey="auth.mfa.title" lead={t(recovery ? "auth.mfa.recovery.lead" : "auth.mfa.lead")} />
      {msg ? <div role="alert"><Alert tone="danger">{t(msg as never)}</Alert></div> : null}
      {passkeysSupported() && !recovery ? (
        <div className="stack">
          <Button variant="primary" onClick={() => void passkey()} loading={busy}>{t("auth.mfa.passkey")}</Button>
          <p className="muted">{t("auth.mfa.or")}</p>
        </div>
      ) : null}
      <form onSubmit={submitCode} className="stack" noValidate>
        <Input
          id="field-code"
          label={t(recovery ? "auth.mfa.recovery.label" : "auth.mfa.code.label")}
          help={recovery ? undefined : t("auth.mfa.code.help")}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          inputMode={recovery ? "text" : "numeric"}
          autoComplete="one-time-code"
          maxLength={recovery ? 40 : 7}
          dir="ltr"
          required
        />
        <div className="form-actions">
          <Button type="submit" variant={passkeysSupported() && !recovery ? "secondary" : "primary"} loading={busy}>{t("auth.mfa.submit")}</Button>
          <Button variant="quiet" onClick={() => { setRecovery(!recovery); setMsg(null); setCode(""); }}>
            {t(recovery ? "auth.mfa.useCode" : "auth.mfa.useRecovery")}
          </Button>
        </div>
      </form>
    </>
  );
}
