import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card } from "@ari/design-system";
import { idempotencyKey, unwrap } from "@ari/api-client";
import { api } from "../../lib/api";
import { qk } from "../../lib/query";
import { useT } from "../../app/locale";
import { PageHeading } from "../../shared/page";
import { problemMessageKey } from "../../shared/problem-message";

const MAX_BYTES = 10 * 1024 * 1024;

/** Upload step. Always starts as a dry run; the server parses (no formulas are evaluated in the browser). */
export function ImportWizardPage() {
  const t = useT();
  const nav = useNavigate();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const key = useRef(idempotencyKey());

  const pick = (f: File | undefined) => {
    setLocalError(null);
    if (!f) return setFile(null);
    // UX-only checks. The server validates type and size.
    if (!/\.(csv|xlsx)$/i.test(f.name)) return setLocalError("ingest.upload.error.type");
    if (f.size > MAX_BYTES) return setLocalError("ingest.upload.error.size");
    setFile(f);
  };
  const upload = useMutation({
    mutationFn: () => unwrap(api.POST("/import-jobs", {
      params: { header: { "Idempotency-Key": key.current } } as never,
      body: { file: "" },
      bodySerializer: () => { const fd = new FormData(); fd.append("file", file!); return fd; },
    })),
    onSuccess: (job) => { void qc.invalidateQueries({ queryKey: qk.importJobs }); nav(`/import/${job.id}`); },
  });
  return (
    <div className="stack narrow" style={{ padding: 0 }}>
      <PageHeading titleKey="ingest.wizard.title" lead={t("ingest.wizard.lead")} />
      <Alert tone="info">{t("ingest.wizard.dryRun")}</Alert>
      <Card as="div" heading={t("ingest.wizard.template")} headingLevel={2}>
        <div className="row">
          <a className="ds-btn ds-btn-secondary" href="/api/v1/import-templates/csv" download><span className="ds-btn-label">{t("ingest.template.csv")}</span></a>
          <a className="ds-btn ds-btn-secondary" href="/api/v1/import-templates/xlsx" download><span className="ds-btn-label">{t("ingest.template.xlsx")}</span></a>
        </div>
        <p className="muted">{t("ingest.template.hint")}</p>
      </Card>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); if (file) upload.mutate(); }}>
        <div>
          <label htmlFor="field-file" className="ds-label">{t("ingest.upload.label")}</label>
          <p className="ds-help">{t("ingest.upload.help")}</p>
          <input id="field-file" ref={input} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => pick(e.target.files?.[0])} />
        </div>
        {localError ? <Alert tone="danger">{t(localError as never)}</Alert> : null}
        {upload.isError ? <Alert tone="danger">{t(problemMessageKey(upload.error))}</Alert> : null}
        <div className="form-actions"><Button type="submit" variant="primary" disabled={!file} loading={upload.isPending}>{t("ingest.upload.submit")}</Button></div>
      </form>
    </div>
  );
}
