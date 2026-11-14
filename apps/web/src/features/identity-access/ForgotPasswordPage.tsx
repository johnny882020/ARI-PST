import { useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Alert, Button, Input } from "@ari/design-system";
import { unwrap } from "@ari/api-client";
import type { MessageKey } from "@ari/i18n";
import { api } from "../../lib/api";
import { useT } from "../../app/locale";
import { PageHeading } from "../../shared/page";
import { problemMessageKey, traceIdOf } from "../../shared/problem-message";

const schema = z.object({ email: z.string().min(1, "form.error.required").max(254, "form.error.email").email("form.error.email") });
type Values = z.infer<typeof schema>;

/**
 * "Forgot password?" (KNOWN-ISSUES M-2). The API always answers 202, so this page shows the same text for every address.
 * It never says whether an account exists.
 */
export function ForgotPasswordPage() {
  const t = useT();
  const [sent, setSent] = useState(false);
  const [problem, setProblem] = useState<unknown>(null);
  const f = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: "" } });
  const { errors, isSubmitting } = f.formState;

  const onSubmit = f.handleSubmit(async (v) => {
    setProblem(null);
    try {
      await unwrap(api.POST("/auth/password-reset/request", { body: { email: v.email.trim() } }));
      f.reset({ email: "" });
      setSent(true);
    } catch (e) {
      setProblem(e);
    }
  });

  if (sent) {
    return (
      <>
        <PageHeading titleKey="auth.forgot.sent.title" />
        <Alert tone="info">{t("auth.forgot.sent.body")}</Alert>
        <p>{t("auth.forgot.sent.next")}</p>
        <p className="row">
          <Link className="ds-btn ds-btn-primary" to="/login"><span className="ds-btn-label">{t("auth.register.backToLogin")}</span></Link>
          <Button variant="quiet" onClick={() => setSent(false)}>{t("auth.reset.invalid.again")}</Button>
        </p>
      </>
    );
  }
  return (
    <>
      <PageHeading titleKey="auth.forgot.title" lead={t("auth.forgot.lead")} />
      {problem ? (
        <Alert tone="danger">
          {t(problemMessageKey(problem))}
          {traceIdOf(problem) ? <small> {t("error.trace.label")}: <bdi dir="ltr">{traceIdOf(problem)}</bdi></small> : null}
        </Alert>
      ) : null}
      <form onSubmit={onSubmit} noValidate className="stack">
        <Input id="field-email" label={t("auth.forgot.email")} type="email" autoComplete="username" required dir="ltr" {...f.register("email")} error={errors.email ? t(errors.email.message as MessageKey) : undefined} />
        <div className="form-actions">
          <Button type="submit" variant="primary" loading={isSubmitting}>{t("auth.forgot.submit")}</Button>
        </div>
      </form>
      <p className="muted">{t("auth.forgot.mfaNote")}</p>
      <p><Link to="/login">{t("auth.register.backToLogin")}</Link></p>
    </>
  );
}
