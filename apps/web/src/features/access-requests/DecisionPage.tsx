import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Badge, Button, Card, Checkbox, RadioGroup, Skeleton, Textarea } from "@ari/design-system";
import { unwrap } from "@ari/api-client";
import { api } from "../../lib/api";
import { qk } from "../../lib/query";
import { useT } from "../../app/locale";
import { PageHeading } from "../../shared/page";
import { ErrorPanel } from "../../shared/errors";
import { problemMessageKey } from "../../shared/problem-message";
import { useCriteriaText } from "./CartPage";

export function DecisionPage() {
  const t = useT();
  const { id = "" } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const text = useCriteriaText();
  const [vote, setVote] = useState<"approve" | "reject" | "abstain" | "">("");
  const [comment, setComment] = useState("");
  const [conflict, setConflict] = useState(false);
  const req = useQuery({ queryKey: qk.request(id), queryFn: () => unwrap(api.GET("/requests/{requestId}", { params: { path: { requestId: id } } })) });
  const tally = useQuery({ queryKey: qk.tally(id), queryFn: () => unwrap(api.GET("/requests/{requestId}/vote-tally", { params: { path: { requestId: id } } })) });

  const cast = useMutation({
    mutationFn: () => unwrap(api.PUT("/requests/{requestId}/votes", { params: { path: { requestId: id } }, body: { vote: vote as "approve", comment: comment || undefined } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.tally(id) }),
  });
  const decide = useMutation({
    mutationFn: (outcome: "approved" | "rejected") => unwrap(api.POST("/requests/{requestId}/decisions", { params: { path: { requestId: id } }, body: { outcome, rationale: comment || undefined } })),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["requests"] }); nav("/committee"); },
  });

  if (req.isPending || tally.isPending) return <Skeleton lines={6} />;
  if (req.isError) return <ErrorPanel error={req.error} />;
  if (tally.isError) return <ErrorPanel error={tally.error} />;
  const ty = tally.data;
  return (
    <div className="stack narrow" style={{ padding: 0 }}>
      <PageHeading titleKey="requests.decision.title" />
      <Card as="div" heading={t("requests.detail.summary")} headingLevel={2}>
        <p style={{ whiteSpace: "pre-wrap" }}>{req.data.researchQuestion}</p>
        <p><strong>{t("requests.form.plannedUse.label")}:</strong> {req.data.plannedUse}</p>
        <p><strong>{t("requests.form.applicantEthicsRef.label")}:</strong> <bdi dir="ltr">{req.data.applicantEthicsRef}</bdi></p>
        <p>{req.data.items.map((i) => text(i.criteria).join(" · ")).join(" | ")}</p>
      </Card>
      <Card as="div" heading={t("requests.decision.tally")} headingLevel={2}>
        <p data-testid="tally"><Badge tone="info">{t("requests.decision.tally.value", { approve: ty.approve, required: ty.required, members: ty.members })}</Badge> {t("requests.decision.tally.detail", { reject: ty.reject, abstain: ty.abstain })}</p>
        {ty.myVote ? <p>{t("requests.decision.myVote", { vote: t(`requests.vote.${ty.myVote}` as never) })}</p> : null}
      </Card>
      <Checkbox label={t("requests.decision.conflict")} checked={conflict} onChange={(e) => setConflict(e.target.checked)} />
      {conflict ? <Alert tone="warning">{t("requests.decision.conflict.note")}</Alert> : (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); if (vote) cast.mutate(); }}>
          <RadioGroup legend={t("requests.decision.vote")} name="vote" value={vote} onChange={(v) => setVote(v as typeof vote)}
            options={(["approve", "reject", "abstain"] as const).map((v) => ({ value: v, label: t(`requests.vote.${v}` as never) }))} />
          <Textarea label={t("requests.decision.comment")} rows={3} value={comment} onChange={(e) => setComment(e.target.value)} autoComplete="off" />
          {cast.isError ? <div role="alert"><Alert tone="danger">{t(problemMessageKey(cast.error))}</Alert></div> : null}
          {decide.isError ? <div role="alert"><Alert tone="danger">{t(problemMessageKey(decide.error))}</Alert></div> : null}
          <div className="form-actions">
            <Button type="submit" variant="primary" disabled={!vote} loading={cast.isPending}>{t("requests.decision.cast")}</Button>
            <Button onClick={() => decide.mutate("approved")} disabled={ty.approve < ty.required} loading={decide.isPending}>{t("requests.decision.record.approved")}</Button>
            <Button variant="danger" onClick={() => decide.mutate("rejected")} disabled={ty.reject < ty.required}>{t("requests.decision.record.rejected")}</Button>
          </div>
        </form>
      )}
    </div>
  );
}
