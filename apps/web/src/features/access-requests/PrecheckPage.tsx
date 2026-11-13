import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, RadioGroup, Select, Skeleton, Textarea } from "@ari/design-system";
import { unwrap } from "@ari/api-client";
import { api } from "../../lib/api";
import { qk } from "../../lib/query";
import { useT } from "../../app/locale";
import { PageHeading } from "../../shared/page";
import { ErrorPanel } from "../../shared/errors";
import { problemMessageKey } from "../../shared/problem-message";
import { useCriteriaText } from "./CartPage";

const REASONS = ["out_of_scope", "incomplete", "no_ethics", "policy"] as const;

export function PrecheckPage() {
  const t = useT();
  const { id = "" } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const text = useCriteriaText();
  const [outcome, setOutcome] = useState<"forward" | "ask_info" | "reject">("forward");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const q = useQuery({ queryKey: qk.request(id), queryFn: () => unwrap(api.GET("/requests/{requestId}", { params: { path: { requestId: id } } })) });
  const m = useMutation({
    mutationFn: () => unwrap(api.POST("/requests/{requestId}/precheck", { params: { path: { requestId: id } }, body: { outcome, reasonCode: reason || undefined, note: note || undefined } })),
    onSuccess: (r) => { qc.setQueryData(qk.request(id), r); void qc.invalidateQueries({ queryKey: ["requests", "list"] }); nav(`/requests/${id}`); },
  });
  if (q.isPending) return <Skeleton lines={5} />;
  if (q.isError) return <ErrorPanel error={q.error} />;
  const needsReason = outcome === "reject";
  const CRITERIA = ["ethics", "scope", "complete"] as const;
  return (
    <div className="stack narrow" style={{ padding: 0 }}>
      <PageHeading titleKey="requests.precheck.title" />
      <Card as="div" heading={t("requests.detail.summary")} headingLevel={2}>
        <p style={{ whiteSpace: "pre-wrap" }}>{q.data.researchQuestion}</p>
        <p><strong>{t("requests.form.applicantEthicsRef.label")}:</strong> <bdi dir="ltr">{q.data.applicantEthicsRef}</bdi></p>
        <p>{q.data.items.map((i) => text(i.criteria).join(" · ")).join(" | ")}</p>
      </Card>
      <Card as="div" heading={t("requests.precheck.checklist")} headingLevel={2}>
        {CRITERIA.map((c) => (
          <label key={c} style={{ display: "flex", gap: "0.5rem", minBlockSize: "2.75rem", alignItems: "center" }}>
            <input type="checkbox" checked={!!checks[c]} onChange={(e) => setChecks({ ...checks, [c]: e.target.checked })} /> {t(`requests.precheck.criteria.${c}` as never)}
          </label>
        ))}
      </Card>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <RadioGroup legend={t("requests.precheck.decision")} name="outcome" value={outcome} onChange={(v) => setOutcome(v as typeof outcome)}
          options={[{ value: "forward", label: t("requests.precheck.forward") }, { value: "ask_info", label: t("requests.precheck.askInfo") }, { value: "reject", label: t("requests.precheck.reject") }]} />
        {needsReason ? <Select label={t("requests.precheck.reason")} required value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("requests.precheck.reason.placeholder")} options={REASONS.map((r) => ({ value: r, label: t(`requests.reason.${r}` as never) }))} /> : null}
        <Textarea label={t("requests.precheck.note")} help={t("requests.precheck.note.help")} rows={3} value={note} onChange={(e) => setNote(e.target.value)} autoComplete="off" />
        {m.isError ? <div role="alert"><Alert tone="danger">{t(problemMessageKey(m.error))}</Alert></div> : null}
        <div className="form-actions"><Button type="submit" variant="primary" loading={m.isPending} disabled={needsReason && !reason}>{t("requests.precheck.submit")}</Button></div>
      </form>
    </div>
  );
}
