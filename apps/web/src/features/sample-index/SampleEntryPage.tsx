import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Alert, Button, Card, Checkbox, Input, Select } from "@ari/design-system";
import { idempotencyKey, unwrap } from "@ari/api-client";
import { api } from "../../lib/api";
import { useT } from "../../app/locale";
import { PageHeading } from "../../shared/page";
import { ENUMS, useCenters, useDiagnoses, useEnumLabel } from "../../shared/enums";
import { applyProblemToForm, ErrorSummary, useErrorText } from "../../shared/forms";
import { problemMessageKey } from "../../shared/problem-message";

const MONTH = /^(19[89][0-9]|20[0-9]{2})-(0[1-9]|1[0-2])$/;
const schema = z.object({
  sourceCenterId: z.string().min(1, "form.error.required"),
  diagnosisCode: z.string().min(1, "form.error.required"),
  ageBandAtDiagnosis: z.enum(ENUMS.ageBand, { errorMap: () => ({ message: "form.error.required" }) }),
  sex: z.enum(ENUMS.sex, { errorMap: () => ({ message: "form.error.required" }) }),
  sampleType: z.enum(ENUMS.sampleType, { errorMap: () => ({ message: "form.error.required" }) }),
  availability: z.enum(ENUMS.availability, { errorMap: () => ({ message: "form.error.required" }) }),
  clinicalTimepoint: z.enum(ENUMS.timepoint, { errorMap: () => ({ message: "form.error.required" }) }),
  collectionMonth: z.string().regex(MONTH, "form.error.month"),
  attachedData: z.array(z.enum(ENUMS.attachedData)),
});
type Values = z.infer<typeof schema>;
const FIELDS = ["sourceCenterId", "diagnosisCode", "ageBandAtDiagnosis", "sex", "sampleType", "availability", "clinicalTimepoint", "collectionMonth"] as const;
const LABEL: Record<(typeof FIELDS)[number], string> = {
  sourceCenterId: "samples.col.center", diagnosisCode: "samples.col.diagnosis", ageBandAtDiagnosis: "samples.field.ageBand", sex: "samples.field.sex",
  sampleType: "samples.col.type", availability: "samples.col.availability", clinicalTimepoint: "samples.col.timepoint", collectionMonth: "samples.col.collected",
};

export function SampleEntryPage() {
  const t = useT();
  const qc = useQueryClient();
  const errText = useErrorText();
  const enumLabel = useEnumLabel();
  const dx = useDiagnoses();
  const centers = useCenters();
  const [count, setCount] = useState(0);
  const [lastCode, setLastCode] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const first = useRef<HTMLSelectElement | null>(null);
  const f = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { sourceCenterId: "", diagnosisCode: "", attachedData: [], collectionMonth: "" } as never });
  const { errors } = f.formState;

  const create = useMutation({
    mutationFn: (v: Values) => unwrap(api.POST("/samples", { params: { header: { "Idempotency-Key": idempotencyKey() } } as never, body: v })),
    onSuccess: (s, v) => {
      setCount((c) => c + 1); setLastCode(s.sampleCode);
      void qc.invalidateQueries({ queryKey: ["samples"] });
      // Save and add another: keep the center, clear the rest, focus the first field.
      f.reset({ sourceCenterId: v.sourceCenterId, diagnosisCode: "", attachedData: [], collectionMonth: "" } as never);
      setTimeout(() => first.current?.focus(), 0);
    },
    onError: (e) => { applyProblemToForm(e, f.setError, FIELDS as unknown as string[]); setNonce((n) => n + 1); },
  });
  const onSubmit = f.handleSubmit((v) => create.mutate(v), () => setNonce((n) => n + 1));
  const summary = FIELDS.filter((k) => errors[k]).map((k) => ({ name: k, label: t(LABEL[k] as never) }));
  const reg = (name: (typeof FIELDS)[number]) => f.register(name);
  const sel = (name: (typeof FIELDS)[number], opts: { value: string; label: string }[], refFirst = false) => {
    const r = reg(name);
    return <Select id={`field-${name}`} label={t(LABEL[name] as never)} required placeholder={t("samples.entry.choose")} options={opts} {...r} ref={(el) => { r.ref(el); if (refFirst) first.current = el; }} error={errText(errors[name]?.message)} />;
  };
  return (
    <div className="stack narrow" style={{ padding: 0 }}>
      <PageHeading titleKey="samples.entry.title" lead={t("samples.entry.lead")} actions={<Link className="ds-btn ds-btn-secondary" to="/import/new"><span className="ds-btn-label">{t("nav.import")}</span></Link>} />
      <Alert tone="warning">{t("samples.entry.noIdentifiers")}</Alert>
      {lastCode ? <div role="status"><Alert tone="success">{t("samples.entry.saved", { code: lastCode })}</Alert></div> : null}
      {count > 0 ? <p className="muted">{t("samples.entry.repeatValue", { count })}</p> : null}
      <ErrorSummary errors={summary} nonce={nonce} />
      {create.isError && !summary.length ? <div role="alert"><Alert tone="danger">{t(problemMessageKey(create.error))}</Alert></div> : null}
      <form onSubmit={onSubmit} noValidate className="stack">
        {sel("sourceCenterId", centers.centers.map((c) => ({ value: c.id, label: centers.label(c.id) })), true)}
        {sel("diagnosisCode", dx.terms.filter((d) => d.level === "type").map((d) => ({ value: d.diagnosisCode, label: dx.label(d.diagnosisCode) })))}
        {sel("ageBandAtDiagnosis", ENUMS.ageBand.map((v) => ({ value: v, label: enumLabel("ageBand", v) })))}
        {sel("sex", ENUMS.sex.map((v) => ({ value: v, label: enumLabel("sex", v) })))}
        {sel("sampleType", ENUMS.sampleType.map((v) => ({ value: v, label: enumLabel("sampleType", v) })))}
        {sel("availability", ENUMS.availability.map((v) => ({ value: v, label: enumLabel("availability", v) })))}
        {sel("clinicalTimepoint", ENUMS.timepoint.map((v) => ({ value: v, label: enumLabel("timepoint", v) })))}
        <Input id="field-collectionMonth" label={t("samples.col.collected")} help={t("samples.entry.month.help")} type="month" required dir="ltr" {...reg("collectionMonth")} error={errText(errors.collectionMonth?.message)} />
        <Card as="div" heading={t("samples.field.attachedData")} headingLevel={3}>
          <Controller control={f.control} name="attachedData" render={({ field }) => (
            <div className="stack">
              {ENUMS.attachedData.map((a) => (
                <Checkbox key={a} label={enumLabel("attachedData", a)} checked={field.value.includes(a)} onChange={(e) => field.onChange(e.target.checked ? [...field.value, a] : field.value.filter((x) => x !== a))} />
              ))}
            </div>
          )} />
        </Card>
        <div className="form-actions"><Button type="submit" variant="primary" loading={create.isPending}>{t("samples.entry.saveNext")}</Button></div>
      </form>
    </div>
  );
}
