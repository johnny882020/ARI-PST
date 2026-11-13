import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AggregateCountTile, Select, Table, type TableColumn } from "@ari/design-system";
import { unwrap, type Sample } from "@ari/api-client";
import { api } from "../../lib/api";
import { qk } from "../../lib/query";
import { useLocale, useT } from "../../app/locale";
import { useCan, useSession } from "../../app/session";
import { PageHeading } from "../../shared/page";
import { ErrorPanel } from "../../shared/errors";
import { useCenters, useDiagnoses } from "../../shared/enums";
import { fmtDate } from "../../lib/format";
import { StaleBadge } from "../sample-index/SamplesPage";

/** Staleness board (REQ-067). Clinician: own center only (taken from the session, never the URL). */
export function FreshnessPage() {
  const t = useT();
  const { locale } = useLocale();
  const { state } = useSession();
  const coordinator = useCan("samples.write");
  const centers = useCenters();
  const dx = useDiagnoses();
  const own = state.status === "authenticated" ? state.centerId : null;
  const [picked, setPicked] = useState("");
  const centerId = coordinator ? picked || centers.centers[0]?.id || "" : own ?? "";
  const sum = useQuery({ queryKey: qk.staleness(centerId), enabled: !!centerId, queryFn: () => unwrap(api.GET("/centers/{centerId}/staleness", { params: { path: { centerId } } })) });
  const query = { staleness: "stale" as const, centerId: centerId || undefined, limit: 50 };
  const stale = useQuery({ queryKey: qk.samples(query), enabled: !!centerId, queryFn: () => unwrap(api.GET("/samples", { params: { query } })) });
  const cols: TableColumn<Sample>[] = [
    { key: "code", header: t("samples.col.code"), render: (s) => <Link to={`/samples/${s.sampleCode}`}><bdi dir="ltr">{s.sampleCode}</bdi></Link> },
    { key: "dx", header: t("samples.col.diagnosis"), render: (s) => dx.label(s.diagnosisCode) },
    { key: "last", header: t("samples.field.lastVerified"), render: (s) => fmtDate(s.lastVerifiedAt, locale) },
    { key: "f", header: t("samples.col.freshness"), render: (s) => <StaleBadge s={s.staleness} /> },
  ];
  const d = sum.data;
  return (
    <div className="stack">
      <PageHeading titleKey="freshness.title" lead={t("freshness.lead")} />
      {coordinator ? <Select label={t("samples.col.center")} value={centerId} onChange={(e) => setPicked(e.target.value)} options={centers.centers.map((c) => ({ value: c.id, label: centers.label(c.id) }))} /> : null}
      {sum.isError ? <ErrorPanel error={sum.error} /> : (
        <div className="grid-tiles">
          <AggregateCountTile label={t("freshness.total")} state={d ? "value" : "loading"} value={d?.samplesTotal} />
          <AggregateCountTile label={t("freshness.dueSoon")} state={d ? "value" : "loading"} value={d?.dueSoonCount} />
          <AggregateCountTile label={t("freshness.stale")} state={d ? "value" : "loading"} value={d?.staleCount} />
          <AggregateCountTile label={t("freshness.sla")} state={d ? "value" : "loading"} value={d?.slaDays} unit={t("freshness.days")} />
        </div>
      )}
      <Table caption={t("freshness.list.caption")} columns={cols} rows={stale.data?.items ?? []} rowKey={(s) => s.sampleCode} loading={stale.isPending && stale.fetchStatus !== "idle"} error={stale.isError ? <ErrorPanel error={stale.error} /> : undefined} empty={t("freshness.none")} />
    </div>
  );
}
