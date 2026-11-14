import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Alert, Button, Input } from "@ari/design-system";
import { isApiProblem, unwrapVoid } from "@ari/api-client";
import type { MessageKey } from "@ari/i18n";
import { api } from "../../lib/api";
import { useT } from "../../app/locale";
import { PageHeading } from "../../shared/page";
import { ErrorSummary } from "../../shared/forms";
import { problemMessageKey, traceIdOf } from "../../shared/problem-message";
import { PASSWORD_RULE, TOKEN_OK, newPasswordSchema, type NewPasswordValues } from "./password-form";

/**
 * Target of the password reset e-mail (`/reset-password?token=...`). The token works once, for 30 minutes.
 * Saving the new password ends every session of the account. The second factor stays as it is.
 */
export function ResetPasswordPage() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  // Keep the token in memory only and take it out of the address bar (history, referrer, error reports).
  const [token] = useState(() => params.get("token") ?? "");
  useEffect(() => {
    if (params.has("token")) setParams(new URLSearchParams(), { replace: true });
  }, [params, setParams]);

  const [done, setDone] = useState(false);
  const [linkBad, setLinkBad] = useState(false);
  const [problem, setProblem] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  const f = useForm<NewPasswordValues>({ resolver: zodResolver(newPasswordSchema), defaultValues: { password: "", confirm: "" } });
  const { errors, isSubmitting } = f.formState;
  const text = (m: string | undefined) => (m ? t(m as MessageKey) : undefined);

  const onSubmit = f.handleSubmit(
    async (v) => {
      setProblem(null);
      try {
        await unwrapVoid(api.POST("/auth/password-reset/confirm", { body: { token, password: v.password } }));
        f.reset({ password: "", confirm: "" });
        setDone(true);
      } catch (e) {
        const items = isApiProblem(e) ? e.errors : [];
        const pw = items.find((x) => x.field === "password");
        if (items.some((x) => x.field === "token")) setLinkBad(true);
        else if (pw) f.setError("password", { type: "server", message: PASSWORD_RULE[pw.rule] ?? "form.error.password.weak" });
        else setProblem(e);
        f.setValue("confirm", "");
        setNonce((n) => n + 1);
      }
    },
    () => setNonce((n) => n + 1),
  );

  if (done) {
    return (
      <>
        <PageHeading titleKey="auth.reset.done.title" />
        <Alert tone="success">{t("auth.reset.done.body")}</Alert>
        <p><Link className="ds-btn ds-btn-primary" to="/login"><span className="ds-btn-label">{t("auth.verify.done.login")}</span></Link></p>
      </>
    );
  }
  if (!TOKEN_OK.test(token) || linkBad) {
    return (
      <>
        <PageHeading titleKey="auth.reset.invalid.title" />
        <Alert tone="danger">{t("auth.reset.invalid.body")}</Alert>
        <p className="row">
          <Link className="ds-btn ds-btn-secondary" to="/forgot-password"><span className="ds-btn-label">{t("auth.reset.invalid.again")}</span></Link>
          <Link className="ds-btn ds-btn-quiet" to="/login"><span className="ds-btn-label">{t("auth.register.backToLogin")}</span></Link>
        </p>
      </>
    );
  }
  const summary = (["password", "confirm"] as const).filter((k) => errors[k]).map((k) => ({ name: k, label: t(k === "password" ? "auth.verify.password" : "auth.verify.confirm") }));
  return (
    <>
      <PageHeading titleKey="auth.reset.title" lead={t("auth.reset.lead")} />
      <ErrorSummary errors={summary} nonce={nonce} />
      {problem ? (
        <Alert tone="danger">
          {t(problemMessageKey(problem))}
          {traceIdOf(problem) ? <small> {t("error.trace.label")}: <bdi dir="ltr">{traceIdOf(problem)}</bdi></small> : null}
        </Alert>
      ) : null}
      <form onSubmit={onSubmit} noValidate className="stack">
        <Input id="field-password" label={t("auth.verify.password")} help={t("auth.verify.password.help")} type="password" autoComplete="new-password" required dir="ltr" {...f.register("password")} error={text(errors.password?.message)} />
        <Input id="field-confirm" label={t("auth.verify.confirm")} type="password" autoComplete="new-password" required dir="ltr" {...f.register("confirm")} error={text(errors.confirm?.message)} />
        <div className="form-actions">
          <Button type="submit" variant="primary" loading={isSubmitting}>{t("auth.reset.submit")}</Button>
        </div>
      </form>
      <p className="muted">{t("auth.forgot.mfaNote")}</p>
    </>
  );
}
