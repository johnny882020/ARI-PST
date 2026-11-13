import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Alert, Badge, Pagination, Select, Table, type TableColumn } from "@ari/design-system";
import { unwrap, type Sample } from "@ari/api-client";
import { api } from "../../lib/api";
import { qk } from "../../lib/query";
import { useLocale, useT } from "../../app/locale";
import { useCan, useSession } from "../../app/session";
import { PageHeading } from "../../shared/page";
import { ErrorPanel } from "../../shared/errors";
import { ENUMS, useCenters, useDiagnoses, useEnumLabel } from "../../shared/enums";
import { fmtMonth } from "../../lib/format";

export function StaleBadge({ s }: { s?: Sample["staleness"] }) {
  const enumLabel = useEnumLabel();
  if (!s) return null;
  return <Badge tone={s === "fresh" ? "success" : s === "due_soon" ? "warning" : "danger"}>{enumLabel("staleness", s)}</Badge>;
}

export function SamplesPage() {
  const t = useT();
  const { locale } = useLocale();
  const enumLabel = useEnumLabel();
  const dx = useDiagnoses();
  const centers = useCenters();
  const { state } = useSession();
  const canWrite = useCan("samples.write");
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [availability, setAvailability] = useState("");
  const [staleness, setStaleness] = useState("");
  const cursor = cursors[cursors.length - 1];
  const query = { limit: 10, cursor, availability: (availability || undefined) as never, staleness: (staleness || undefined) as never };
  const q = useQuery({ queryKey: qk.samples(query), queryFn: () => unwrap(api.GET("/samples", { params: { query } })), placeholderData: (p) => p });
  const cols: TableColumn<Sample>[] = [
    { key: "code", header: t("samples.col.code"), render: (s) => <Link to={`/samples/${s.sampleCode}`}><bdi dir="ltr">{s.sampleCode}</bdi></Link> },
    { key: "dx", header: t("samples.col.diagnosis"), render: (s) => dx.label(s.diagnosisCode) },
    { key: "type", header: t("samples.col.type"), render: (s) => enumLabel("sampleType", s.sampleType) },
    { key: "avail", header: t("samples.col.availability"), render: (s) => enumLabel("availability", s.availability) },
    { key: "month", header: t("samples.col.collected"), render: (s) => fmtMonth(s.collectionMonth, locale) },
    { key: "center", header: t("samples.col.center"), render: (s) => centers.label(s.sourceCenterId) },
    { key: "stale", header: t("samples.col.freshness"), render: (s) => <StaleBadge s={s.staleness} /> },
  ];
  const centerId = state.status === "authenticated" ? state.centerId : null;
  return (
    <div className="stack">
      <PageHeading titleKey="samples.title" actions={canWrite ? <Link className="ds-btn ds-btn-primary" to="/samples/new"><span className="ds-btn-label">{t("samples.new")}</span></Link> : undefined} />
      {!canWrite && centerId ? <Alert tone="info">{t("samples.scope.center", { center: centers.label(centerId) })}</Alert> : null}
      <div className="row">
        <Select label={t("samples.col.availability")} value={availability} onChange={(e) => { setAvailability(e.target.value); setCursors([undefined]); }} options={[{ value: "", label: t("common.all") }, ...ENUMS.availability.map((v) => ({ value: v, label: enumLabel("availability", v) }))]} />
        <Select label={t("samples.col.freshness")} value={staleness} onChange={(e) => { setStaleness(e.target.value); setCursors([undefined]); }} options={[{ value: "", label: t("common.all") }, ...ENUMS.staleness.map((v) => ({ value: v, label: enumLabel("staleness", v) }))]} />
      </div>
      <Table caption={t("samples.caption")} columns={cols} rows={q.data?.items ?? []} rowKey={(s) => s.sampleCode} loading={q.isPending} error={q.isError ? <ErrorPanel error={q.error} onRetry={() => void q.refetch()} /> : undefined} empty={t("coordinator.empty.title")} />
      <Pagination hasPrevious={cursors.length > 1} hasNext={!!q.data?.nextCursor} onPrevious={() => setCursors((c) => c.slice(0, -1))} onNext={() => setCursors((c) => [...c, q.data!.nextCursor!])} />
    </div>
  );
}
