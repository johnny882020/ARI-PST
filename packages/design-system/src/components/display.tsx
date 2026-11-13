import { useState, type HTMLAttributes, type ReactNode } from "react";
import { cx, Icon, useDesignSystem, VisuallyHidden, type IconName } from "../core";
import { Button } from "./actions";

type HeadingLevel = 2 | 3 | 4 | 5;
const H = (n: HeadingLevel) => `h${n}` as "h2" | "h3" | "h4" | "h5";

/* ---------- Card ---------- */
export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  heading?: ReactNode;
  headingLevel?: HeadingLevel;
  footer?: ReactNode;
  as?: "section" | "div" | "article";
}

export function Card({ heading, headingLevel = 3, footer, as: Tag = "section", className, children, ...rest }: CardProps) {
  const HTag = H(headingLevel);
  return (
    <Tag className={cx("ds-card", className)} {...rest}>
      {heading ? <HTag className="ds-card-title">{heading}</HTag> : null}
      <div className="ds-card-body">{children}</div>
      {footer ? <div className="ds-card-footer">{footer}</div> : null}
    </Tag>
  );
}

/* ---------- Badge / StatusPill ---------- */
export type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "info" | "accent";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  icon?: IconName;
}

export function Badge({ tone = "neutral", icon, className, children, ...rest }: BadgeProps) {
  return (
    <span className={cx("ds-badge", `ds-tone-${tone}`, className)} {...rest}>
      {icon ? <Icon name={icon} size={14} /> : null}
      {children}
    </span>
  );
}

export type StatusKind =
  | "done"
  | "current"
  | "waiting-you"
  | "waiting-others"
  | "returned"
  | "rejected"
  | "upcoming";

const STATUS_VIEW: Record<StatusKind, { tone: Tone; icon?: IconName }> = {
  done: { tone: "success", icon: "check" },
  current: { tone: "primary" },
  "waiting-you": { tone: "warning", icon: "alert" },
  "waiting-others": { tone: "neutral", icon: "dash" },
  returned: { tone: "warning", icon: "alert" },
  rejected: { tone: "danger", icon: "x" },
  upcoming: { tone: "neutral" },
};

export interface StatusPillProps {
  status: StatusKind;
  /** Defaults to the built-in text for the status. Status is always color + icon + text. */
  label?: ReactNode;
  className?: string;
}

export function StatusPill({ status, label, className }: StatusPillProps) {
  const { t } = useDesignSystem();
  const v = STATUS_VIEW[status];
  return (
    <Badge tone={v.tone} icon={v.icon} className={cx("ds-pill", className)}>
      {!v.icon ? <span className="ds-pill-dot" aria-hidden="true" /> : null}
      {label ?? t(`stepper.status.${status}` as const)}
    </Badge>
  );
}

/* ---------- Alert ---------- */
export interface AlertProps {
  tone?: "info" | "success" | "warning" | "danger";
  title?: ReactNode;
  children?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}

const ALERT_ICON = { info: "info", success: "check", warning: "alert", danger: "alert" } as const;

export function Alert({ tone = "info", title, children, onDismiss, className }: AlertProps) {
  const { t } = useDesignSystem();
  return (
    <div className={cx("ds-alert", `ds-alert-${tone}`, className)} role={tone === "danger" ? "alert" : "status"}>
      <Icon name={ALERT_ICON[tone]} size={22} className="ds-alert-icon" />
      <div className="ds-alert-body">
        {title ? <div className="ds-alert-title">{title}</div> : null}
        {children ? <div>{children}</div> : null}
      </div>
      {onDismiss ? (
        <button type="button" className="ds-alert-dismiss" aria-label={t("common.dismiss")} onClick={onDismiss}>
          <Icon name="x" size={18} />
        </button>
      ) : null}
    </div>
  );
}

/* ---------- Skeleton ---------- */
export interface SkeletonProps {
  lines?: number;
  variant?: "text" | "block" | "circle";
  className?: string;
  /** Accessible loading text. Defaults to the built-in string. */
  label?: string;
}

export function Skeleton({ lines = 3, variant = "text", className, label }: SkeletonProps) {
  const { t } = useDesignSystem();
  return (
    <div className={cx("ds-skeleton-wrap", className)} role="status" aria-busy="true">
      <VisuallyHidden>{label ?? t("common.loading")}</VisuallyHidden>
      <div aria-hidden="true">
        {variant === "text" ? (
          Array.from({ length: lines }, (_, i) => (
            <div key={i} className="ds-skeleton ds-skeleton-text" style={i === lines - 1 && lines > 1 ? { inlineSize: "60%" } : undefined} />
          ))
        ) : (
          <div className={cx("ds-skeleton", variant === "circle" ? "ds-skeleton-circle" : "ds-skeleton-block")} />
        )}
      </div>
    </div>
  );
}

/* ---------- EmptyState / ErrorState ---------- */
export interface EmptyStateProps {
  title: ReactNode;
  children?: ReactNode;
  icon?: IconName;
  action?: ReactNode;
  headingLevel?: HeadingLevel;
  className?: string;
}

export function EmptyState({ title, children, icon = "search", action, headingLevel = 2, className }: EmptyStateProps) {
  const HTag = H(headingLevel);
  return (
    <div className={cx("ds-empty", className)}>
      <Icon name={icon} size={48} className="ds-empty-icon" />
      <HTag className="ds-empty-title">{title}</HTag>
      {children ? <p className="ds-empty-body">{children}</p> : null}
      {action ? <div className="ds-empty-action">{action}</div> : null}
    </div>
  );
}

export interface ErrorStateProps {
  title?: ReactNode;
  children?: ReactNode;
  /** RFC 9457 traceId. Shown as small copyable code. */
  traceId?: string;
  onRetry?: () => void;
  retryLabel?: string;
  headingLevel?: HeadingLevel;
  className?: string;
}

export function ErrorState({ title, children, traceId, onRetry, retryLabel, headingLevel = 2, className }: ErrorStateProps) {
  const { t } = useDesignSystem();
  const [copied, setCopied] = useState(false);
  const HTag = H(headingLevel);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(traceId ?? "");
      setCopied(true);
    } catch {
      /* clipboard unavailable: the code stays selectable */
    }
  };
  return (
    <div className={cx("ds-empty ds-error-state", className)} role="alert">
      <Icon name="alert" size={48} className="ds-empty-icon" />
      <HTag className="ds-empty-title">{title ?? t("error.generic.title")}</HTag>
      <p className="ds-empty-body">{children ?? t("error.generic.body")}</p>
      {onRetry ? (
        <div className="ds-empty-action">
          <Button variant="primary" onClick={onRetry}>
            {retryLabel ?? t("common.retry")}
          </Button>
        </div>
      ) : null}
      {traceId ? (
        <p className="ds-trace">
          <span>{t("error.trace.label")}: </span>
          <code dir="ltr" className="ds-ltr">
            {traceId}
          </code>{" "}
          <button type="button" className="ds-link-button" onClick={copy}>
            {copied ? t("common.copied") : t("common.copy")}
          </button>
        </p>
      ) : null}
    </div>
  );
}

/* ---------- Aggregate count ---------- */
export function SuppressedCell({ className }: { className?: string }) {
  const { t } = useDesignSystem();
  return (
    <span className={cx("ds-suppressed-cell", className)}>
      <span aria-hidden="true">—</span>
      <VisuallyHidden>{t("counts.suppressed.sr")}</VisuallyHidden>
    </span>
  );
}

export type AggregateCountState = "value" | "suppressed" | "merged" | "loading" | "error";

export interface AggregateCountTileProps {
  label: ReactNode;
  state: AggregateCountState;
  /** Used for `value` and `merged`. Ignored (never rendered) when suppressed, loading or error. */
  value?: number | null;
  /** Spoken after the number, e.g. "samples". */
  unit?: string;
  note?: ReactNode;
  /** Show the coordinator-view badge (exact counts for this role). */
  coordinatorView?: boolean;
  onRetry?: () => void;
  className?: string;
}

export function AggregateCountTile({
  label,
  state,
  value,
  unit,
  note,
  coordinatorView,
  onRetry,
  className,
}: AggregateCountTileProps) {
  const { t, locale } = useDesignSystem();
  // Defensive: a missing or invalid value is shown as suppressed, never as 0.
  const hasNumber = typeof value === "number" && Number.isFinite(value);
  const effective: AggregateCountState =
    (state === "value" || state === "merged") && !hasNumber ? "suppressed" : state;
  const fmt = new Intl.NumberFormat(locale === "he" ? "he-IL" : "en-US");
  return (
    <div className={cx("ds-tile", `ds-tile-${effective}`, className)} data-state={effective} aria-busy={effective === "loading" || undefined}>
      <div className="ds-tile-label">{label}</div>
      <div className="ds-tile-main">
        {effective === "value" || effective === "merged" ? (
          <>
            <span className="ds-tile-value" dir="ltr">
              {fmt.format(value as number)}
            </span>
            {unit ? <VisuallyHidden>{unit}</VisuallyHidden> : null}
            {effective === "merged" ? (
              <>
                <Badge tone="info" aria-hidden="true">
                  {t("counts.merged.chip")}
                </Badge>
                <VisuallyHidden>{t("counts.merged.sr")}</VisuallyHidden>
              </>
            ) : null}
          </>
        ) : null}
        {effective === "suppressed" ? (
          <>
            <span className="ds-tile-dash" aria-hidden="true">
              <Icon name="lock" size={18} /> —
            </span>
            <span className="ds-tile-suppressed-text" aria-hidden="true">
              {t("counts.suppressed.label")}
            </span>
            <VisuallyHidden>{t("counts.suppressed.sr")}</VisuallyHidden>
          </>
        ) : null}
        {effective === "loading" ? (
          <>
            <span className="ds-skeleton ds-skeleton-value" aria-hidden="true" />
            <VisuallyHidden>{t("counts.loading")}</VisuallyHidden>
          </>
        ) : null}
        {effective === "error" ? (
          <span className="ds-tile-error">
            {t("counts.error")}{" "}
            {onRetry ? (
              <button type="button" className="ds-link-button" onClick={onRetry}>
                {t("common.retry")}
              </button>
            ) : null}
          </span>
        ) : null}
      </div>
      {note ? <div className="ds-tile-note">{note}</div> : null}
      {coordinatorView ? (
        <Badge tone="accent" className="ds-tile-badge">
          {t("counts.coordinatorView")}
        </Badge>
      ) : null}
    </div>
  );
}

/** "Why are some numbers hidden?" Disclosure. Put one on every page that shows counts. */
export function SuppressionNotice({ className }: { className?: string }) {
  const { t } = useDesignSystem();
  return (
    <details className={cx("ds-disclosure", className)}>
      <summary>{t("counts.suppressed.why.title")}</summary>
      <p>{t("counts.suppressed.why.body")}</p>
    </details>
  );
}
