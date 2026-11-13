import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, useBlocker, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Alert, Button, Card, Dialog, Input, Skeleton, Textarea, Checkbox } from "@ari/design-system";
import { idempotencyKey, unwrap } from "@ari/api-client";
import { api } from "../../lib/api";
import { qk } from "../../lib/query";
import { useLocale, useT } from "../../app/locale";
import { PageHeading } from "../../shared/page";
import { ErrorPanel } from "../../shared/errors";
import { applyProblemToForm, ErrorSummary, useErrorText } from "../../shared/forms";
import { problemMessageKey } from "../../shared/problem-message";
import { fmtDateTime } from "../../lib/format";
import { looksIdentifying } from "../../shared/identifier-warning";
import { useCriteriaText } from "./CartPage";

const schema = z.object({
  researchQuestion: z.string().trim().min(10, "form.error.required").max(4000),
  applicantEthicsRef: z.string().trim().regex(/^[A-Za-z0-9._/-]{3,64}$/, "form.error.ethicsRef"),
  plannedUse: z.string().trim().min(10, "form.error.required").max(4000),
  fundingSources: z.string().trim().min(2, "form.error.required").max(1000),
  declaration: z.literal(true, { errorMap: () => ({ message: "form.error.declaration" }) }),
});
type Values = z.infer<typeof schema>;
type Field = keyof Omit<Values, "declaration">;

const STEPS: { key: string; fields: (keyof Values)[] }[] = [
  { key: "question", fields: ["researchQuestion"] },
  { key: "approvals", fields: ["applicantEthicsRef"] },
  { key: "use", fields: ["plannedUse"] },
  { key: "funding", fields: ["fundingSources"] },
  { key: "review", fields: ["declaration"] },
];

export function RequestFormPage() {
  const [params] = useSearchParams();
  const id = params.get("draft");
  if (!id || !/^req_[0-9A-Z]{26}$/.test(id)) return <Navigate to="/cart" replace />;
  return <Wizard id={id} />;
}

function Wizard({ id }: { id: string }) {
  const t = useT();
  const { locale } = useLocale();
  const errText = useErrorText();
  const nav = useNavigate();
  const qc = useQueryClient();
  const text = useCriteriaText();
  const key = useRef(idempotencyKey());
  const [step, setStep] = useState(0);
  const [nonce, setNonce] = useState(0);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const draft = useQuery({ queryKey: qk.request(id), queryFn: () => unwrap(api.GET("/requests/{requestId}", { params: { path: { requestId: id } } })), staleTime: Infinity });
  const f = useForm<Values>({ resolver: zodResolver(schema), mode: "onSubmit", defaultValues: { researchQuestion: "", applicantEthicsRef: "", plannedUse: "", fundingSources: "", declaration: undefined as unknown as true } });
  const { errors, isDirty } = f.formState;

  useEffect(() => {
    const d = draft.data;
    if (d) f.reset({ researchQuestion: d.researchQuestion ?? "", applicantEthicsRef: d.applicantEthicsRef ?? "", plannedUse: d.plannedUse ?? "", fundingSources: d.fundingSources ?? "", declaration: undefined as unknown as true });
  }, [draft.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback(async () => {
    const v = f.getValues();
    await unwrap(api.PATCH("/requests/{requestId}", { params: { path: { requestId: id } }, body: { researchQuestion: v.researchQuestion, applicantEthicsRef: v.applicantEthicsRef, plannedUse: v.plannedUse, fundingSources: v.fundingSources } }));
    setSavedAt(new Date().toISOString());
    f.reset(f.getValues(), { keepValues: true });
  }, [f, id]);

  // Server-side draft autosave every 30 s and on step change. Never browser storage.
  useEffect(() => {
    const timer = setInterval(() => { if (f.formState.isDirty && !submitted) void save().catch(() => undefined); }, 30_000);
    return () => clearInterval(timer);
  }, [f, save, submitted]);

  const blocker = useBlocker(() => isDirty && !submitted);

  const submit = useMutation({
    mutationFn: async () => { await save(); return unwrap(api.POST("/requests/{requestId}/submit", { params: { path: { requestId: id }, header: { "Idempotency-Key": key.current } } as never })); },
    onSuccess: (r) => { setSubmitted(true); qc.setQueryData(qk.request(r.id), r); void qc.invalidateQueries({ queryKey: ["requests", "list"] }); },
    onError: (e) => { applyProblemToForm(e, f.setError, ["researchQuestion", "applicantEthicsRef", "plannedUse", "fundingSources"]); setNonce((n) => n + 1); },
  });

  const next = async () => {
    const ok = await f.trigger(STEPS[step]!.fields as never);
    if (!ok) { setNonce((n) => n + 1); return; }
    if (step < STEPS.length - 1) { if (isDirty) void save().catch(() => undefined); setStep(step + 1); }
  };

  if (draft.isPending) return <Skeleton lines={6} />;
  if (draft.isError) return <ErrorPanel error={draft.error} onRetry={() => void draft.refetch()} />;
  if (submitted && submit.data) {
    return (
      <div className="stack">
        <PageHeading titleKey="requests.form.done.title" />
        <Alert tone="success">{t("requests.form.done.body")}</Alert>
        <p>{t("requests.form.done.id")} <bdi dir="ltr" data-testid="request-id">{submit.data.id}</bdi></p>
        <div className="form-actions"><Button variant="primary" onClick={() => nav(`/requests/${submit.data!.id}`)}>{t("requests.form.done.track")}</Button></div>
      </div>
    );
  }

  const cur = STEPS[step]!;
  const values = f.watch();
  const stepErrors = cur.fields.filter((k) => errors[k]).map((k) => ({ name: k, label: t(`requests.form.${k}.label` as never) }));
  const idWarn = (name: Field) => (looksIdentifying(values[name] ?? "") ? t("form.error.identifier") : undefined);
  const free = (name: Field, rows = 6) => (
    <Textarea id={`field-${name}`} label={t(`requests.form.${name}.label` as never)} help={t(`requests.form.${name}.help` as never)} rows={rows} required autoComplete="off" {...f.register(name)} error={errText(errors[name]?.message)} />
  );

  return (
    <div className="stack narrow" style={{ padding: 0 }}>
      <PageHeading titleKey="requests.form.title" lead={t("requests.form.progress", { current: step + 1, total: STEPS.length })} />
      <Alert tone="info">{t("consent.freetext.warning")}</Alert>
      <ErrorSummary errors={stepErrors} nonce={nonce} />
      {submit.isError && !stepErrors.length ? <div role="alert"><Alert tone="danger">{t(problemMessageKey(submit.error))}</Alert></div> : null}
      <form noValidate onSubmit={(e) => { e.preventDefault(); if (step === STEPS.length - 1) void f.handleSubmit(() => submit.mutate(), () => setNonce((n) => n + 1))(); else void next(); }}>
        <Card as="div" heading={t(`requests.form.step.${cur.key}` as never)} headingLevel={2}>
          {cur.key === "question" ? <>{free("researchQuestion")}{idWarn("researchQuestion") ? <Alert tone="warning">{idWarn("researchQuestion")}</Alert> : null}</> : null}
          {cur.key === "approvals" ? <Input id="field-applicantEthicsRef" label={t("requests.form.applicantEthicsRef.label")} help={t("requests.form.applicantEthicsRef.help")} required dir="ltr" autoComplete="off" {...f.register("applicantEthicsRef")} error={errText(errors.applicantEthicsRef?.message)} /> : null}
          {cur.key === "use" ? <>{free("plannedUse")}{idWarn("plannedUse") ? <Alert tone="warning">{idWarn("plannedUse")}</Alert> : null}</> : null}
          {cur.key === "funding" ? free("fundingSources", 3) : null}
          {cur.key === "review" ? (
            <div className="stack">
              <dl>
                {(["researchQuestion", "applicantEthicsRef", "plannedUse", "fundingSources"] as const).map((k) => (
                  <div key={k}><dt><strong>{t(`requests.form.${k}.label` as never)}</strong></dt><dd style={{ whiteSpace: "pre-wrap", marginInlineStart: 0 }}>{values[k]}</dd></div>
                ))}
                <div><dt><strong>{t("requests.form.items")}</strong></dt>{(draft.data.items ?? []).map((it) => <dd key={it.id} style={{ marginInlineStart: 0 }}>{text(it.criteria).join(" · ") || t("cart.item.allSamples")}</dd>)}</div>
              </dl>
              <Checkbox id="field-declaration" label={t("requests.form.declaration")} error={errText(errors.declaration?.message)} {...f.register("declaration")} />
            </div>
          ) : null}
        </Card>
        <div className="form-actions">
          {step > 0 ? <Button onClick={() => setStep(step - 1)}>{t("common.action.back")}</Button> : null}
          {step < STEPS.length - 1 ? <Button type="submit" variant="primary">{t("common.action.continue")}</Button> : <Button type="submit" variant="primary" loading={submit.isPending}>{t("request.action.submit")}</Button>}
          <Button variant="quiet" onClick={() => void save().catch(() => undefined)} disabled={!isDirty}>{t("requests.form.saveDraft")}</Button>
          <span className="muted" role="status">{savedAt ? t("requests.form.savedAt", { time: fmtDateTime(savedAt, locale) }) : ""}</span>
        </div>
      </form>
      <Dialog open={blocker.state === "blocked"} onClose={() => blocker.reset?.()} title={t("requests.form.unsaved.title")} footer={<><Button variant="primary" onClick={() => blocker.reset?.()}>{t("requests.form.unsaved.stay")}</Button><Button onClick={() => blocker.proceed?.()}>{t("requests.form.unsaved.leave")}</Button></>}>
        <p>{t("requests.form.unsaved.body")}</p>
      </Dialog>
    </div>
  );
}
