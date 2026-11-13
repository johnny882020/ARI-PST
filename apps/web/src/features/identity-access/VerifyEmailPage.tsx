import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Alert, Button, Input } from "@ari/design-system";
import { isApiProblem, unwrapVoid } from "@ari/api-client";
import type { MessageKey } from "@ari/i18n";
import { postVerifyEmail } from "../../lib/api";
import { useT } from "../../app/locale";
import { PageHeading } from "../../shared/page";
import { ErrorSummary } from "../../shared/forms";
import { problemMessageKey, traceIdOf } from "../../shared/problem-message";

/** Same bounds as VerifyEmailRequest in the API contract (token 20..200, password 12..128). */
const TOKEN_OK = /^[\x21-\x7e]{20,200}$/;
const schema = z
  .object({
    password: z.string().min(1, "form.error.required").min(12, "form.error.password.length").max(128, "form.error.password.length"),
    confirm: z.string().min(1, "form.error.required"),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "form.error.password.match" });
type Values = z.infer<typeof schema>;

/** Server password rules (apps/api auth-local/password.ts) mapped to messages. */
const PASSWORD_RULE: Record<string, MessageKey> = {
  REQUIRED: "form.error.required",
  LENGTH: "form.error.password.length",
  COMMON: "form.error.password.weak",
  REPEATED: "form.error.password.weak",
  CONTAINS_EMAIL: "form.error.password.weak",
};

/**
 * Target of the link in the verification and invitation e-mails (`/verify-email?token=...`).
 * Confirms the address and sets the first password. The second factor is set up at the first sign-in.
 */
export function VerifyEmailPage() {
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
  const f = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { password: "", confirm: "" } });
  const { errors, isSubmitting } = f.formState;
  const text = (m: string | undefined) => (m ? t(m as MessageKey) : undefined);

  const onSubmit = f.handleSubmit(
    async (v) => {
      setProblem(null);
      try {
        await unwrapVoid(postVerifyEmail({ token, password: v.password }));
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
        <PageHeading titleKey="auth.verify.done.title" />
        <Alert tone="success">{t("auth.verify.done.body")}</Alert>
        <ol className="steps-list">
          <li>{t("auth.verify.done.step.approval")}</li>
          <li>{t("auth.verify.done.step.signIn")}</li>
          <li>{t("auth.verify.done.step.mfa")}</li>
        </ol>
        <p><Link className="ds-btn ds-btn-primary" to="/login"><span className="ds-btn-label">{t("auth.verify.done.login")}</span></Link></p>
      </>
    );
  }
  if (!TOKEN_OK.test(token) || linkBad) {
    return (
      <>
        <PageHeading titleKey="auth.verify.invalid.title" />
        <Alert tone="danger">{t(linkBad ? "auth.verify.invalid.used" : "auth.verify.invalid.incomplete")}</Alert>
        <p>{t("auth.verify.invalid.next")}</p>
        <p className="row">
          <Link className="ds-btn ds-btn-secondary" to="/login"><span className="ds-btn-label">{t("auth.register.backToLogin")}</span></Link>
          <Link className="ds-btn ds-btn-quiet" to="/register"><span className="ds-btn-label">{t("auth.login.register")}</span></Link>
        </p>
      </>
    );
  }
  const summary = (["password", "confirm"] as const).filter((k) => errors[k]).map((k) => ({ name: k, label: t(k === "password" ? "auth.verify.password" : "auth.verify.confirm") }));
  return (
    <>
      <PageHeading titleKey="auth.verify.title" lead={t("auth.verify.lead")} />
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
          <Button type="submit" variant="primary" loading={isSubmitting}>{t("auth.verify.submit")}</Button>
        </div>
      </form>
      <p className="muted">{t("auth.verify.mfaNote")}</p>
    </>
  );
}
