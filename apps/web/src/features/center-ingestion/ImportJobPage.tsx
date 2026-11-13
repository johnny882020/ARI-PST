import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AggregateCountTile, Badge, Button, Checkbox, Skeleton, Table, type TableColumn } from "@ari/design-system";
import { idempotencyKey, unwrap, type ImportRow } from "@ari/api-client";
import { api } from "../../lib/api";
import { qk } from "../../lib/query";
import { useT } from "../../app/locale";
import { PageHeading } from "../../shared/page";
import { ErrorPanel } from "../../shared/errors";
import { problemMessageKey } from "../../shared/problem-message";

export function ImportJobPage() {
  const t = useT();
  const { jobId = "" } = useParams();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [acceptWarnings, setAcceptWarnings] = useState(false);
  const job = useQuery({
    queryKey: qk.importJob(jobId),
    queryFn: () => unwrap(api.GET("/import-jobs/{jobId}", { params: { path: { jobId } } })),
    refetchInterval: (q) => (q.state.data && ["uploaded", "validating", "committing"].includes(q.state.data.status) ? 2000 : false),
  });
  const rows = useQuery({
    queryKey: qk.importRows(jobId),
    queryFn: () => unwrap(api.GET("/import-jobs/{jobId}/rows", { params: { path: { jobId }, query: { limit: 100 } } })),
    enabled: !!job.data && !["uploaded", "validating"].includes(job.data.status),
  });
  const commit = useMutation({
    mutationFn: () => unwrap(api.POST("/import-jobs/{jobId}/commit", { params: { path: { jobId }, header: { "Idempotency-Key": idempotencyKey() } } as never, body: { fileSha256: job.data!.fileSha256!, acceptWarnings } })),
    onSuccess: (child) => { void qc.invalidateQueries({ queryKey: ["samples"] }); void qc.invalidateQueries({ queryKey: qk.importJobs }); nav(`/import/${child.id}`); },
  });
  if (job.isPending) return <Skeleton lines={5} />;
  if (job.isError) return <ErrorPanel error={job.error} />;
  const j = job.data;
  const issuesCols: TableColumn<ImportRow>[] = [
    { key: "row", header: t("ingest.rows.row"), numeric: true, render: (r) => r.rowNo },
    { key: "outcome", header: t("ingest.rows.outcome"), render: (r) => <Badge tone={r.outcome === "rejected" ? "danger" : r.outcome === "warning" ? "warning" : "success"}>{t(`ingest.rows.outcome.${r.outcome}` as never)}</Badge> },
    { key: "issues", header: t("ingest.rows.issues"), render: (r) => r.issues.length ? r.issues.map((i) => `${i.field}: ${t(`ingest.rule.${i.rule}` as never)}`).join("; ") : "—" },
  ];
  const canCommit = j.mode === "dry_run" && j.status === "validated" && (j.acceptedRows ?? 0) + (acceptWarnings ? j.warningRows ?? 0 : 0) > 0;
  return (
    <div className="stack">
      <PageHeading titleKey="ingest.job.title" lead={<><Badge>{t(`ingest.mode.${j.mode}` as never)}</Badge> <Badge tone="info">{t(`ingest.status.${j.status}` as never)}</Badge></>} />
      <div className="grid-tiles">
        <AggregateCountTile label={t("ingest.job.total")} state="value" value={j.totalRows ?? 0} coordinatorView />
        <AggregateCountTile label={t("ingest.job.accepted")} state="value" value={j.acceptedRows ?? 0} />
        <AggregateCountTile label={t("ingest.job.warnings")} state="value" value={j.warningRows ?? 0} />
        <AggregateCountTile label={t("ingest.job.rejected")} state="value" value={j.rejectedRows ?? 0} />
      </div>
      {j.status === "committed" ? <Alert tone="success">{t("ingest.job.committed")}</Alert> : null}
      {(j.rejectedRows ?? 0) > 0 ? (
        <div className="row">
          <a className="ds-btn ds-btn-secondary" href={`/api/v1/import-jobs/${j.id}/report`} download><span className="ds-btn-label">{t("ingest.job.downloadReport")}</span></a>
          <span className="muted">{t("ingest.job.reportNote")}</span>
        </div>
      ) : null}
      <Table caption={t("ingest.rows.caption")} columns={issuesCols} rows={(rows.data?.items ?? []).filter((r) => r.outcome !== "accepted")} rowKey={(r) => String(r.rowNo)} loading={rows.isPending && rows.fetchStatus !== "idle"} error={rows.isError ? <ErrorPanel error={rows.error} /> : undefined} empty={t("ingest.rows.none")} />
      {j.mode === "dry_run" && j.status === "validated" ? (
        <div className="stack">
          {(j.warningRows ?? 0) > 0 ? <Checkbox label={t("ingest.job.acceptWarnings")} checked={acceptWarnings} onChange={(e) => setAcceptWarnings(e.target.checked)} /> : null}
          {commit.isError ? <Alert tone="danger">{t(problemMessageKey(commit.error))}</Alert> : null}
          <div><Button variant="primary" disabled={!canCommit} loading={commit.isPending} onClick={() => commit.mutate()}>{t("ingest.job.commit")}</Button></div>
        </div>
      ) : null}
    </div>
  );
}
