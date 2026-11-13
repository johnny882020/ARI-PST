import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Skeleton, Stepper, Textarea, buildRequestSteps, REQUEST_STEP_IDS } from "@ari/design-system";
import { unwrap, type RequestStep } from "@ari/api-client";
import { api } from "../../lib/api";
import { qk } from "../../lib/query";
import { useLocale, useT } from "../../app/locale";
import { useCan } from "../../app/session";
import { PageHeading } from "../../shared/page";
import { ErrorPanel, WidgetBoundary } from "../../shared/errors";
import { fmtDate } from "../../lib/format";
import { problemMessageKey } from "../../shared/problem-message";
import { STAGE_STEP, trackerView } from "./tracker";
import { useCriteriaText } from "./CartPage";
import { identifierMessageKey } from "../../shared/identifier-warning";

export function RequestDetailPage() {
  const t = useT();
  const { locale } = useLocale();
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const text = useCriteriaText();
  const own = useCan("requests.own");
  const canPrecheck = useCan("requests.queue.precheck");
  const canVote = useCan("requests.vote");
  const canCoordinate = useCan("requests.coordinate");
  const [reply, setReply] = useState("");
  const [note, setNote] = useState("");
  // Identifier-like text is refused before it is sent (same rules as the server guard).
  const replyIdKey = identifierMessageKey(reply);
  const noteIdKey = identifierMessageKey(note);

  const q = useQuery({
    queryKey: qk.request(id),
    queryFn: () => unwrap(api.GET("/requests/{requestId}", { params: { path: { requestId: id } } })),
    // Poll only while the tab is visible and the request is open.
    refetchInterval: (query) => (query.state.data && !["delivered", "closed", "rejected", "withdrawn"].includes(query.state.data.status) ? 10_000 : false),
    refetchIntervalInBackground: false,
  });

  const respond = useMutation({
    mutationFn: () => unwrap(api.POST("/requests/{requestId}/respond", { params: { path: { requestId: id } }, body: { message: reply } })),
    onSuccess: (r) => { qc.setQueryData(qk.request(id), r); setReply(""); },
  });
  const stepMut = useMutation({
    mutationFn: (stepKey: string) => unwrap(api.PATCH("/requests/{requestId}/steps/{stepKey}", { params: { path: { requestId: id, stepKey: stepKey as never } }, body: { status: "done", publicNote: note || undefined } })),
    onSuccess: () => { setNote(""); void qc.invalidateQueries({ queryKey: qk.request(id) }); },
  });

  if (q.isPending) return <Skeleton lines={6} />;
  if (q.isError) return <ErrorPanel error={q.error} onRetry={() => void q.refetch()} />;
  const r = q.data;
  const view = trackerView(r.status);
  const steps = (r.steps ?? []) as RequestStep[];
  const stepOf = (stage: (typeof REQUEST_STEP_IDS)[number]) => steps.find((s) => s.stepKey === STAGE_STEP[stage]);
  const dates: Partial<Record<(typeof REQUEST_STEP_IDS)[number], string>> = {};
  const descriptions: Partial<Record<(typeof REQUEST_STEP_IDS)[number], string>> = {};
  for (const s of REQUEST_STEP_IDS) {
    const st = stepOf(s);
    const d = st?.completedAt ?? st?.startedAt;
    if (d) dates[s] = d.slice(0, 10);
    const pub = st?.publicNote;
    if (pub) descriptions[s] = pub;
  }
  if (view.descKey) descriptions[view.current] = [t(view.descKey), descriptions[view.current]].filter(Boolean).join(" — ");
  const stepper = buildRequestSteps({
    labels: Object.fromEntries(REQUEST_STEP_IDS.map((s) => [s, t(`requests.tracker.stage.${s}.label` as never)])) as never,
    current: view.current, status: view.status, dates, descriptions,
  });
  const activeApiStep = r.status === "center_coordination" || r.status === "approved" ? "center_coordination" : r.status === "agreements" ? "mta_dta" : r.status === "delivery" ? "delivery" : null;

  return (
    <div className="stack">
      <PageHeading titleKey="requests.detail.title" lead={<>{t("requests.detail.id")} <bdi dir="ltr">{r.id}</bdi></>}
        actions={<>
          {canPrecheck && r.status === "precheck" ? <Link className="ds-btn ds-btn-primary" to={`/requests/${r.id}/precheck`}><span className="ds-btn-label">{t("requests.precheck.open")}</span></Link> : null}
          {canVote && r.status === "committee_review" ? <Link className="ds-btn ds-btn-primary" to={`/requests/${r.id}/decision`}><span className="ds-btn-label">{t("requests.decision.open")}</span></Link> : null}
        </>} />
      <Alert tone={view.needsAction ? "warning" : r.status === "rejected" ? "danger" : r.status === "delivered" ? "success" : "info"}>{t(view.bannerKey)}</Alert>
      {own && view.needsAction ? (
        <Card as="div" heading={t("requests.tracker.needsAction.title")} headingLevel={2}>
          <form className="stack" onSubmit={(e) => { e.preventDefault(); if (reply.trim() && !replyIdKey) respond.mutate(); }}>
            <Textarea label={t("requests.tracker.respond.label")} help={t("consent.freetext.warning")} rows={4} value={reply} onChange={(e) => setReply(e.target.value)} autoComplete="off" required error={replyIdKey ? t(replyIdKey) : undefined} />
            {respond.isError ? <Alert tone="danger">{t(problemMessageKey(respond.error))}</Alert> : null}
            <div><Button type="submit" variant="primary" loading={respond.isPending}>{t("requests.tracker.respond.submit")}</Button></div>
          </form>
        </Card>
      ) : null}
      <WidgetBoundary>
        <Stepper steps={stepper} label={t("requests.tracker.label")} />
      </WidgetBoundary>
      <Card as="div" heading={t("requests.detail.summary")} headingLevel={2}>
        <dl>
          <dt><strong>{t("requests.form.researchQuestion.label")}</strong></dt><dd style={{ marginInlineStart: 0, whiteSpace: "pre-wrap" }}>{r.researchQuestion}</dd>
          <dt><strong>{t("requests.form.items")}</strong></dt>
          {r.items.map((it) => <dd key={it.id} style={{ marginInlineStart: 0 }}>{text(it.criteria).join(" · ") || t("cart.item.allSamples")}</dd>)}
          <dt><strong>{t("requests.detail.submitted")}</strong></dt><dd style={{ marginInlineStart: 0 }}>{r.submittedAt ? fmtDate(r.submittedAt, locale) : "—"}</dd>
        </dl>
      </Card>
      {canCoordinate && activeApiStep ? (
        <Card as="div" heading={t("requests.coordination.title")} headingLevel={2}>
          <form className="stack" onSubmit={(e) => { e.preventDefault(); if (!noteIdKey) stepMut.mutate(activeApiStep); }}>
            <Textarea label={t("requests.coordination.note")} rows={2} value={note} onChange={(e) => setNote(e.target.value)} autoComplete="off" error={noteIdKey ? t(noteIdKey) : undefined} />
            {stepMut.isError ? <Alert tone="danger">{t(problemMessageKey(stepMut.error))}</Alert> : null}
            <div><Button type="submit" variant="primary" loading={stepMut.isPending}>{t(`requests.coordination.done.${activeApiStep}` as never)}</Button></div>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
