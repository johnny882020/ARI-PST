import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Alert, Card, SearchBox, Skeleton } from "@ari/design-system";
import { unwrap, type RequestDto } from "@ari/api-client";
import { api } from "../../lib/api";
import { qk } from "../../lib/query";
import { useT } from "../../app/locale";
import { useCan, useSession } from "../../app/session";
import { PageHeading } from "../../shared/page";
import { ErrorPanel, WidgetBoundary } from "../../shared/errors";
import type { MessageKey } from "@ari/i18n";

function Tile({ label, value, to }: { label: string; value: number | string; to?: string }) {
  const body = (<><div className="muted">{label}</div><div className="tile-num" style={{ fontSize: "var(--fs-h2)" }}><bdi dir="ltr">{value}</bdi></div></>);
  return <Card as="div">{to ? <Link to={to} style={{ textDecoration: "none", color: "inherit" }}>{body}</Link> : body}</Card>;
}

function ResearcherHome() {
  const t = useT();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const reqs = useQuery({ queryKey: qk.requests(), queryFn: () => unwrap(api.GET("/requests", { params: { query: {} } })) });
  const cart = useQuery({ queryKey: qk.cart, queryFn: () => unwrap(api.GET("/request-cart")) });
  const items: RequestDto[] = reqs.data?.items ?? [];
  const waiting = items.filter((r) => ["submitted", "precheck", "committee_review", "approved", "center_coordination", "agreements", "delivery"].includes(r.status)).length;
  const needs = items.filter((r) => r.status === "needs_info");
  return (
    <div className="stack">
      <SearchBox label={t("search.input.label")} placeholder={t("search.input.placeholder")} value={q} onChange={setQ} onSubmit={(v) => nav("/search", { state: { q: v } })} />
      <p className="muted">{t("home.researcher.aggregateOnly")}</p>
      {needs.length > 0 ? (
        <Alert tone="warning" title={t("requests.tracker.status.needsInfo")}>
          <Link to={`/requests/${needs[0]!.id}`}>{t("requests.tracker.needsAction.open")}</Link>
        </Alert>
      ) : null}
      {reqs.isPending ? <Skeleton lines={2} /> : reqs.isError ? <ErrorPanel error={reqs.error} onRetry={() => void reqs.refetch()} /> : (
        <div className="grid-tiles">
          <Tile label={t("home.researcher.waiting")} value={waiting} to="/requests" />
          <Tile label={t("home.researcher.needsInfo")} value={needs.length} to="/requests" />
          <Tile label={t("home.researcher.delivered")} value={items.filter((r) => r.status === "delivered").length} to="/requests" />
          <Tile label={t("home.researcher.cart")} value={cart.data?.items.length ?? 0} to="/cart" />
        </div>
      )}
    </div>
  );
}

function CoordinatorHome() {
  const t = useT();
  const reqs = useQuery({ queryKey: qk.requests({ status: "precheck" }), queryFn: () => unwrap(api.GET("/requests", { params: { query: { status: "precheck" } } })) });
  const regs = useQuery({ queryKey: qk.registrations, queryFn: () => unwrap(api.GET("/registrations")) });
  const stale = useQuery({ queryKey: qk.samples({ staleness: "stale", limit: 100 }), queryFn: () => unwrap(api.GET("/samples", { params: { query: { staleness: "stale", limit: 100 } } })) });
  return (
    <div className="grid-tiles">
      <Tile label={t("home.coordinator.precheck")} value={reqs.data?.items.length ?? "…"} to="/requests" />
      <Tile label={t("home.coordinator.registrations")} value={regs.data?.items.filter((r) => r.status === "pending").length ?? "…"} to="/admin/registrations" />
      <Tile label={t("home.coordinator.stale")} value={stale.data?.items.length ?? "…"} to="/freshness" />
      <Tile label={t("home.coordinator.addRecord")} value="+" to="/samples/new" />
    </div>
  );
}

function AdminHome() {
  const t = useT();
  return (
    <>
      <p className="muted">{t("home.admin.noSampleData")}</p>
      <div className="grid-tiles">
        <Tile label={t("nav.users")} value="→" to="/admin/users" />
        <Tile label={t("nav.audit")} value="→" to="/audit" />
        <Tile label={t("nav.settings")} value="→" to="/admin/settings/privacy" />
      </div>
    </>
  );
}

export function HomePage() {
  const { state } = useSession();
  const t = useT();
  const isResearcher = useCan("cart.use");
  const isCoord = useCan("registrations.approve");
  const isAdmin = useCan("users.admin");
  const name = state.status === "authenticated" ? state.session.displayName : "";
  const lead: MessageKey = isCoord ? "home.coordinator.lead" : isAdmin ? "home.admin.lead" : "home.lead";
  return (
    <div className="stack">
      <PageHeading titleKey="home.title" lead={`${t("home.greeting", { name })} ${t(lead)}`} />
      <WidgetBoundary>
        {isResearcher ? <ResearcherHome /> : isCoord ? <CoordinatorHome /> : isAdmin ? <AdminHome /> : (
          <div className="grid-tiles">
            <Tile label={t("nav.search")} value="→" to="/search" />
          </div>
        )}
      </WidgetBoundary>
    </div>
  );
}
