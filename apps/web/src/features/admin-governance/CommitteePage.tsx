import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AggregateCountTile, EmptyState, Table, type TableColumn } from "@ari/design-system";
import { unwrap, type RequestDto } from "@ari/api-client";
import { api } from "../../lib/api";
import { qk } from "../../lib/query";
import { useLocale, useT } from "../../app/locale";
import { PageHeading } from "../../shared/page";
import { ErrorPanel } from "../../shared/errors";
import { fmtDate } from "../../lib/format";

export function CommitteePage() {
  const t = useT();
  const { locale } = useLocale();
  const q = useQuery({ queryKey: qk.requests({ status: "committee_review" }), queryFn: () => unwrap(api.GET("/requests", { params: { query: { status: "committee_review" } } })) });
  const all = useQuery({ queryKey: qk.requests(), queryFn: () => unwrap(api.GET("/requests", { params: { query: {} } })) });
  const cols: TableColumn<RequestDto>[] = [
    { key: "id", header: t("requests.list.col.id"), render: (r) => <Link to={`/requests/${r.id}`}><bdi dir="ltr">{r.id.slice(0, 12)}…</bdi></Link> },
    { key: "sub", header: t("requests.list.col.submitted"), render: (r) => (r.submittedAt ? fmtDate(r.submittedAt, locale) : "—") },
    { key: "act", header: t("committee.col.action"), render: (r) => <Link to={`/requests/${r.id}/decision`}>{t("requests.decision.open")}</Link> },
  ];
  const items = all.data?.items ?? [];
  return (
    <div className="stack">
      <PageHeading titleKey="committee.title" lead={t("committee.lead")} />
      <div className="grid-tiles">
        <AggregateCountTile label={t("committee.tile.pending")} state={q.data ? "value" : "loading"} value={q.data?.items.length} />
        <AggregateCountTile label={t("committee.tile.open")} state={all.data ? "value" : "loading"} value={items.filter((r) => !["delivered", "closed", "rejected", "withdrawn"].includes(r.status)).length} />
        <AggregateCountTile label={t("committee.tile.delivered")} state={all.data ? "value" : "loading"} value={items.filter((r) => r.status === "delivered").length} />
      </div>
      <Table caption={t("committee.queue.caption")} columns={cols} rows={q.data?.items ?? []} rowKey={(r) => r.id} loading={q.isPending} error={q.isError ? <ErrorPanel error={q.error} /> : undefined} empty={<EmptyState title={t("committee.empty.title")} />} />
      <p className="muted">{t("committee.sod")}</p>
    </div>
  );
}
