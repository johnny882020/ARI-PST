import { useEffect, useRef, useState } from "react";
import { Alert, Button, Dialog, Input } from "@ari/design-system";
import { unwrap } from "@ari/api-client";
import { api, setStepUpHandler } from "../lib/api";
import { useT } from "../app/locale";
import { useSession } from "../app/session";
import { problemMessageKey } from "./problem-message";

/**
 * Step-up dialog (review R-03, KNOWN-ISSUES M-1). Sensitive calls need a second factor younger than 5 minutes.
 * When the API answers STEP_UP_REQUIRED, the API client asks this host. The user confirms with the 6-digit code or a
 * recovery code (POST /auth/step-up); the client then sends the refused call once more. Cancel keeps the user signed in.
 */
export function StepUpHost() {
  const t = useT();
  const { state, setSession } = useSession();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const enrolled = state.status === "authenticated" && (state.session as { mfaEnrolled?: boolean }).mfaEnrolled !== false;

  useEffect(() => {
    if (!enrolled) return;
    setStepUpHandler(() => new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setCode(""); setRecovery(false); setMsg(null); setBusy(false);
      setOpen(true);
    }));
    return () => {
      setStepUpHandler(null);
      resolver.current?.(false);
      resolver.current = null;
    };
  }, [enrolled]);

  const finish = (ok: boolean) => {
    setOpen(false);
    setCode("");
    resolver.current?.(ok);
    resolver.current = null;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const body = recovery ? { recoveryCode: code.trim() } : { totpCode: code.replace(/\s/g, "") };
      const s = await unwrap(api.POST("/auth/step-up", { body }));
      setSession(s);
      setBusy(false);
      finish(true);
    } catch (er) {
      const key = problemMessageKey(er);
      setMsg(key === "error.session.body" ? "auth.error.code" : key);
      setBusy(false);
      setCode("");
    }
  };

  return (
    <Dialog open={open} onClose={() => finish(false)} title={t("auth.stepUp.title")} dismissible={!busy}>
      <form onSubmit={submit} className="stack" noValidate>
        <p>{t("auth.stepUp.body")} {t("auth.stepUp.methods")}</p>
        {msg ? <Alert tone="danger">{t(msg as never)}</Alert> : null}
        <Input
          id="field-step-up-code"
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
          <Button type="submit" variant="primary" loading={busy}>{t("auth.stepUp.submit")}</Button>
          <Button variant="quiet" onClick={() => { setRecovery(!recovery); setMsg(null); setCode(""); }}>
            {t(recovery ? "auth.mfa.useCode" : "auth.mfa.useRecovery")}
          </Button>
          <Button onClick={() => finish(false)} disabled={busy}>{t("common.action.cancel")}</Button>
        </div>
      </form>
    </Dialog>
  );
}
