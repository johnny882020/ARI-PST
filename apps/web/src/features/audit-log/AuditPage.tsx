import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, Badge, Button, Pagination, Select, Table, type TableColumn } from "@ari/design-system";
import { unwrap, type AuditEvent } from "@ari/api-client";
import { api } from "../../lib/api";
import { qk } from "../../lib/query";
import { useLocale, useT } from "../../app/locale";
import { PageHeading } from "../../shared/page";
import { ErrorPanel } from "../../shared/errors";
import { fmtDateTime } from "../../lib/format";

export function AuditPage() {
  const t = useT();
  const { locale } = useLocale();
  const [outcome, setOutcome] = useState("");
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const query = { limit: 25, cursor: cursors[cursors.length - 1], outcome: (outcome || undefined) as never };
  const q = useQuery({ queryKey: qk.audit(query), queryFn: () => unwrap(api.GET("/audit-events", { params: { query } })), placeholderData: (p) => p });
  const verify = useMutation({ mutationFn: () => unwrap(api.POST("/audit-events/verify", { body: {} })) });
  const cols: TableColumn<AuditEvent>[] = [
    { key: "seq", header: "#", numeric: true, render: (e) => e.seq },
    { key: "at", header: t("audit.col.time"), render: (e) => fmtDateTime(e.occurredAt, locale) },
    { key: "role", header: t("audit.col.role"), render: (e) => e.actorRole ?? "—" },
    { key: "action", header: t("audit.col.action"), render: (e) => <bdi dir="ltr">{e.action}</bdi> },
    { key: "obj", header: t("audit.col.object"), render: (e) => <bdi dir="ltr">{e.objectType ?? "—"}</bdi> },
    { key: "outcome", header: t("audit.col.outcome"), render: (e) => <Badge tone={e.outcome === "success" ? "success" : "danger"}>{t(`audit.outcome.${e.outcome}` as never)}</Badge> },
  ];
  return (
    <div className="stack">
      <PageHeading titleKey="audit.title" lead={t("audit.lead")} actions={<Button onClick={() => verify.mutate()} loading={verify.isPending}>{t("audit.verify")}</Button>} />
      {verify.data ? <Alert tone={verify.data.intact ? "success" : "danger"}>{t(verify.data.intact ? "audit.verify.ok" : "audit.verify.broken")}</Alert> : null}
      <Select label={t("audit.col.outcome")} value={outcome} onChange={(e) => { setOutcome(e.target.value); setCursors([undefined]); }} options={[{ value: "", label: t("common.all") }, ...(["success", "denied", "error"] as const).map((o) => ({ value: o, label: t(`audit.outcome.${o}`) }))]} />
      <Table caption={t("audit.caption")} columns={cols} rows={q.data?.items ?? []} rowKey={(e) => e.id} loading={q.isPending} error={q.isError ? <ErrorPanel error={q.error} onRetry={() => void q.refetch()} /> : undefined} empty={t("table.empty.title")} />
      <Pagination hasPrevious={cursors.length > 1} hasNext={!!q.data?.nextCursor} onPrevious={() => setCursors((c) => c.slice(0, -1))} onNext={() => setCursors((c) => [...c, q.data!.nextCursor!])} />
    </div>
  );
}
