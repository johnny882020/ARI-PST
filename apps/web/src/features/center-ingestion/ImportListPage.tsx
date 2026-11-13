import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Badge, Table, type TableColumn } from "@ari/design-system";
import { unwrap, type ImportJob } from "@ari/api-client";
import { api } from "../../lib/api";
import { qk } from "../../lib/query";
import { useLocale, useT } from "../../app/locale";
import { PageHeading } from "../../shared/page";
import { ErrorPanel } from "../../shared/errors";
import { fmtDateTime } from "../../lib/format";

export function ImportListPage() {
  const t = useT();
  const { locale } = useLocale();
  const q = useQuery({ queryKey: qk.importJobs, queryFn: () => unwrap(api.GET("/import-jobs", { params: { query: {} } })) });
  const cols: TableColumn<ImportJob>[] = [
    { key: "id", header: t("ingest.col.job"), render: (j) => <Link to={`/import/${j.id}`}><bdi dir="ltr">{j.id.slice(0, 12)}…</bdi></Link> },
    { key: "mode", header: t("ingest.col.mode"), render: (j) => t(`ingest.mode.${j.mode}` as never) },
    { key: "status", header: t("ingest.col.status"), render: (j) => <Badge tone={j.status === "committed" ? "success" : j.status === "rejected" || j.status === "failed" ? "danger" : "info"}>{t(`ingest.status.${j.status}` as never)}</Badge> },
    { key: "rows", header: t("ingest.col.rows"), numeric: true, render: (j) => j.totalRows ?? "—" },
    { key: "date", header: t("ingest.col.date"), render: (j) => fmtDateTime(j.createdAt, locale) },
  ];
  return (
    <div className="stack">
      <PageHeading titleKey="ingest.list.title" actions={<Link className="ds-btn ds-btn-primary" to="/import/new"><span className="ds-btn-label">{t("ingest.new")}</span></Link>} />
      <Table caption={t("ingest.list.caption")} columns={cols} rows={q.data?.items ?? []} rowKey={(j) => j.id} loading={q.isPending} error={q.isError ? <ErrorPanel error={q.error} /> : undefined} empty={t("table.empty.title")} />
    </div>
  );
}
