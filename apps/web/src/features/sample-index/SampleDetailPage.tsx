import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Badge, Button, Card, EmptyState, Select, Skeleton } from "@ari/design-system";
import { isApiProblem, unwrap, unwrapVoid } from "@ari/api-client";
import { api } from "../../lib/api";
import { qk } from "../../lib/query";
import { useLocale, useT } from "../../app/locale";
import { useCan } from "../../app/session";
import { PageHeading } from "../../shared/page";
import { ErrorPanel } from "../../shared/errors";
import { useCenters, useDiagnoses, useEnumLabel } from "../../shared/enums";
import { fmtDateTime, fmtMonth } from "../../lib/format";
import { StaleBadge } from "./SamplesPage";
import { problemMessageKey } from "../../shared/problem-message";
import { CENTER_SYSTEM_URL_TEMPLATE, centerSystemUrl } from "./center-link";

const FLAGS = ["wrong_field", "withdrawn_consent", "duplicate", "other"] as const;

export function SampleDetailPage() {
  const t = useT();
  const { locale } = useLocale();
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const enumLabel = useEnumLabel();
  const dx = useDiagnoses();
  const centers = useCenters();
  const canVerify = useCan("samples.verify");
  const [flag, setFlag] = useState("");
  const [flagged, setFlagged] = useState(false);
  const q = useQuery({ queryKey: qk.sample(id), queryFn: () => unwrap(api.GET("/samples/{sampleId}", { params: { path: { sampleId: id } } })) });
  const verify = useMutation({
    mutationFn: () => unwrap(api.POST("/samples/{sampleId}/verify", { params: { path: { sampleId: id } } })),
    onSuccess: (s) => { qc.setQueryData(qk.sample(id), s); void qc.invalidateQueries({ queryKey: ["samples", "list"] }); },
  });
  const flagMut = useMutation({
    mutationFn: () => unwrapVoid(api.POST("/samples/{sampleId}/flag", { params: { path: { sampleId: id } }, body: { reasonCode: flag as never } })),
    onSuccess: () => setFlagged(true),
  });
  if (q.isPending) return <Skeleton lines={8} />;
  // Another center's record (or a missing one): RLS answers 404, a role check 403. Same clear page for both, no detail.
  if (q.isError && isApiProblem(q.error) && (q.error.status === 404 || q.error.status === 403)) return <SampleNotAvailable />;
  if (q.isError) return <ErrorPanel error={q.error} />;
  const s = q.data;
  const rows: [string, React.ReactNode][] = [
    [t("samples.col.diagnosis"), dx.label(s.diagnosisCode)],
    [t("samples.col.center"), centers.label(s.sourceCenterId)],
    [t("samples.field.ageBand"), enumLabel("ageBand", s.ageBandAtDiagnosis)],
    [t("samples.field.sex"), enumLabel("sex", s.sex)],
    [t("samples.col.type"), enumLabel("sampleType", s.sampleType)],
    [t("samples.col.availability"), <Badge key="a">{enumLabel("availability", s.availability)}</Badge>],
    [t("samples.field.quantity"), enumLabel("quantity", s.quantityClass)],
    [t("samples.col.timepoint"), enumLabel("timepoint", s.clinicalTimepoint)],
    [t("samples.col.collected"), fmtMonth(s.collectionMonth, locale)],
    [t("samples.field.attachedData"), s.attachedData.map((a) => enumLabel("attachedData", a)).join(", ") || "—"],
    [t("samples.field.consent"), enumLabel("consent", s.consentStatus)],
    [t("samples.field.ethicsRef"), <bdi key="e" dir="ltr">{s.ethicsApprovalRef ?? "—"}</bdi>],
    [t("samples.field.contact"), s.contactRef],
    [t("samples.field.lastVerified"), fmtDateTime(s.lastVerifiedAt, locale)],
    [t("samples.col.freshness"), <StaleBadge key="f" s={s.staleness} />],
  ];
  return (
    <div className="stack">
      <PageHeading titleKey="samples.detail.title" lead={<bdi dir="ltr">{s.sampleCode}</bdi>} actions={canVerify ? <Button variant="primary" loading={verify.isPending} onClick={() => verify.mutate()}>{t("samples.verify")}</Button> : <Link to="/samples">{t("common.action.back")}</Link>} />
      <Alert tone="info">{t("samples.noIdentifiers")}</Alert>
      {verify.isSuccess ? <Alert tone="success">{t("samples.verified")}</Alert> : null}
      {verify.isError ? <Alert tone="danger">{t(problemMessageKey(verify.error))}</Alert> : null}
      <Card as="div" heading={t("samples.detail.fields")} headingLevel={2}>
        <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "0.5rem 1.5rem" }}>
          {rows.map(([k, v]) => (<><dt key={`k${k}`} className="muted">{k}</dt><dd key={`v${k}`} style={{ margin: 0 }}>{v}</dd></>))}
        </dl>
      </Card>
      <LocalSystemCard sampleCode={s.sampleCode} centerCode={centers.centers.find((c) => c.id === s.sourceCenterId)?.code ?? ""} />
      {canVerify ? (
        <Card as="div" heading={t("samples.flag.title")} headingLevel={2}>
          {flagged ? <Alert tone="success">{t("samples.flag.done")}</Alert> : (
            <form className="row" onSubmit={(e) => { e.preventDefault(); if (flag) flagMut.mutate(); }}>
              <Select label={t("samples.flag.reason")} value={flag} onChange={(e) => setFlag(e.target.value)} placeholder={t("samples.flag.placeholder")} options={FLAGS.map((f) => ({ value: f, label: t(`samples.flag.reason.${f}` as never) }))} />
              <Button type="submit" disabled={!flag} loading={flagMut.isPending}>{t("samples.flag.submit")}</Button>
            </form>
          )}
        </Card>
      ) : null}
    </div>
  );
}

function SampleNotAvailable() {
  const t = useT();
  return (
    <div className="stack">
      <PageHeading titleKey="samples.notAvailable.title" actions={<Link to="/samples">{t("common.action.back")}</Link>} />
      <EmptyState title={t("samples.notAvailable.title")} icon="lock" headingLevel={2}>{t("samples.notAvailable.body")}</EmptyState>
    </div>
  );
}

/** Link-out to the center's own system (configurable template), or a clearly labelled reference when none is set. */
export function LocalSystemCard({ sampleCode, centerCode, template = CENTER_SYSTEM_URL_TEMPLATE }: { sampleCode: string; centerCode: string; template?: string }) {
  const t = useT();
  const url = centerCode ? centerSystemUrl(template, { sampleCode, centerCode }) : null;
  return (
    <Card as="div" heading={t("samples.local.title")} headingLevel={2}>
      <p>{t("samples.local.body")}</p>
      <p><span className="muted">{t("samples.local.code")}</span> <bdi dir="ltr"><code>{sampleCode}</code></bdi></p>
      {url ? (
        <p><a href={url} target="_blank" rel="noopener noreferrer">{t("samples.local.link")} <span className="muted">{t("samples.local.newTab")}</span></a></p>
      ) : <p className="muted">{t("samples.local.noLink")}</p>}
    </Card>
  );
}
