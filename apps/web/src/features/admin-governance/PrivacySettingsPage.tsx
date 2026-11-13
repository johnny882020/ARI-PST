import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Input, Skeleton, Textarea } from "@ari/design-system";
import { unwrap, type KPolicy } from "@ari/api-client";
import { api } from "../../lib/api";
import { qk } from "../../lib/query";
import { useT } from "../../app/locale";
import { useSession } from "../../app/session";
import { PageHeading } from "../../shared/page";
import { ErrorPanel } from "../../shared/errors";
import { problemMessageKey } from "../../shared/problem-message";

export const K_FLOOR = 5;

function Policy({ p, me }: { p: KPolicy; me: string }) {
  const t = useT();
  const qc = useQueryClient();
  const [k, setK] = useState(String(p.k));
  const [reason, setReason] = useState("");
  const refresh = () => void qc.invalidateQueries({ queryKey: qk.kPolicies });
  const propose = useMutation({ mutationFn: () => unwrap(api.POST("/k-policies/{id}/changes", { params: { path: { id: p.id } }, body: { k: Number(k), reason } })), onSuccess: () => { setReason(""); refresh(); } });
  const approve = useMutation({ mutationFn: () => unwrap(api.POST("/k-policy-changes/{id}/approve", { params: { path: { id: p.pendingChange!.id } } })), onSuccess: refresh });
  const n = Number(k);
  const invalid = !Number.isInteger(n) || n < K_FLOOR;
  return (
    <Card as="div" heading={p.fieldSet} headingLevel={2}>
      <p>{t("admin.k.current")}: <strong data-testid={`k-${p.fieldSet}`}><bdi dir="ltr">{p.k}</bdi></strong></p>
      {p.pendingChange ? (
        <Alert tone="warning" title={t("admin.k.pending", { k: p.pendingChange.proposedK })}>
          <p>{p.pendingChange.reason}</p>
          {p.pendingChange.proposedByUserId === me ? <p>{t("admin.grants.needsOther")}</p> : <Button variant="primary" loading={approve.isPending} onClick={() => approve.mutate()}>{t("admin.k.approve")}</Button>}
          {approve.isError ? <div role="alert">{t(problemMessageKey(approve.error))}</div> : null}
        </Alert>
      ) : (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); if (!invalid && reason) propose.mutate(); }}>
          <Input label={t("admin.k.new")} help={t("admin.k.floor", { min: K_FLOOR })} type="number" min={K_FLOOR} step={1} value={k} onChange={(e) => setK(e.target.value)} dir="ltr" required error={invalid ? t("admin.k.floorError", { min: K_FLOOR }) : undefined} />
          <Textarea label={t("admin.grants.reason")} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} required autoComplete="off" />
          {propose.isError ? <Alert tone="danger">{t(problemMessageKey(propose.error))}</Alert> : null}
          <div><Button type="submit" disabled={invalid || !reason || n === p.k} loading={propose.isPending}>{t("admin.k.propose")}</Button></div>
        </form>
      )}
    </Card>
  );
}

export function PrivacySettingsPage() {
  const t = useT();
  const { state } = useSession();
  const me = state.status === "authenticated" ? state.session.userId : "";
  const q = useQuery({ queryKey: qk.kPolicies, queryFn: () => unwrap(api.GET("/k-policies")) });
  return (
    <div className="stack narrow" style={{ padding: 0 }}>
      <PageHeading titleKey="admin.k.title" lead={t("admin.k.lead")} />
      <Alert tone="info">{t("admin.k.secondApprover")}</Alert>
      {q.isPending ? <Skeleton lines={4} /> : q.isError ? <ErrorPanel error={q.error} /> : q.data.items.map((p) => <Policy key={p.id} p={p} me={me} />)}
    </div>
  );
}
