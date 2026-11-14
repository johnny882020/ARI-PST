import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, EmptyState, Skeleton, Badge, SuppressedCell } from "@ari/design-system";
import { unwrap, idempotencyKey, type CartItem, type Cart } from "@ari/api-client";
import { api } from "../../lib/api";
import { qk } from "../../lib/query";
import { useT } from "../../app/locale";
import { PageHeading } from "../../shared/page";
import { ErrorPanel } from "../../shared/errors";
import { problemMessageKey } from "../../shared/problem-message";
import { useCenters, useDiagnoses, useEnumLabel } from "../../shared/enums";
import type { SearchFilters } from "@ari/api-client";
import type { MessageKey } from "@ari/i18n";
import { useEffect, useRef, useState } from "react";

export function useCriteriaText() {
  const enumLabel = useEnumLabel();
  const dx = useDiagnoses();
  const centers = useCenters();
  return (c: SearchFilters): string[] => {
    const out: string[] = [];
    for (const v of c.diagnosis ?? []) out.push(dx.label(v));
    for (const v of c.sampleType ?? []) out.push(enumLabel("sampleType", v));
    for (const v of c.ageBand ?? []) out.push(enumLabel("ageBand", v));
    for (const v of c.centerId ?? []) out.push(centers.label(v));
    for (const v of c.timepoint ?? []) out.push(enumLabel("timepoint", v));
    for (const v of c.availability ?? []) out.push(enumLabel("availability", v));
    for (const v of c.attachedData ?? []) out.push(enumLabel("attachedData", v));
    for (const v of c.sex ?? []) out.push(enumLabel("sex", v));
    return out;
  };
}

/** Count band stored with a cart item ("10_plus", "lt10"). Known bands get the approved band wording; never a threshold. */
const COUNT_BANDS: Record<string, MessageKey> = { "10_plus": "cart.count.10_plus", lt10: "cart.count.lt10" };
export function countBandKey(label: string): MessageKey | null { return COUNT_BANDS[label] ?? null; }

export function CartPage() {
  const t = useT();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [undo, setUndo] = useState<CartItem | null>(null);
  useEffect(() => { if (!undo) return; const id = setTimeout(() => setUndo(null), 10_000); return () => clearTimeout(id); }, [undo]);
  const text = useCriteriaText();
  const key = useRef(idempotencyKey());
  const q = useQuery({ queryKey: qk.cart, queryFn: () => unwrap(api.GET("/request-cart")) });

  const remove = useMutation({
    mutationFn: (item: CartItem) => unwrap(api.DELETE("/request-cart/items/{itemId}", { params: { path: { itemId: item.id } } })),
    onSuccess: (cart: Cart, item) => {
      qc.setQueryData(qk.cart, cart);
      setUndo(item);
    },
  });
  const start = useMutation({
    mutationFn: () => unwrap(api.POST("/request-cart/start", { params: { header: { "Idempotency-Key": key.current } } as never })),
    onSuccess: (r) => nav(`/requests/new?draft=${r.id}`),
  });

  const items = q.data?.items ?? [];
  return (
    <div className="stack">
      <PageHeading titleKey="cart.title" lead={t("cart.lead")} />
      {undo ? (
        <Alert tone="info">
          {t("cart.removed")}{" "}
          <Button size="sm" variant="quiet" onClick={() => { const i = undo; setUndo(null); void unwrap(api.POST("/request-cart/items", { body: { criteria: i.criteria } })).then((c) => qc.setQueryData(qk.cart, c)); }}>{t("cart.undo")}</Button>
        </Alert>
      ) : null}
      {q.isPending ? <Skeleton lines={4} /> : q.isError ? <ErrorPanel error={q.error} onRetry={() => void q.refetch()} /> : items.length === 0 ? (
        <EmptyState title={t("cart.empty.title")} action={<Link className="ds-btn ds-btn-primary" to="/search"><span className="ds-btn-label">{t("nav.search")}</span></Link>}>{t("cart.empty.body")}</EmptyState>
      ) : (
        <>
          <ul className="stack" style={{ listStyle: "none", padding: 0 }} aria-label={t("cart.list")}>
            {items.map((it) => (
              <li key={it.id}>
                <Card as="div" heading={text(it.criteria).join(" · ") || t("cart.item.allSamples")} headingLevel={2}
                  footer={<Button size="sm" variant="secondary" loading={remove.isPending && remove.variables?.id === it.id} onClick={() => remove.mutate(it)}>{t("cart.item.remove")}</Button>}>
                  <div className="row">
                    <span className="muted">{t("cart.item.snapshot")}</span>
                    {it.snapshot.suppressed ? <SuppressedCell /> : countBandKey(it.snapshot.label) ? <span>{t(countBandKey(it.snapshot.label)!)}</span> : <bdi dir="ltr">{it.snapshot.label}</bdi>}
                    <Badge tone="neutral">{t("cart.item.mayChange")}</Badge>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
          <p className="muted">{t("cart.limit.note", { count: q.data?.limit ?? 10 })}</p>
          {start.isError ? <Alert tone="danger">{t(problemMessageKey(start.error))}</Alert> : null}
          <div className="form-actions">
            <Button variant="primary" loading={start.isPending} onClick={() => start.mutate()}>{t("cart.start")}</Button>
          </div>
          <Card as="div" heading={t("cart.next.title")} headingLevel={2}><ol><li>{t("cart.next.1")}</li><li>{t("cart.next.2")}</li><li>{t("cart.next.3")}</li></ol></Card>
        </>
      )}
    </div>
  );
}
