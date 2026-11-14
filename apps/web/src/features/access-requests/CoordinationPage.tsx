import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Badge, Button, Card, Checkbox, Input, Select, Skeleton, Table, Textarea, type TableColumn } from "@ari/design-system";
import { unwrap, unwrapVoid, type AgreementStatus, type RequestAgreement, type RequestDto, type RequestStep, type ResolvedSample } from "@ari/api-client";
import { api } from "../../lib/api";
import { qk } from "../../lib/query";
import { useLocale, useT } from "../../app/locale";
import { useCan, useSession } from "../../app/session";
import { PageHeading } from "../../shared/page";
import { ErrorPanel } from "../../shared/errors";
import { problemMessageKey } from "../../shared/problem-message";
import { identifierMessageKey } from "../../shared/identifier-warning";
import { useCenters, useEnumLabel } from "../../shared/enums";
import { fmtMonth } from "../../lib/format";
import { useCriteriaText } from "./CartPage";

/** Query keys of this screen (kept local: the shared key table belongs to the shell). */
const ck = {
  links: (id: string) => ["requests", "links", id] as const,
  agreements: (id: string) => ["requests", "agreements", id] as const,
  candidates: (id: string, itemId: string) => ["requests", "candidates", id, itemId] as const,
};
const DOC_REF_RE = /^[A-Za-z0-9._/-]{3,64}$/;
const thisMonth = () => new Date().toISOString().slice(0, 7);
type Item = RequestDto["items"][number];

/** Pure helpers (tested). */
export function centerSteps(steps: RequestStep[] | undefined, key: "center_coordination" | "delivery"): RequestStep[] {
  return (steps ?? []).filter((s) => s.stepKey === key && !!s.centerId);
}
export function readyForDelivery(steps: RequestStep[] | undefined, agreements: RequestAgreement[]): boolean {
  const accepted = centerSteps(steps, "center_coordination").filter((s) => s.accepted);
  return accepted.length > 0 && accepted.every((s) => agreements.some((a) => a.centerId === s.centerId && a.status === "signed"));
}

export function CoordinationPage() {
  const t = useT();
  const { id = "" } = useParams();
  const manage = useCan("requests.manage");
  const deliver = useCan("requests.deliver");
  const q = useQuery({ queryKey: qk.request(id), queryFn: () => unwrap(api.GET("/requests/{requestId}", { params: { path: { requestId: id } } })) });
  if (q.isPending) return <Skeleton lines={6} />;
  if (q.isError) return <ErrorPanel error={q.error} onRetry={() => void q.refetch()} />;
  const r = q.data;
  const back = <Link to={`/requests/${r.id}`}>{t("requests.coord.back")}</Link>;
  return (
    <div className="stack">
      <PageHeading titleKey="requests.coord.title" lead={<>{t("requests.detail.id")} <bdi dir="ltr">{r.id}</bdi></>} actions={back} />
      <p className="muted">{t("requests.coord.lead")}</p>
      {["draft", "submitted", "precheck", "needs_info", "committee_review", "appeal_review", "rejected"].includes(r.status) ? <Alert tone="info">{t("requests.coord.notYet")}</Alert> : null}
      {r.status === "approved" && manage ? <LinkSamples r={r} /> : null}
      {["center_coordination", "agreements", "delivery", "closed"].includes(r.status) ? <CenterAnswers r={r} manage={manage} /> : null}
      {deliver ? <OwnSamples r={r} /> : null}
      {["agreements", "delivery", "closed"].includes(r.status) ? <Agreements r={r} manage={manage} /> : null}
      {["delivery", "closed"].includes(r.status) ? <Delivery r={r} deliver={deliver} /> : null}
      {r.status === "closed" ? <Alert tone={r.closeReason === "delivered" ? "success" : "info"}>{r.closeReason === "delivered" ? t("requests.status.closedDelivered") : t("requests.coord.closed")}</Alert> : null}
    </div>
  );
}

/* ---------- 1. coordinator links samples, then starts coordination ---------- */
function LinkSamples({ r }: { r: RequestDto }) {
  const t = useT();
  const qc = useQueryClient();
  const links = useQuery({ queryKey: ck.links(r.id), queryFn: () => unwrap(api.GET("/requests/{requestId}/resolved-samples", { params: { path: { requestId: r.id } } })) });
  const start = useMutation({
    mutationFn: () => unwrap(api.POST("/requests/{requestId}/transition", { params: { path: { requestId: r.id } }, body: { to: "center_coordination" } as never })),
    onSuccess: (next) => { qc.setQueryData(qk.request(r.id), next); void qc.invalidateQueries({ queryKey: ["requests"] }); },
  });
  const total = links.data?.items.length ?? 0;
  return (
    <Card as="section" heading={t("requests.coord.link.title")} headingLevel={2}>
      <div className="stack">
        <p className="muted">{t("requests.coord.link.lead")}</p>
        {r.items.map((it, i) => <ItemLinks key={it.id} requestId={r.id} item={it} n={i + 1} linked={(links.data?.items ?? []).filter((l) => l.itemId === it.id)} />)}
        <p>{t("requests.coord.link.count", { count: total })}</p>
        {start.isError ? <Alert tone="danger">{t(problemMessageKey(start.error))}</Alert> : null}
        {total === 0 ? <p className="muted">{t("requests.coord.start.needLinks")}</p> : null}
        <div><Button variant="primary" disabled={total === 0} loading={start.isPending} onClick={() => start.mutate()}>{t("requests.coord.start")}</Button></div>
      </div>
    </Card>
  );
}

function ItemLinks({ requestId, item, n, linked }: { requestId: string; item: Item; n: number; linked: ResolvedSample[] }) {
  const t = useT();
  const qc = useQueryClient();
  const text = useCriteriaText();
  const centers = useCenters();
  const enumLabel = useEnumLabel();
  const c = item.criteria as { diagnosis?: string[]; sampleType?: string[] };
  const query = { limit: 50, ...(c.diagnosis?.length === 1 ? { diagnosisCode: c.diagnosis[0] } : {}), ...(c.sampleType?.length === 1 ? { sampleType: c.sampleType[0] } : {}) };
  const cand = useQuery({ queryKey: ck.candidates(requestId, item.id), queryFn: () => unwrap(api.GET("/samples", { params: { query: query as never } })) });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const linkedKey = linked.map((l) => l.sampleId).join(",");
  useEffect(() => { setPicked(new Set(linkedKey ? linkedKey.split(",") : [])); }, [linkedKey]);
  const save = useMutation({
    mutationFn: () => unwrapVoid(api.PUT("/requests/{requestId}/resolved-samples", { params: { path: { requestId } }, body: { itemId: item.id, sampleIds: [...picked] as never } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ck.links(requestId) }),
  });
  const rows = cand.data?.items ?? [];
  const title = `${t("requests.coord.link.item", { n })}: ${text(item.criteria).join(" · ") || t("cart.item.allSamples")}`;
  return (
    <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend><strong>{title}</strong></legend>
      {cand.isPending ? <Skeleton lines={3} /> : cand.isError ? <ErrorPanel error={cand.error} /> : rows.length === 0 ? <p className="muted">{t("requests.coord.link.none")}</p> : (
        <div className="stack" style={{ maxBlockSize: "18rem", overflowY: "auto" }}>
          {rows.map((s) => (
            <Checkbox key={s.sampleCode} checked={picked.has(s.sampleCode)}
              onChange={(e) => { const next = new Set(picked); if (e.target.checked) next.add(s.sampleCode); else next.delete(s.sampleCode); setPicked(next); }}
              label={<><bdi dir="ltr">{s.sampleCode}</bdi> · {centers.label(s.sourceCenterId)} · {enumLabel("sampleType", s.sampleType)} · {enumLabel("availability", s.availability)}</>} />
          ))}
        </div>
      )}
      {save.isError ? <Alert tone="danger">{t(problemMessageKey(save.error))}</Alert> : null}
      {save.isSuccess && !save.isPending ? <Alert tone="success">{t("requests.coord.link.saved")}</Alert> : null}
      <div><Button variant="secondary" loading={save.isPending} onClick={() => save.mutate()}>{t("requests.coord.link.save")}</Button></div>
    </fieldset>
  );
}

/* ---------- 2. each holding center accepts or declines ---------- */
function CenterAnswers({ r, manage }: { r: RequestDto; manage: boolean }) {
  const t = useT();
  const centers = useCenters();
  const rows = centerSteps(r.steps, "center_coordination");
  const cols: TableColumn<RequestStep>[] = [
    { key: "center", header: t("requests.coord.col.center"), render: (s) => centers.label(s.centerId ?? "") },
    { key: "status", header: t("requests.coord.col.status"), render: (s) => s.status !== "done" ? <Badge tone="warning">{t("requests.coord.answer.pending")}</Badge> : s.accepted ? <Badge tone="success">{t("requests.coord.answer.accepted")}</Badge> : <Badge tone="danger">{t("requests.coord.answer.declined")}</Badge> },
  ];
  const open = r.status === "center_coordination" ? rows.filter((s) => s.status !== "done") : [];
  return (
    <Card as="section" heading={t("requests.coord.centers.title")} headingLevel={2}>
      <div className="stack">
        <Table caption={t("requests.coord.centers.title")} columns={cols} rows={rows} rowKey={(s) => s.centerId ?? s.stepKey} />
        {open.map((s) => <AnswerForm key={s.centerId} requestId={r.id} centerId={s.centerId!} centerName={centers.label(s.centerId!)} onBehalf={manage} />)}
      </div>
    </Card>
  );
}

function AnswerForm({ requestId, centerId, centerName, onBehalf }: { requestId: string; centerId: string; centerName: string; onBehalf: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const noteIdKey = identifierMessageKey(note);
  const answer = useMutation({
    mutationFn: (accepted: boolean) => unwrap(api.PATCH("/requests/{requestId}/steps/{stepKey}", { params: { path: { requestId, stepKey: "center_coordination" } }, body: { centerId, accepted, ...(note.trim() ? { publicNote: note.trim() } : {}) } })),
    onSuccess: () => { setNote(""); void qc.invalidateQueries({ queryKey: ["requests"] }); },
  });
  return (
    <form className="stack" aria-label={centerName} onSubmit={(e) => e.preventDefault()}>
      <strong>{centerName}</strong>
      {onBehalf ? <p className="muted">{t("requests.coord.onBehalf")}</p> : null}
      <Textarea label={t("requests.coord.note")} help={t("consent.freetext.warning")} rows={2} value={note} onChange={(e) => setNote(e.target.value)} autoComplete="off" error={noteIdKey ? t(noteIdKey) : undefined} />
      {answer.isError ? <Alert tone="danger">{t(problemMessageKey(answer.error))}</Alert> : null}
      <div className="row">
        <Button variant="primary" disabled={!!noteIdKey} loading={answer.isPending && answer.variables === true} onClick={() => answer.mutate(true)}>{t("requests.coord.accept")}</Button>
        <Button variant="secondary" disabled={!!noteIdKey} loading={answer.isPending && answer.variables === false} onClick={() => answer.mutate(false)}>{t("requests.coord.decline")}</Button>
      </div>
    </form>
  );
}

/* ---------- clinician: the own center's linked samples (row-level security limits the list) ---------- */
function OwnSamples({ r }: { r: RequestDto }) {
  const t = useT();
  const links = useQuery({ queryKey: ck.links(r.id), queryFn: () => unwrap(api.GET("/requests/{requestId}/resolved-samples", { params: { path: { requestId: r.id } } })) });
  if (links.isPending) return <Skeleton lines={2} />;
  if (links.isError) return <ErrorPanel error={links.error} />;
  const items = links.data.items;
  return (
    <Card as="section" heading={t("requests.coord.samples.title")} headingLevel={2}>
      {items.length === 0 ? <p className="muted">{t("requests.coord.samples.none")}</p> : (
        <ul>{items.map((l) => <li key={`${l.itemId}-${l.sampleId}`}><Link to={`/samples/${l.sampleId}`}><bdi dir="ltr">{l.sampleId}</bdi></Link></li>)}</ul>
      )}
    </Card>
  );
}

/* ---------- 3. MTA/DTA: coordinator records status, reference and month; then moves to delivery ---------- */
function Agreements({ r, manage }: { r: RequestDto; manage: boolean }) {
  const t = useT();
  const { locale } = useLocale();
  const qc = useQueryClient();
  const centers = useCenters();
  const list = useQuery({ queryKey: ck.agreements(r.id), queryFn: () => unwrap(api.GET("/requests/{requestId}/agreements", { params: { path: { requestId: r.id } } })) });
  const accepted = centerSteps(r.steps, "center_coordination").filter((s) => s.accepted);
  const toDelivery = useMutation({
    mutationFn: () => unwrap(api.POST("/requests/{requestId}/transition", { params: { path: { requestId: r.id } }, body: { to: "delivery" } as never })),
    onSuccess: (next) => { qc.setQueryData(qk.request(r.id), next); void qc.invalidateQueries({ queryKey: ["requests"] }); },
  });
  const rows = list.data?.items ?? [];
  const ready = readyForDelivery(r.steps, rows);
  const cols: TableColumn<RequestAgreement>[] = [
    { key: "center", header: t("requests.coord.col.center"), render: (a) => centers.label(a.centerId) },
    { key: "kind", header: t("requests.coord.agreement.kind"), render: (a) => a.kind.toUpperCase() },
    { key: "ref", header: t("requests.coord.agreement.docRef"), render: (a) => <bdi dir="ltr">{a.docRef}</bdi> },
    { key: "status", header: t("requests.coord.agreement.status"), render: (a) => <Badge tone={a.status === "signed" ? "success" : "neutral"}>{t(`requests.coord.agreement.status.${a.status}` as never)}</Badge> },
    { key: "month", header: t("requests.coord.agreement.month"), render: (a) => (a.signedMonth ? fmtMonth(a.signedMonth, locale) : "—") },
  ];
  return (
    <Card as="section" heading={t("requests.coord.agreements.title")} headingLevel={2}>
      <div className="stack">
        <p className="muted">{t("requests.coord.agreements.lead")}</p>
        <Table caption={t("requests.coord.agreements.title")} columns={cols} rows={rows} rowKey={(a) => `${a.centerId}-${a.kind}`} loading={list.isPending}
          error={list.isError ? <ErrorPanel error={list.error} /> : undefined} empty={<p className="muted">{t("requests.coord.agreements.none")}</p>} />
        {manage && r.status === "agreements" ? (
          <>
            {accepted.map((s) => <AgreementForm key={s.centerId} requestId={r.id} centerId={s.centerId!} centerName={centers.label(s.centerId!)} />)}
            {toDelivery.isError ? <Alert tone="danger">{t(problemMessageKey(toDelivery.error))}</Alert> : null}
            {!ready ? <p className="muted">{t("requests.coord.toDelivery.needSigned")}</p> : null}
            <div><Button variant="primary" disabled={!ready} loading={toDelivery.isPending} onClick={() => toDelivery.mutate()}>{t("requests.coord.toDelivery")}</Button></div>
          </>
        ) : null}
      </div>
    </Card>
  );
}

function AgreementForm({ requestId, centerId, centerName }: { requestId: string; centerId: string; centerName: string }) {
  const t = useT();
  const qc = useQueryClient();
  const [kind, setKind] = useState<"mta" | "dta">("mta");
  const [docRef, setDocRef] = useState("");
  const [status, setStatus] = useState<AgreementStatus>("signed");
  const [month, setMonth] = useState("");
  const [touched, setTouched] = useState(false);
  const max = useMemo(thisMonth, []);
  const refErr = touched && !DOC_REF_RE.test(docRef) ? t("requests.coord.agreement.docRef.error") : identifierMessageKey(docRef) ? t(identifierMessageKey(docRef)!) : undefined;
  const monthErr = touched && status === "signed" && (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month > max) ? t("requests.coord.agreement.month.error") : undefined;
  const save = useMutation({
    mutationFn: () => unwrap(api.PATCH("/requests/{requestId}/steps/{stepKey}", { params: { path: { requestId, stepKey: "mta_dta" } },
      body: { centerId, agreement: { kind, docRef, status, ...(month ? { signedMonth: month } : {}) } } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ck.agreements(requestId) }),
  });
  return (
    <form className="stack" aria-label={`${t("requests.coord.agreements.title")}: ${centerName}`} noValidate
      onSubmit={(e) => { e.preventDefault(); setTouched(true); if (DOC_REF_RE.test(docRef) && !identifierMessageKey(docRef) && (status !== "signed" || (/^\d{4}-(0[1-9]|1[0-2])$/.test(month) && month <= max))) save.mutate(); }}>
      <strong>{centerName}</strong>
      <div className="row">
        <Select label={t("requests.coord.agreement.kind")} value={kind} onChange={(e) => setKind(e.target.value as "mta" | "dta")}
          options={[{ value: "mta", label: t("requests.coord.agreement.kind.mta") }, { value: "dta", label: t("requests.coord.agreement.kind.dta") }]} />
        <Select label={t("requests.coord.agreement.status")} value={status} onChange={(e) => setStatus(e.target.value as AgreementStatus)}
          options={(["draft", "sent", "signed"] as const).map((s) => ({ value: s, label: t(`requests.coord.agreement.status.${s}`) }))} />
      </div>
      <Input label={t("requests.coord.agreement.docRef")} help={t("requests.coord.agreement.docRef.help")} value={docRef} onChange={(e) => setDocRef(e.target.value)} dir="ltr" autoComplete="off" required error={refErr} />
      <Input label={t("requests.coord.agreement.month")} help={t("requests.coord.agreement.month.help")} type="month" max={max} value={month} onChange={(e) => setMonth(e.target.value)} required={status === "signed"} error={monthErr} />
      {save.isError ? <Alert tone="danger">{t(problemMessageKey(save.error))}</Alert> : null}
      {save.isSuccess && !save.isPending ? <Alert tone="success">{t("requests.coord.agreement.saved")}</Alert> : null}
      <div><Button type="submit" variant="secondary" loading={save.isPending}>{t("requests.coord.agreement.save")}</Button></div>
    </form>
  );
}

/* ---------- 4. delivery: only the holding center's clinician confirms ---------- */
function Delivery({ r, deliver }: { r: RequestDto; deliver: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const centers = useCenters();
  const { state } = useSession();
  const own = state.status === "authenticated" ? state.centerId : null;
  const rows = centerSteps(r.steps, "delivery");
  const mark = useMutation({
    mutationFn: (centerId: string) => unwrap(api.PATCH("/requests/{requestId}/steps/{stepKey}", { params: { path: { requestId: r.id, stepKey: "delivery" } }, body: { centerId, status: "done" } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["requests"] }),
  });
  const cols: TableColumn<RequestStep>[] = [
    { key: "center", header: t("requests.coord.col.center"), render: (s) => centers.label(s.centerId ?? "") },
    { key: "status", header: t("requests.coord.col.status"), render: (s) => s.status === "done" ? <Badge tone="success">{t("requests.coord.delivery.done")}</Badge> : <Badge tone="warning">{t("requests.coord.delivery.pending")}</Badge> },
    { key: "action", header: t("requests.coord.col.action"), render: (s) => deliver && r.status === "delivery" && s.status !== "done" && (!own || s.centerId === own)
      ? <Button size="sm" variant="primary" loading={mark.isPending} onClick={() => mark.mutate(s.centerId!)}>{t("requests.coord.delivery.mark")}</Button> : "—" },
  ];
  return (
    <Card as="section" heading={t("requests.coord.delivery.title")} headingLevel={2}>
      <div className="stack">
        {!deliver ? <p className="muted">{t("requests.coord.delivery.onlyCenter")}</p> : null}
        <Table caption={t("requests.coord.delivery.title")} columns={cols} rows={rows} rowKey={(s) => s.centerId ?? s.stepKey} />
        {mark.isError ? <Alert tone="danger">{t(problemMessageKey(mark.error))}</Alert> : null}
      </div>
    </Card>
  );
}
