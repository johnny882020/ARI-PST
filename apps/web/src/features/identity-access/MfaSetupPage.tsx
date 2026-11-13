import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card } from "@ari/design-system";
import { useT } from "../../app/locale";
import { needsMfaSetup, useSession } from "../../app/session";
import { PageHeading } from "../../shared/page";
import { homeFor } from "../../lib/permissions";
import { qk } from "../../lib/query";
import { passkeysSupported } from "../../lib/webauthn";
import { PasskeyEnrol, TotpEnrol } from "./SecurityPage";

/**
 * First sign-in of an account with no second factor. The API gives an enrolment-only session:
 * it can add a factor and sign out, nothing else. After the first factor the session is a full one.
 */
export function MfaSetupPage() {
  const t = useT();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { state, signOut } = useSession();
  const [method, setMethod] = useState<"totp" | "passkey" | null>(null);
  const [finishing, setFinishing] = useState(false);
  if (state.status !== "authenticated") return null;
  if (!needsMfaSetup(state.session) && !method) return <Navigate to={homeFor(state.roles)} replace />;

  const finish = async () => {
    setFinishing(true);
    await qc.refetchQueries({ queryKey: qk.session });
    nav(homeFor(state.roles), { replace: true });
  };

  return (
    <div className="stack">
      <PageHeading titleKey="auth.setup.title" lead={t("auth.setup.lead")} />
      {method === null ? (
        <>
          <Alert tone="info">{t("auth.setup.why")}</Alert>
          <div className="stack">
            <Card as="div" heading={t("auth.security.addTotp")} headingLevel={2}>
              <p>{t("auth.setup.totp.body")}</p>
              <Button variant="primary" onClick={() => setMethod("totp")}>{t("auth.setup.totp.start")}</Button>
            </Card>
            {passkeysSupported() ? (
              <Card as="div" heading={t("auth.security.addPasskey")} headingLevel={2}>
                <p>{t("auth.setup.passkey.body")}</p>
                <Button onClick={() => setMethod("passkey")}>{t("auth.setup.passkey.start")}</Button>
              </Card>
            ) : null}
          </div>
        </>
      ) : (
        <Card as="div" heading={t(method === "totp" ? "auth.security.addTotp" : "auth.security.addPasskey")} headingLevel={2}>
          {method === "totp" ? <TotpEnrol onClose={() => void finish()} /> : <PasskeyEnrol onClose={() => void finish()} />}
          {finishing ? <p role="status" className="muted">{t("auth.setup.finishing")}</p> : null}
        </Card>
      )}
      <div className="form-actions">
        {method !== null && !finishing ? <Button variant="quiet" onClick={() => setMethod(null)}>{t("auth.setup.otherMethod")}</Button> : null}
        <Button variant="quiet" onClick={() => void signOut("user")}>{t("shell.signOut")}</Button>
      </div>
    </div>
  );
}
