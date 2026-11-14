import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Skeleton } from "@ari/design-system";
import { unwrap } from "@ari/api-client";
import { api } from "../../lib/api";
import { useT } from "../../app/locale";
import { PageHeading } from "../../shared/page";
import { ErrorPanel } from "../../shared/errors";
import { problemMessageKey } from "../../shared/problem-message";

const STATUS_KEY = ["auth", "recovery-codes"] as const;
const LOW = 3;

/**
 * Recovery codes: the count of unused codes (GET /auth/recovery-codes never returns a code) and "Make new codes"
 * (POST, needs a fresh step-up; the StepUpHost dialog asks for it). New codes are shown once, kept only in component
 * state, and cleared with "Done".
 */
export function RecoveryCodesPage() {
  const t = useT();
  const qc = useQueryClient();
  const [codes, setCodes] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);
  const status = useQuery({ queryKey: STATUS_KEY, queryFn: () => unwrap(api.GET("/auth/recovery-codes")) });
  const regen = useMutation({
    mutationFn: () => unwrap(api.POST("/auth/recovery-codes")),
    onSuccess: (r) => { setCopied(false); setCodes(r.recoveryCodes); void qc.invalidateQueries({ queryKey: STATUS_KEY }); },
  });
  const copy = async () => {
    if (!codes) return;
    try { await navigator.clipboard?.writeText(codes.join("\n")); setCopied(true); } catch { setCopied(false); }
  };

  if (codes) {
    return (
      <div className="stack">
        <PageHeading titleKey="account.recovery.new.title" lead={t("account.recovery.new.once")} />
        <ul className="recovery-list" data-testid="recovery-codes">{codes.map((c) => <li key={c} dir="ltr">{c}</li>)}</ul>
        <div className="row">
          <Button size="sm" onClick={() => void copy()}>{t("common.action.copy")}</Button>
          <Button size="sm" onClick={() => window.print()}>{t("auth.enrol.recovery.print")}</Button>
        </div>
        <p role="status" aria-live="polite">{copied ? t("account.recovery.copied") : ""}</p>
        <Button variant="primary" onClick={() => { setCodes(null); setCopied(false); }}>{t("account.recovery.done")}</Button>
      </div>
    );
  }
  const n = status.data?.unused;
  return (
    <div className="stack">
      <PageHeading titleKey="account.recovery.title" lead={t("account.recovery.lead")} />
      <Card heading={t("account.recovery.title")} headingLevel={2}>
        {status.isPending ? <Skeleton lines={1} /> : status.isError ? <ErrorPanel error={status.error} /> : (
          <>
            <p data-testid="recovery-count">{t("account.recovery.count", { count: n ?? 0 })}</p>
            {n === 0 ? <Alert tone="warning">{t("account.recovery.none")}</Alert> : n !== undefined && n <= LOW ? <Alert tone="info">{t("account.recovery.low")}</Alert> : null}
          </>
        )}
        <p>{t("account.recovery.warning")}</p>
        {regen.isError ? <Alert tone="danger">{t(problemMessageKey(regen.error))}</Alert> : null}
        <div className="row">
          <Button variant="primary" loading={regen.isPending} onClick={() => regen.mutate()}>{t("account.recovery.regenerate")}</Button>
          <Link className="ds-btn ds-btn-quiet" to="/account/security"><span className="ds-btn-label">{t("account.security.open")}</span></Link>
        </div>
      </Card>
    </div>
  );
}
