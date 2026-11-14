import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Alert, Button, Input } from "@ari/design-system";
import { unwrap } from "@ari/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { qk } from "../../lib/query";
import { api } from "../../lib/api";
import { useT } from "../../app/locale";
import { PageHeading } from "../../shared/page";
import { problemMessageKey, traceIdOf } from "../../shared/problem-message";
import { authFlow } from "./auth-flow";

const schema = z.object({ email: z.string().min(1, "form.error.required").email("form.error.email"), password: z.string().min(1, "form.error.required") });
type Values = z.infer<typeof schema>;

export function LoginPage() {
  const t = useT();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const [err, setErr] = useState<unknown>(null);
  const f = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: "", password: "" } });
  const { errors, isSubmitting } = f.formState;

  const onSubmit = f.handleSubmit(async (v) => {
    setErr(null);
    try {
      const r = await unwrap(api.POST("/auth/login", { body: v }));
      // No second factor yet (first sign-in after e-mail verification): the challenge alone gives an
      // enrolment-only session, and the user must add a factor before anything else.
      if (r.enrollmentRequired || r.factors.length === 0) {
        qc.setQueryData(qk.session, await unwrap(api.POST("/auth/mfa/verify", { body: { challengeToken: r.challengeToken } })));
        nav("/setup-mfa", { replace: true });
        return;
      }
      authFlow.set(r.challengeToken, r.factors);
      const next = params.get("next");
      nav(`/login/mfa${next ? `?next=${encodeURIComponent(next)}` : ""}`);
    } catch (e) {
      setErr(e);
      f.setValue("password", "");
    }
  });

  return (
    <>
      <PageHeading titleKey="auth.login.title" lead={t("auth.login.lead")} />
      {err ? (
        <div>
          <Alert tone="danger" title={t("auth.login.error.title")}>
            {t(problemMessageKey(err))}
            {traceIdOf(err) ? <small> {t("error.trace.label")}: <bdi dir="ltr">{traceIdOf(err)}</bdi></small> : null}
          </Alert>
        </div>
      ) : null}
      <form onSubmit={onSubmit} noValidate className="stack">
        <Input id="field-email" label={t("auth.login.email")} type="email" autoComplete="username" required {...f.register("email")} error={errors.email ? t(errors.email.message as never) : undefined} />
        <Input id="field-password" label={t("auth.login.password")} type="password" autoComplete="current-password" required {...f.register("password")} error={errors.password ? t(errors.password.message as never) : undefined} />
        <div className="form-actions">
          <Button type="submit" variant="primary" loading={isSubmitting}>{t("auth.login.submit")}</Button>
        </div>
      </form>
      <p><Link to="/forgot-password">{t("auth.login.forgot")}</Link></p>
      <p className="muted">{t("auth.login.noAccount")} <Link to="/register">{t("auth.login.register")}</Link></p>
      <p className="muted">{t("privacy.notice.short")}</p>
    </>
  );
}
