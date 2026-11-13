import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Badge, EmptyState, Table, type TableColumn } from "@ari/design-system";
import { unwrap, type RequestDto } from "@ari/api-client";
import { api } from "../../lib/api";
import { qk } from "../../lib/query";
import { useLocale, useT } from "../../app/locale";
import { useCan } from "../../app/session";
import { PageHeading } from "../../shared/page";
import { ErrorPanel } from "../../shared/errors";
import { fmtDate } from "../../lib/format";
import type { MessageKey } from "@ari/i18n";

export function RequestsPage() {
  const t = useT();
  const { locale } = useLocale();
  const own = useCan("requests.own");
  const q = useQuery({ queryKey: qk.requests(), queryFn: () => unwrap(api.GET("/requests", { params: { query: {} } })), refetchInterval: 30_000 });
  const cols: TableColumn<RequestDto>[] = [
    { key: "id", header: t("requests.list.col.id"), render: (r) => <Link to={`/requests/${r.id}`}><bdi dir="ltr">{r.id.slice(0, 12)}…</bdi></Link> },
    { key: "status", header: t("requests.list.col.status"), render: (r) => <Badge tone={r.status === "needs_info" ? "warning" : r.status === "rejected" ? "danger" : r.status === "closed" && r.closeReason === "delivered" ? "success" : "info"}>{t(`requests.status.${r.status}` as MessageKey)}</Badge> },
    { key: "submitted", header: t("requests.list.col.submitted"), render: (r) => (r.submittedAt ? fmtDate(r.submittedAt, locale) : "—") },
  ];
  return (
    <div className="stack">
      <PageHeading titleKey={own ? "requests.list.title.own" : "requests.list.title.queue"} />
      <Table caption={t("requests.list.caption")} columns={cols} rows={q.data?.items ?? []} rowKey={(r) => r.id} loading={q.isPending} error={q.isError ? <ErrorPanel error={q.error} onRetry={() => void q.refetch()} /> : undefined}
        empty={<EmptyState title={t(own ? "tracker.empty.title" : "coordinator.empty.title")}>{own ? t("tracker.empty.body") : null}</EmptyState>} />
    </div>
  );
}
