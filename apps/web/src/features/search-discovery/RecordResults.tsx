import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Badge, Table, type TableColumn } from "@ari/design-system";
import { unwrap, type Sample, type SearchFilters } from "@ari/api-client";
import { api } from "../../lib/api";
import { qk } from "../../lib/query";
import { useT } from "../../app/locale";
import { useCenters, useEnumLabel } from "../../shared/enums";
import { ErrorPanel } from "../../shared/errors";

/** De-identified record rows for coordinator / own-center clinician. Rows show sample_code only. */
export function RecordResults({ filters }: { filters: SearchFilters }) {
  const t = useT();
  const enumLabel = useEnumLabel();
  const centers = useCenters();
  const query = { limit: 25, sampleType: filters.sampleType?.[0], availability: filters.availability?.[0], centerId: filters.centerId?.[0] };
  const q = useQuery({ queryKey: qk.samples(query), queryFn: () => unwrap(api.GET("/samples", { params: { query } })) });
  const cols: TableColumn<Sample>[] = [
    { key: "code", header: t("samples.col.code"), render: (s) => <Link to={`/samples/${s.sampleCode}`}><bdi dir="ltr">{s.sampleCode}</bdi></Link> },
    { key: "type", header: t("samples.col.type"), render: (s) => enumLabel("sampleType", s.sampleType) },
    { key: "avail", header: t("samples.col.availability"), render: (s) => <Badge tone={s.availability === "available" ? "success" : s.availability === "limited" ? "warning" : "neutral"}>{enumLabel("availability", s.availability)}</Badge> },
    { key: "tp", header: t("samples.col.timepoint"), render: (s) => enumLabel("timepoint", s.clinicalTimepoint) },
    { key: "center", header: t("samples.col.center"), render: (s) => centers.label(s.sourceCenterId) },
  ];
  return (
    <Table caption={t("search.records.caption")} columns={cols} rows={q.data?.items ?? []} rowKey={(s) => s.sampleCode} loading={q.isPending} error={q.isError ? <ErrorPanel error={q.error} /> : undefined} empty={t("table.empty.title")} />
  );
}
