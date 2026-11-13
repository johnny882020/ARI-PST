import { useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Alert, Button, Checkbox, Input } from "@ari/design-system";
import { unwrapVoid } from "@ari/api-client";
import { api } from "../../lib/api";
import { useLocale, useT } from "../../app/locale";
import { PageHeading } from "../../shared/page";
import { applyProblemToForm, ErrorSummary, useErrorText } from "../../shared/forms";
import { problemMessageKey } from "../../shared/problem-message";

const TERMS_VERSION = "1.0";
const schema = z.object({
  displayName: z.string().trim().min(2, "form.error.required"),
  institution: z.string().trim().min(2, "form.error.required"),
  email: z.string().min(1, "form.error.required").email("form.error.email"),
  terms: z.literal(true, { errorMap: () => ({ message: "form.error.terms" }) }),
});
type Values = z.infer<typeof schema>;

export function RegisterPage() {
  const t = useT();
  const { locale } = useLocale();
  const errText = useErrorText();
  const [done, setDone] = useState(false);
  const [problem, setProblem] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  const f = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { displayName: "", institution: "", email: "", terms: undefined as unknown as true } });
  const { errors, isSubmitting } = f.formState;

  const onSubmit = f.handleSubmit(
    async (v) => {
      setProblem(null);
      try {
        await unwrapVoid(api.POST("/auth/register", { body: { email: v.email, displayName: v.displayName, institution: v.institution, termsVersion: TERMS_VERSION, locale } }));
        setDone(true);
      } catch (e) {
        if (!applyProblemToForm(e, f.setError, ["email", "displayName", "institution"])) setProblem(e);
        setNonce((n) => n + 1);
      }
    },
    () => setNonce((n) => n + 1),
  );

  if (done) {
    return (
      <>
        <PageHeading titleKey="auth.register.done.title" />
        <Alert tone="success">{t("auth.register.done.body")}</Alert>
        <p><Link to="/login">{t("auth.register.backToLogin")}</Link></p>
      </>
    );
  }
  const summary = (["displayName", "institution", "email", "terms"] as const).filter((k) => errors[k]).map((k) => ({ name: k, label: t(`auth.register.${k}` as never) }));
  return (
    <>
      <PageHeading titleKey="auth.register.title" lead={t("auth.register.lead")} />
      <ErrorSummary errors={summary} nonce={nonce} />
      {problem ? <Alert tone="danger">{t(problemMessageKey(problem))}</Alert> : null}
      <form onSubmit={onSubmit} noValidate className="stack">
        <Input id="field-displayName" label={t("auth.register.displayName")} autoComplete="name" required {...f.register("displayName")} error={errText(errors.displayName?.message)} />
        <Input id="field-institution" label={t("auth.register.institution")} autoComplete="organization" required {...f.register("institution")} error={errText(errors.institution?.message)} />
        <Input id="field-email" label={t("auth.register.email")} help={t("auth.register.email.help")} type="email" autoComplete="email" required {...f.register("email")} error={errText(errors.email?.message)} />
        <Checkbox id="field-terms" label={t("consent.terms.checkbox", { version: TERMS_VERSION })} error={errText(errors.terms?.message)} {...f.register("terms")} />
        <p className="muted">{t("auth.register.approval")}</p>
        <div className="form-actions">
          <Button type="submit" variant="primary" loading={isSubmitting}>{t("auth.register.submit")}</Button>
        </div>
      </form>
      <p><Link to="/login">{t("auth.register.backToLogin")}</Link></p>
    </>
  );
}
