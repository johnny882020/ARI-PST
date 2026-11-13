import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Badge, Button, Table, type TableColumn } from "@ari/design-system";
import { unwrap, type Registration } from "@ari/api-client";
import { api } from "../../lib/api";
import { qk } from "../../lib/query";
import { useLocale, useT } from "../../app/locale";
import { PageHeading } from "../../shared/page";
import { ErrorPanel } from "../../shared/errors";
import { fmtDate } from "../../lib/format";
import { problemMessageKey } from "../../shared/problem-message";

export function RegistrationsPage() {
  const t = useT();
  const { locale } = useLocale();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: qk.registrations, queryFn: () => unwrap(api.GET("/registrations")) });
  const decide = useMutation({
    mutationFn: (v: { id: string; outcome: "approved" | "rejected" }) => unwrap(api.POST("/registrations/{id}/decision", { params: { path: { id: v.id } }, body: { outcome: v.outcome } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.registrations }),
  });
  const cols: TableColumn<Registration>[] = [
    { key: "name", header: t("admin.reg.col.name"), render: (r) => r.displayName },
    { key: "inst", header: t("admin.reg.col.institution"), render: (r) => r.institution },
    { key: "email", header: t("admin.reg.col.email"), render: (r) => <bdi dir="ltr">{r.email}</bdi> },
    { key: "date", header: t("admin.reg.col.date"), render: (r) => fmtDate(r.requestedAt, locale) },
    { key: "status", header: t("admin.reg.col.status"), render: (r) => r.status === "pending" ? (
      <span className="row">
        <Button size="sm" variant="primary" onClick={() => decide.mutate({ id: r.id, outcome: "approved" })}>{t("admin.reg.approve")}</Button>
        <Button size="sm" onClick={() => decide.mutate({ id: r.id, outcome: "rejected" })}>{t("admin.reg.reject")}</Button>
      </span>) : <Badge tone={r.status === "approved" ? "success" : "neutral"}>{t(`admin.reg.status.${r.status}` as never)}</Badge> },
  ];
  return (
    <div className="stack">
      <PageHeading titleKey="admin.reg.title" lead={t("admin.reg.lead")} />
      {decide.isError ? <Alert tone="danger">{t(problemMessageKey(decide.error))}</Alert> : null}
      <Table caption={t("admin.reg.caption")} columns={cols} rows={q.data?.items ?? []} rowKey={(r) => r.id} loading={q.isPending} error={q.isError ? <ErrorPanel error={q.error} /> : undefined} empty={t("table.empty.title")} />
    </div>
  );
}
