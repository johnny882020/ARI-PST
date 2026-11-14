import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { cx, Icon, Ltr, useDesignSystem, type IconName, type MessageKey } from "../core";
import { Button, IconButton } from "./actions";
import { Alert, EmptyState, StatusPill, type StatusKind } from "./display";

/* ---------- Tabs ---------- */
export interface TabItem {
  id: string;
  label: ReactNode;
  panel: ReactNode;
  disabled?: boolean;
}
export interface TabsProps {
  tabs: TabItem[];
  label: string;
  value?: string;
  defaultValue?: string;
  onChange?: (id: string) => void;
  className?: string;
}

export function Tabs({ tabs, label, value, defaultValue, onChange, className }: TabsProps) {
  const { dir } = useDesignSystem();
  const uid = useId();
  const [own, setOwn] = useState(defaultValue ?? tabs.find((t) => !t.disabled)?.id ?? "");
  const current = value ?? own;
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const enabled = tabs.filter((t) => !t.disabled);
  const select = (id: string) => {
    setOwn(id);
    onChange?.(id);
    refs.current[id]?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    const i = enabled.findIndex((t) => t.id === current);
    // Arrow keys follow reading direction: ArrowLeft goes to the next tab in RTL.
    const fwd = dir === "rtl" ? "ArrowLeft" : "ArrowRight";
    const back = dir === "rtl" ? "ArrowRight" : "ArrowLeft";
    let next = -1;
    if (e.key === fwd) next = (i + 1) % enabled.length;
    else if (e.key === back) next = (i - 1 + enabled.length) % enabled.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = enabled.length - 1;
    if (next >= 0) {
      e.preventDefault();
      select(enabled[next]!.id);
    }
  };
  return (
    <div className={cx("ds-tabs", className)}>
      <div role="tablist" aria-label={label} className="ds-tablist" onKeyDown={onKey}>
        {tabs.map((t) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el;
            }}
            role="tab"
            type="button"
            id={`${uid}-tab-${t.id}`}
            aria-controls={`${uid}-panel-${t.id}`}
            aria-selected={current === t.id}
            tabIndex={current === t.id ? 0 : -1}
            disabled={t.disabled}
            className={cx("ds-tab", current === t.id && "ds-selected")}
            onClick={() => select(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div
          key={t.id}
          role="tabpanel"
          id={`${uid}-panel-${t.id}`}
          aria-labelledby={`${uid}-tab-${t.id}`}
          hidden={current !== t.id}
          tabIndex={0}
          className="ds-tabpanel"
        >
          {t.panel}
        </div>
      ))}
    </div>
  );
}

/* ---------- Table ---------- */
export type SortDirection = "asc" | "desc";
export interface TableColumn<T> {
  key: string;
  header: ReactNode;
  sortable?: boolean;
  /** Right-aligned at the inline end, LTR isolate, tabular figures. */
  numeric?: boolean;
  render?: (row: T) => ReactNode;
}
export interface TableProps<T> {
  caption: ReactNode;
  columns: TableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  sort?: { key: string; direction: SortDirection } | null;
  onSortChange?: (key: string, direction: SortDirection) => void;
  loading?: boolean;
  /** Truthy shows the error row. A ReactNode replaces the default text. */
  error?: boolean | ReactNode;
  onRetry?: () => void;
  empty?: ReactNode;
  className?: string;
}

export function Table<T>({
  caption,
  columns,
  rows,
  rowKey,
  sort,
  onSortChange,
  loading,
  error,
  onRetry,
  empty,
  className,
}: TableProps<T>) {
  const { t } = useDesignSystem();
  const capId = useId();
  const cell = (row: T, c: TableColumn<T>): ReactNode => {
    const v = c.render ? c.render(row) : ((row as Record<string, unknown>)[c.key] as ReactNode);
    return c.numeric ? <Ltr>{v}</Ltr> : v;
  };
  const span = columns.length;
  return (
    <div role="region" aria-labelledby={capId} tabIndex={0} className={cx("ds-table-region", className)}>
      <table className="ds-table" aria-busy={loading || undefined}>
        <caption id={capId} className="ds-table-caption">
          {caption}
        </caption>
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort?.key === c.key;
              const ariaSort = c.sortable ? (active ? (sort!.direction === "asc" ? "ascending" : "descending") : "none") : undefined;
              const next: SortDirection = active && sort!.direction === "asc" ? "desc" : "asc";
              return (
                <th key={c.key} scope="col" aria-sort={ariaSort} className={cx(c.numeric && "ds-num")}>
                  {c.sortable ? (
                    <button type="button" className="ds-sort-btn" onClick={() => onSortChange?.(c.key, next)}>
                      <span>{c.header}</span>
                      <Icon name={active ? (sort!.direction === "asc" ? "arrow-up" : "arrow-down") : "sort"} size={16} />
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading
            ? [0, 1, 2].map((i) => (
                <tr key={`sk${i}`} aria-hidden="true">
                  {columns.map((c) => (
                    <td key={c.key}>
                      <span className="ds-skeleton ds-skeleton-text" />
                    </td>
                  ))}
                </tr>
              ))
            : error
              ? (
                <tr>
                  <td colSpan={span}>
                    <Alert tone="danger">
                      {error === true ? t("table.error") : error}{" "}
                      {onRetry ? (
                        <Button size="sm" onClick={onRetry}>
                          {t("common.retry")}
                        </Button>
                      ) : null}
                    </Alert>
                  </td>
                </tr>
              )
              : rows.length === 0
                ? (
                  <tr>
                    <td colSpan={span}>{empty ?? <EmptyState title={t("table.empty.title")} icon="filter" headingLevel={3} />}</td>
                  </tr>
                )
                : rows.map((r) => (
                    <tr key={rowKey(r)}>
                      {columns.map((c) => (
                        <td key={c.key} className={cx(c.numeric && "ds-num")}>
                          {cell(r, c)}
                        </td>
                      ))}
                    </tr>
                  ))}
        </tbody>
      </table>
      {loading ? (
        <span className="ds-vh" role="status">
          {t("common.loading")}
        </span>
      ) : null}
    </div>
  );
}

/* ---------- Pagination (cursor) ---------- */
export interface PaginationProps {
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  /** Optional status text such as "21–40". Announced politely. */
  status?: ReactNode;
  label?: string;
  className?: string;
}

export function Pagination({ hasPrevious, hasNext, onPrevious, onNext, status, label, className }: PaginationProps) {
  const { t } = useDesignSystem();
  return (
    <nav aria-label={label ?? t("common.pagination")} className={cx("ds-pagination", className)}>
      <Button variant="secondary" disabled={!hasPrevious} onClick={onPrevious} iconStart={<Icon name="chevron-start" size={18} />}>
        {t("common.previous")}
      </Button>
      {status ? (
        <span className="ds-pagination-status" aria-live="polite">
          {status}
        </span>
      ) : null}
      <Button variant="secondary" disabled={!hasNext} onClick={onNext} iconEnd={<Icon name="chevron-end" size={18} />}>
        {t("common.next")}
      </Button>
    </nav>
  );
}

/* ---------- Stepper ---------- */
export interface StepperStep {
  id: string;
  label: ReactNode;
  status: StatusKind;
  description?: ReactNode;
  /** ISO date, shown as LTR. */
  date?: string;
}
export interface StepperProps {
  steps: StepperStep[];
  label?: string;
  orientation?: "vertical" | "horizontal";
  className?: string;
}

const ACTIVE: ReadonlySet<StatusKind> = new Set(["current", "waiting-you", "waiting-others", "returned", "rejected"]);

export function Stepper({ steps, label, orientation = "vertical", className }: StepperProps) {
  const { t } = useDesignSystem();
  const activeIndex = steps.findIndex((s) => ACTIVE.has(s.status));
  return (
    <ol aria-label={label ?? t("stepper.label")} className={cx("ds-stepper", `ds-stepper-${orientation}`, className)}>
      {steps.map((s, i) => (
        <li
          key={s.id}
          className={cx("ds-step", `ds-step-${s.status}`)}
          aria-current={i === activeIndex ? "step" : undefined}
        >
          <span className="ds-step-marker" aria-hidden="true">
            {s.status === "done" ? <Icon name="check" size={16} /> : s.status === "rejected" ? <Icon name="x" size={16} /> : <Ltr>{i + 1}</Ltr>}
          </span>
          <div className="ds-step-body">
            <div className="ds-step-title">{s.label}</div>
            <div className="ds-step-meta">
              <StatusPill status={s.status} />
              {s.date ? (
                <Ltr>
                  <time dateTime={s.date}>{s.date}</time>
                </Ltr>
              ) : null}
            </div>
            {s.description ? <div className="ds-step-desc">{s.description}</div> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** The 8 steps of the access-request tracker (REQ-034, canonical-decisions section 2). */
export const REQUEST_STEP_IDS = [
  "cart",
  "submission",
  "precheck",
  "committee",
  "coordination",
  "agreements",
  "delivery",
  "closed",
] as const;
export type RequestStepId = (typeof REQUEST_STEP_IDS)[number];

export interface BuildRequestStepsOptions {
  labels: Record<RequestStepId, ReactNode>;
  current: RequestStepId;
  /** Status of the current step. Default `current` (or `done` when current is `closed`). */
  status?: StatusKind;
  dates?: Partial<Record<RequestStepId, string>>;
  descriptions?: Partial<Record<RequestStepId, ReactNode>>;
}

export function buildRequestSteps({ labels, current, status, dates, descriptions }: BuildRequestStepsOptions): StepperStep[] {
  const ci = REQUEST_STEP_IDS.indexOf(current);
  return REQUEST_STEP_IDS.map((id, i) => ({
    id,
    label: labels[id],
    status: i < ci ? "done" : i === ci ? (status ?? (id === "closed" ? "done" : "current")) : "upcoming",
    date: dates?.[id],
    description: descriptions?.[id],
  }));
}

/** Same as buildRequestSteps with built-in he/en labels. */
export function useRequestSteps(opts: Omit<BuildRequestStepsOptions, "labels"> & { labels?: Partial<Record<RequestStepId, ReactNode>> }): StepperStep[] {
  const { t } = useDesignSystem();
  const labels = Object.fromEntries(
    REQUEST_STEP_IDS.map((id) => [id, opts.labels?.[id] ?? t(`step.${id}` as MessageKey)]),
  ) as Record<RequestStepId, ReactNode>;
  return buildRequestSteps({ ...opts, labels });
}

/* ---------- Nav / AppShell ---------- */
export interface NavItem {
  id: string;
  label: ReactNode;
  href: string;
  current?: boolean;
  icon?: IconName;
}
export interface NavLinkRenderProps {
  className: string;
  "aria-current"?: "page";
  children: ReactNode;
  onClick?: (e: MouseEvent<HTMLElement>) => void;
}
export interface NavProps {
  items: NavItem[];
  label?: string;
  /** Plug in a router Link: (item, props) => <Link to={item.href} {...props} /> */
  renderLink?: (item: NavItem, props: NavLinkRenderProps) => ReactNode;
  onNavigate?: (item: NavItem) => void;
  className?: string;
}

export function Nav({ items, label, renderLink, onNavigate, className }: NavProps) {
  const { t } = useDesignSystem();
  return (
    <nav aria-label={label ?? t("nav.primary")} className={cx("ds-nav", className)}>
      <ul className="ds-nav-list">
        {items.map((it) => {
          const props: NavLinkRenderProps = {
            className: cx("ds-nav-link", it.current && "ds-selected"),
            "aria-current": it.current ? "page" : undefined,
            onClick: () => onNavigate?.(it),
            children: (
              <>
                {it.icon ? <Icon name={it.icon} size={20} /> : null}
                <span>{it.label}</span>
              </>
            ),
          };
          return <li key={it.id}>{renderLink ? renderLink(it, props) : <a href={it.href} {...props} />}</li>;
        })}
      </ul>
    </nav>
  );
}

export interface AppShellProps {
  brand: ReactNode;
  nav: NavItem[];
  navLabel?: string;
  renderLink?: NavProps["renderLink"];
  /** Language switch, theme toggle, user menu, session timer. On small screens these move behind the menu button. */
  headerActions?: ReactNode;
  /** Stays in the header bar at every width (for example the cart link). Keep it short. */
  headerPinned?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function AppShell({ brand, nav, navLabel, renderLink, headerActions, headerPinned, footer, children, className }: AppShellProps) {
  const { t } = useDesignSystem();
  const [open, setOpen] = useState(false);
  const navId = useId();
  return (
    <div className={cx("ds-shell", className)}>
      <a className="ds-skip" href="#ds-main">
        {t("nav.skip")}
      </a>
      <header className="ds-shell-header">
        <div className="ds-shell-brand">{brand}</div>
        {headerPinned ? <div className="ds-shell-pinned">{headerPinned}</div> : null}
        <IconButton
          label={t("nav.menu")}
          variant="outline"
          className="ds-shell-menu"
          aria-expanded={open}
          aria-controls={navId}
          onClick={() => setOpen(!open)}
          noTooltip
        >
          <Icon name="menu" />
        </IconButton>
        {headerActions ? (
          <div className="ds-shell-actions" data-open={open ? "true" : "false"}>
            {headerActions}
          </div>
        ) : null}
      </header>
      <div className="ds-shell-body">
        <div id={navId} className="ds-shell-nav" data-open={open ? "true" : "false"}>
          <Nav items={nav} label={navLabel} renderLink={renderLink} onNavigate={() => setOpen(false)} />
        </div>
        <main id="ds-main" tabIndex={-1} className="ds-shell-main">
          {children}
        </main>
      </div>
      {footer ? <footer className="ds-shell-footer">{footer}</footer> : null}
    </div>
  );
}
