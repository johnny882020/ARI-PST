import { useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Input } from "@ari/design-system";
import { isApiProblem, unwrapVoid } from "@ari/api-client";
import type { MessageKey } from "@ari/i18n";
import { api } from "../../lib/api";
import { qk } from "../../lib/query";
import { useT } from "../../app/locale";
import { PageHeading } from "../../shared/page";
import { ErrorSummary } from "../../shared/forms";
import { problemMessageKey, traceIdOf } from "../../shared/problem-message";
import { PASSWORD_RULE } from "./password-form";

const schema = z
  .object({
    current: z.string().min(1, "form.error.required").max(128, "form.error.password.length"),
    password: z.string().min(1, "form.error.required").min(12, "form.error.password.length").max(128, "form.error.password.length"),
    confirm: z.string().min(1, "form.error.required"),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "form.error.password.match" });
type Values = z.infer<typeof schema>;
const LABEL: Record<keyof Values, MessageKey> = { current: "account.password.current", password: "account.password.new", confirm: "account.password.confirm" };

/**
 * Change own password (POST /auth/password). The API needs the current password and a fresh step-up; the StepUpHost
 * dialog asks for the second factor and sends the call again. The API ends the other sessions and gives this browser a new one.
 */
export function ChangePasswordPage() {
  const t = useT();
  const qc = useQueryClient();
  const [done, setDone] = useState(false);
  const [problem, setProblem] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  const f = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { current: "", password: "", confirm: "" } });
  const { errors, isSubmitting } = f.formState;
  const text = (m: string | undefined) => (m ? t(m as MessageKey) : undefined);

  const onSubmit = f.handleSubmit(
    async (v) => {
      setProblem(null); setDone(false);
      try {
        await unwrapVoid(api.POST("/auth/password", { body: { currentPassword: v.current, newPassword: v.password } }));
        f.reset({ current: "", password: "", confirm: "" });
        setDone(true);
        void qc.invalidateQueries({ queryKey: qk.session });
      } catch (e) {
        const items = isApiProblem(e) ? e.errors : [];
        const pw = items.find((x) => x.field === "newPassword");
        if (items.some((x) => x.field === "currentPassword")) f.setError("current", { type: "server", message: "account.password.currentWrong" });
        else if (pw) f.setError("password", { type: "server", message: PASSWORD_RULE[pw.rule] ?? "form.error.password.weak" });
        else setProblem(e);
        f.setValue("current", ""); f.setValue("confirm", "");
        setNonce((n) => n + 1);
      }
    },
    () => setNonce((n) => n + 1),
  );

  const summary = (Object.keys(LABEL) as (keyof Values)[]).filter((k) => errors[k]).map((k) => ({ name: k, label: t(LABEL[k]) }));
  return (
    <div className="stack">
      <PageHeading titleKey="account.password.title" lead={t("account.password.lead")} />
      <ErrorSummary errors={summary} nonce={nonce} />
      {done ? <Alert tone="success">{t("account.password.done")}</Alert> : null}
      {problem ? (
        <Alert tone="danger">
          {t(problemMessageKey(problem))}
          {traceIdOf(problem) ? <small> {t("error.trace.label")}: <bdi dir="ltr">{traceIdOf(problem)}</bdi></small> : null}
        </Alert>
      ) : null}
      <form onSubmit={onSubmit} noValidate className="stack">
        <Input id="field-current" label={t(LABEL.current)} type="password" autoComplete="current-password" required dir="ltr" {...f.register("current")} error={text(errors.current?.message)} />
        <Input id="field-password" label={t(LABEL.password)} help={t("auth.verify.password.help")} type="password" autoComplete="new-password" required dir="ltr" {...f.register("password")} error={text(errors.password?.message)} />
        <Input id="field-confirm" label={t(LABEL.confirm)} type="password" autoComplete="new-password" required dir="ltr" {...f.register("confirm")} error={text(errors.confirm?.message)} />
        <div className="form-actions">
          <Button type="submit" variant="primary" loading={isSubmitting}>{t("account.password.submit")}</Button>
          <Link className="ds-btn ds-btn-quiet" to="/account"><span className="ds-btn-label">{t("nav.account")}</span></Link>
        </div>
      </form>
    </div>
  );
}
