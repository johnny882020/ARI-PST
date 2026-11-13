import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AggregateCountTile, Alert, Button, Chip, EmptyState, FacetFilter, SearchBox, SuppressedCell, SuppressionNotice, Table, Badge, type FacetOption, type TableColumn } from "@ari/design-system";
import { isApiProblem, unwrap, type FacetBucket, type SearchFilters } from "@ari/api-client";
import { api } from "../../lib/api";
import { qk } from "../../lib/query";
import { useLocale, useT } from "../../app/locale";
import { useCan } from "../../app/session";
import { PageHeading } from "../../shared/page";
import { ErrorPanel, WidgetBoundary } from "../../shared/errors";
import { ENUMS, useCenters, useDiagnoses, useEnumLabel, type EnumGroup } from "../../shared/enums";
import { countActive, filtersFromParams, filtersToParams } from "./filters";
import { fmtNumber } from "../../lib/format";
import { RecordResults } from "./RecordResults";

function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v);
  useEffect(() => { const id = setTimeout(() => setD(v), ms); return () => clearTimeout(id); }, [v, ms]);
  return d;
}

const FACET_FOR: Record<string, { facet: string; field: keyof SearchFilters; group?: EnumGroup }> = {
  sampleType: { facet: "sampleType", field: "sampleType", group: "sampleType" },
  ageBand: { facet: "ageBand", field: "ageBand", group: "ageBand" },
  timepoint: { facet: "timepoint", field: "timepoint", group: "timepoint" },
  availability: { facet: "availability", field: "availability", group: "availability" },
  attachedData: { facet: "attachedData", field: "attachedData", group: "attachedData" },
  center: { facet: "center", field: "centerId" },
  diagnosis: { facet: "diagnosis", field: "diagnosis" },
};

export function SearchPage() {
  const t = useT();
  const { locale } = useLocale();
  const qc = useQueryClient();
  const enumLabel = useEnumLabel();
  const dx = useDiagnoses();
  const centers = useCenters();
  const [params, setParams] = useSearchParams();
  const loc = useLocation() as { state: { q?: string } | null };
  const filters = useMemo(() => filtersFromParams(params), [params]);
  // Free text is kept in memory (and router state from the dashboard), never in the URL.
  const [q, setQ] = useState(typeof loc.state?.q === "string" ? loc.state.q : "");
  const [submittedQ, setSubmittedQ] = useState(q);
  const debounced = useDebounced(filters, 400);
  const canCart = useCan("cart.use");
  const canRecords = useCan("search.records");
  const [added, setAdded] = useState(false);

  const body = { q: submittedQ || undefined, lang: locale, filters: debounced };
  const agg = useQuery({ queryKey: qk.aggregate(body), queryFn: () => unwrap(api.POST("/search/aggregate", { body })), staleTime: 30_000, placeholderData: (p) => p });
  const facetBody = { ...body, facets: ["diagnosis", "sampleType", "ageBand", "center", "timepoint", "attachedData"] as ("diagnosis" | "sampleType" | "ageBand" | "center" | "timepoint" | "attachedData")[] };
  const fac = useQuery({ queryKey: qk.facets(facetBody), queryFn: () => unwrap(api.POST("/search/facets", { body: facetBody })), staleTime: 30_000, placeholderData: (p) => p });

  const setFilter = (field: keyof SearchFilters, values: string[]) => {
    const next = { ...filters, [field]: values } as SearchFilters;
    if (!values.length) delete next[field];
    setParams(filtersToParams(next), { replace: true });
    setAdded(false);
  };
  const clear = () => { setParams(new URLSearchParams(), { replace: true }); setAdded(false); };

  const addToCart = useMutation({
    mutationFn: () => unwrap(api.POST("/request-cart/items", { body: { criteria: filters, q: submittedQ || undefined } })),
    onSuccess: (cart) => { qc.setQueryData(qk.cart, cart); setAdded(true); },
  });

  const opts = (key: string): FacetOption[] => {
    const info = FACET_FOR[key]!;
    const buckets: FacetBucket[] = fac.data?.facets[info.facet] ?? [];
    const values: string[] = info.group ? [...ENUMS[info.group]] : key === "center" ? centers.centers.map((c) => c.id) : dx.terms.filter((d) => d.level === "type").map((d) => d.diagnosisCode);
    return values.map((v) => {
      const b = buckets.find((x) => x.bucket === v);
      return {
        value: v,
        label: info.group ? enumLabel(info.group, v) : key === "center" ? centers.label(v) : dx.label(v),
        count: b ? (b.suppressed ? null : b.count ?? null) : fac.data ? null : undefined,
      };
    });
  };
  const sel = (field: keyof SearchFilters) => ((filters as Record<string, string[] | undefined>)[field] ?? []);

  const chipLabel = (field: string, v: string): string => {
    const g = Object.entries(FACET_FOR).find(([, i]) => i.field === field)?.[1];
    if (g?.group) return enumLabel(g.group, v);
    return field === "centerId" ? centers.label(v) : field === "diagnosis" ? dx.label(v) : v;
  };

  const rate = isApiProblem(agg.error) && agg.error.status === 429 ? agg.error : null;
  const a = agg.data;
  const state = agg.isPending ? "loading" : agg.isError && !a ? "error" : a?.suppressed ? "suppressed" : "value";
  const diagBuckets = (fac.data?.facets.diagnosis ?? []).slice().sort((x, y) => Number(x.suppressed) - Number(y.suppressed));
  const cols: TableColumn<FacetBucket>[] = [
    { key: "dx", header: t("search.results.diagnosis"), render: (b) => (b.level === "value" ? dx.label(b.bucket) : <span>{t("counts.other")} <Badge tone="info">{t("counts.merged.chip")}</Badge></span>) },
    { key: "count", header: t("search.results.count"), numeric: true, render: (b) => (b.suppressed || b.count == null ? <SuppressedCell /> : <bdi dir="ltr">{fmtNumber(b.count, locale)}</bdi>) },
  ];
  const nothing = !agg.isPending && a?.suppressed && countActive(filters) > 0 && diagBuckets.every((b) => b.suppressed);

  return (
    <div className="stack">
      <PageHeading titleKey="search.title" lead={t("privacy.notice.short")} />
      <SearchBox label={t("search.input.label")} placeholder={t("search.input.placeholder")} value={q} onChange={setQ} onSubmit={(v) => setSubmittedQ(v.trim())} loading={agg.isFetching} />
      <div className="search-layout">
        <aside className="filters" aria-labelledby="search-filters-title">
          <h2 id="search-filters-title" className="section-title">{t("search.filters.title")}</h2>
          <FacetFilter legend={t("search.filters.sampleType")} options={opts("sampleType")} selected={sel("sampleType")} onChange={(v) => setFilter("sampleType", v)} />
          <FacetFilter legend={t("search.filters.ageBand")} options={opts("ageBand")} selected={sel("ageBand")} onChange={(v) => setFilter("ageBand", v)} collapsible defaultExpanded={false} />
          <FacetFilter legend={t("search.filters.diagnosis")} options={opts("diagnosis")} selected={sel("diagnosis")} onChange={(v) => setFilter("diagnosis", v)} collapsible defaultExpanded={false} />
          <FacetFilter legend={t("search.filters.center")} options={opts("center")} selected={sel("centerId")} onChange={(v) => setFilter("centerId", v)} collapsible defaultExpanded={false} />
          <FacetFilter legend={t("search.filters.timepoint")} options={opts("timepoint")} selected={sel("timepoint")} onChange={(v) => setFilter("timepoint", v)} collapsible defaultExpanded={false} />
          <FacetFilter legend={t("search.filters.attachedData")} options={opts("attachedData")} selected={sel("attachedData")} onChange={(v) => setFilter("attachedData", v)} collapsible defaultExpanded={false} />
        </aside>
        <section className="stack results" aria-labelledby="search-results-title" aria-live="polite" aria-busy={agg.isFetching}>
          <h2 id="search-results-title" className="section-title">{t("search.results.title")}</h2>
          {countActive(filters) > 0 ? (
            <div className="chips">
              {Object.entries(filters).flatMap(([field, vs]) => (vs as string[]).map((v) => (
                <Chip key={`${field}:${v}`} name={chipLabel(field, v)} onRemove={() => setFilter(field as keyof SearchFilters, (vs as string[]).filter((x) => x !== v))}>{chipLabel(field, v)}</Chip>
              )))}
              <Button size="sm" variant="quiet" onClick={clear}>{t("common.action.clearFilters")}</Button>
            </div>
          ) : null}
          {rate ? <Alert tone="warning">{t("error.rateLimit.body")}{rate.retryAfter ? ` (${rate.retryAfter}s)` : ""}</Alert> : null}
          {agg.isError && !rate && !a ? <ErrorPanel error={agg.error} onRetry={() => void agg.refetch()} /> : null}
          <WidgetBoundary>
            <AggregateCountTile label={t("search.total.label")} state={state} value={a?.count ?? null} unit={t("search.total.unit")} coordinatorView={canRecords} note={a && !a.suppressed && a.label && a.label !== String(a.count) ? `≈ ${a.label}` : undefined} />
            {nothing ? (
              <EmptyState title={t("search.empty.suppressed.title")}>{t("search.empty.suppressed.body")}</EmptyState>
            ) : (
              <Table caption={t("search.results.caption")} columns={cols} rows={diagBuckets} rowKey={(b) => `${b.level}:${b.bucket}`} loading={fac.isPending} error={fac.isError ? <ErrorPanel error={fac.error} /> : undefined} empty={<EmptyState title={t("search.empty.title")}>{t("search.empty.body")}</EmptyState>} />
            )}
            <SuppressionNotice />
          </WidgetBoundary>
          {canCart ? (
            <div className="row">
              <Button variant="primary" disabled={!a || a.suppressed || countActive(filters) + (submittedQ ? 1 : 0) === 0} loading={addToCart.isPending} onClick={() => addToCart.mutate()}>{t("cart.action.add")}</Button>
              {added ? <span role="status">{t("cart.added")} <Link to="/cart">{t("cart.open")}</Link></span> : null}
              {addToCart.isError ? <span role="alert" className="muted">{t(isApiProblem(addToCart.error) && addToCart.error.code === "CART_LIMIT" ? "cart.limit.body" : "error.generic.body")}</span> : null}
            </div>
          ) : null}
          {canRecords ? <RecordResults filters={debounced} /> : null}
        </section>
      </div>
    </div>
  );
}
