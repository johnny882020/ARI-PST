import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Badge, Button, Card, Dialog, Input, Select, Table, Textarea, type TableColumn } from "@ari/design-system";
import { unwrap, type Role, type RoleGrantRequest, type User } from "@ari/api-client";
import { api } from "../../lib/api";
import { qk } from "../../lib/query";
import { useT } from "../../app/locale";
import { useSession } from "../../app/session";
import { PageHeading } from "../../shared/page";
import { ErrorPanel } from "../../shared/errors";
import { problemMessageKey } from "../../shared/problem-message";
import { useCenters } from "../../shared/enums";

const ROLES: Role[] = ["researcher_il", "researcher_intl", "center_clinician", "national_coordinator", "committee_member", "system_admin"];

export function UsersPage() {
  const t = useT();
  const qc = useQueryClient();
  const centers = useCenters();
  const { state } = useSession();
  const me = state.status === "authenticated" ? state.session.userId : "";
  const [target, setTarget] = useState<User | null>(null);
  const [role, setRole] = useState("");
  const [centerId, setCenterId] = useState("");
  const [reason, setReason] = useState("");
  const [invite, setInvite] = useState(false);
  const [inv, setInv] = useState({ email: "", displayName: "", role: "", centerId: "" });

  const users = useQuery({ queryKey: qk.users(), queryFn: () => unwrap(api.GET("/users", { params: { query: {} } })) });
  const grants = useQuery({ queryKey: qk.roleGrants, queryFn: () => unwrap(api.GET("/role-grant-requests")) });
  const refresh = () => { void qc.invalidateQueries({ queryKey: qk.roleGrants }); void qc.invalidateQueries({ queryKey: ["admin", "users"] }); };
  const propose = useMutation({
    mutationFn: () => unwrap(api.POST("/role-grant-requests", { body: { userId: target!.id, role: role as Role, centerId: centerId || undefined, reason } })),
    onSuccess: () => { setTarget(null); setRole(""); setReason(""); setCenterId(""); refresh(); },
  });
  const decide = useMutation({
    mutationFn: (v: { id: string; outcome: "approved" | "rejected" }) => unwrap(api.POST("/role-grant-requests/{id}/decision", { params: { path: { id: v.id } }, body: { outcome: v.outcome } })),
    onSuccess: refresh,
  });
  const inviteMut = useMutation({
    mutationFn: () => unwrap(api.POST("/users", { body: { email: inv.email, displayName: inv.displayName, role: inv.role as Role, centerId: inv.centerId || undefined } })),
    onSuccess: () => { setInvite(false); setInv({ email: "", displayName: "", role: "", centerId: "" }); refresh(); },
  });
  const roleOpts = ROLES.map((r) => ({ value: r, label: t(`admin.role.${r}` as never) }));
  const cols: TableColumn<User>[] = [
    { key: "name", header: t("admin.users.col.name"), render: (u) => u.displayName },
    { key: "email", header: t("admin.users.col.email"), render: (u) => <bdi dir="ltr">{u.email}</bdi> },
    { key: "roles", header: t("admin.users.col.roles"), render: (u) => u.roles.map((r) => <Badge key={r.id}>{t(`admin.role.${r.role}` as never)}</Badge>) },
    { key: "status", header: t("admin.users.col.status"), render: (u) => t(`admin.users.status.${u.status}` as never) },
    { key: "act", header: t("admin.users.col.action"), render: (u) => <Button size="sm" onClick={() => setTarget(u)}>{t("admin.users.requestRole")}</Button> },
  ];
  const gcols: TableColumn<RoleGrantRequest>[] = [
    { key: "user", header: t("admin.users.col.name"), render: (g) => users.data?.items.find((u) => u.id === g.userId)?.displayName ?? g.userId },
    { key: "role", header: t("admin.users.col.roles"), render: (g) => t(`admin.role.${g.role}` as never) },
    { key: "reason", header: t("admin.grants.reason"), render: (g) => g.reason },
    { key: "act", header: t("admin.grants.status"), render: (g) => g.status !== "pending" ? t(`admin.reg.status.${g.status}` as never) : g.requestedByUserId === me ? <span className="muted">{t("admin.grants.needsOther")}</span> : (
      <span className="row"><Button size="sm" variant="primary" onClick={() => decide.mutate({ id: g.id, outcome: "approved" })}>{t("admin.reg.approve")}</Button><Button size="sm" onClick={() => decide.mutate({ id: g.id, outcome: "rejected" })}>{t("admin.reg.reject")}</Button></span>) },
  ];
  return (
    <div className="stack">
      <PageHeading titleKey="admin.users.title" actions={<Button variant="primary" onClick={() => setInvite(true)}>{t("admin.users.invite")}</Button>} />
      <Alert tone="info">{t("admin.users.sod")}</Alert>
      {decide.isError ? <div role="alert"><Alert tone="danger">{t(problemMessageKey(decide.error))}</Alert></div> : null}
      <Table caption={t("admin.users.caption")} columns={cols} rows={users.data?.items ?? []} rowKey={(u) => u.id} loading={users.isPending} error={users.isError ? <ErrorPanel error={users.error} /> : undefined} empty={t("table.empty.title")} />
      <Card as="div" heading={t("admin.grants.title")} headingLevel={2}>
        <Table caption={t("admin.grants.caption")} columns={gcols} rows={grants.data?.items ?? []} rowKey={(g) => g.id} loading={grants.isPending} error={grants.isError ? <ErrorPanel error={grants.error} /> : undefined} empty={t("table.empty.title")} />
      </Card>
      <Dialog open={!!target} onClose={() => setTarget(null)} title={t("admin.users.requestRole")} footer={<><Button variant="primary" disabled={!role || !reason || (role === "center_clinician" && !centerId)} loading={propose.isPending} onClick={() => propose.mutate()}>{t("admin.grants.propose")}</Button><Button onClick={() => setTarget(null)}>{t("common.action.cancel")}</Button></>}>
        <div className="stack">
          <p>{target?.displayName}</p>
          <p className="muted">{t("admin.grants.secondApprover")}</p>
          <Select label={t("admin.users.col.roles")} value={role} onChange={(e) => setRole(e.target.value)} placeholder={t("samples.entry.choose")} options={roleOpts} required />
          {role === "center_clinician" ? <Select label={t("samples.col.center")} value={centerId} onChange={(e) => setCenterId(e.target.value)} placeholder={t("samples.entry.choose")} options={centers.centers.map((c) => ({ value: c.id, label: centers.label(c.id) }))} required /> : null}
          <Textarea label={t("admin.grants.reason")} value={reason} onChange={(e) => setReason(e.target.value)} rows={2} required autoComplete="off" />
          {propose.isError ? <div role="alert"><Alert tone="danger">{t(problemMessageKey(propose.error))}</Alert></div> : null}
        </div>
      </Dialog>
      <Dialog open={invite} onClose={() => setInvite(false)} title={t("admin.users.invite")} footer={<><Button variant="primary" disabled={!inv.email || !inv.displayName || !inv.role} loading={inviteMut.isPending} onClick={() => inviteMut.mutate()}>{t("admin.users.invite.send")}</Button><Button onClick={() => setInvite(false)}>{t("common.action.cancel")}</Button></>}>
        <div className="stack">
          <Input label={t("admin.users.col.email")} type="email" value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} required dir="ltr" />
          <Input label={t("admin.users.col.name")} value={inv.displayName} onChange={(e) => setInv({ ...inv, displayName: e.target.value })} required />
          <Select label={t("admin.users.col.roles")} value={inv.role} onChange={(e) => setInv({ ...inv, role: e.target.value })} placeholder={t("samples.entry.choose")} options={roleOpts} required />
          {inviteMut.isError ? <div role="alert"><Alert tone="danger">{t(problemMessageKey(inviteMut.error))}</Alert></div> : null}
        </div>
      </Dialog>
    </div>
  );
}
