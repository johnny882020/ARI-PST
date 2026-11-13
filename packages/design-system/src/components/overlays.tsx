import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { cx, Icon, useDesignSystem } from "../core";
import { Button, IconButton } from "./actions";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/* ---------- Dialog ---------- */
export interface DialogProps {
  open: boolean;
  /** Called on Esc, close button and backdrop click (when dismissible). */
  onClose: () => void;
  title: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  role?: "dialog" | "alertdialog";
  /** Default true. Set false for dialogs that need an explicit choice. */
  dismissible?: boolean;
  /** Element to focus on open. Default: first focusable inside. */
  initialFocusRef?: RefObject<HTMLElement>;
  closeLabel?: string;
  className?: string;
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  role = "dialog",
  dismissible = true,
  initialFocusRef,
  closeLabel,
  className,
}: DialogProps) {
  const { t, locale, dir } = useDesignSystem();
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const host = panel.current?.closest(".ds-dialog-portal") as HTMLElement | null;
    // Make the rest of the page inert while the dialog is open.
    const hidden: Array<[Element, string | null]> = [];
    for (const el of Array.from(document.body.children)) {
      if (el !== host && !el.classList.contains("ds-dialog-portal") && !el.hasAttribute("inert")) {
        hidden.push([el, el.getAttribute("aria-hidden")]);
        el.setAttribute("inert", "");
        el.setAttribute("aria-hidden", "true");
      }
    }
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const first = initialFocusRef?.current ?? panel.current?.querySelector<HTMLElement>(FOCUSABLE) ?? panel.current;
    first?.focus();
    return () => {
      for (const [el, aria] of hidden) {
        el.removeAttribute("inert");
        if (aria === null) el.removeAttribute("aria-hidden");
        else el.setAttribute("aria-hidden", aria);
      }
      document.body.style.overflow = prevOverflow;
      previous?.focus?.();
    };
  }, [open, initialFocusRef]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && dismissible) {
      e.stopPropagation();
      onCloseRef.current();
      return;
    }
    if (e.key !== "Tab" || !panel.current) return;
    const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const firstEl = items[0]!;
    const lastEl = items[items.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && (active === firstEl || active === panel.current)) {
      e.preventDefault();
      lastEl.focus();
    } else if (!e.shiftKey && active === lastEl) {
      e.preventDefault();
      firstEl.focus();
    }
  };

  return createPortal(
    <div className="ds-dialog-portal ds-root" lang={locale} dir={dir}>
      <div className="ds-scrim" onClick={dismissible ? onClose : undefined} data-testid="ds-scrim" />
      <div className="ds-dialog-wrap" onKeyDown={onKeyDown}>
        <div
          ref={panel}
          role={role}
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={children ? bodyId : undefined}
          tabIndex={-1}
          className={cx("ds-dialog", className)}
        >
          <div className="ds-dialog-head">
            <h2 id={titleId} className="ds-dialog-title">
              {title}
            </h2>
            {dismissible ? (
              <IconButton label={closeLabel ?? t("common.close")} onClick={onClose} noTooltip>
                <Icon name="x" />
              </IconButton>
            ) : null}
          </div>
          {children ? (
            <div id={bodyId} className="ds-dialog-body">
              {children}
            </div>
          ) : null}
          {footer ? <div className="ds-dialog-footer">{footer}</div> : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ---------- SessionTimeoutDialog ---------- */
export interface SessionTimeoutDialogProps {
  open: boolean;
  /** Seconds until forced sign-out. */
  secondsRemaining: number;
  onExtend: () => void;
  onSignOut: () => void;
}

function mmss(total: number): string {
  const s = Math.max(0, Math.floor(total));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function SessionTimeoutDialog({ open, secondsRemaining, onExtend, onSignOut }: SessionTimeoutDialogProps) {
  const { t } = useDesignSystem();
  const extendRef = useRef<HTMLButtonElement>(null);
  // Screen readers hear the time in coarse steps, not every second.
  const step = secondsRemaining > 60 ? 30 : 10;
  const spoken = mmss(Math.ceil(secondsRemaining / step) * step);
  return (
    <Dialog
      open={open}
      role="alertdialog"
      dismissible={false}
      onClose={onExtend}
      title={t("session.title")}
      initialFocusRef={extendRef}
      footer={
        <>
          <Button variant="primary" ref={extendRef} onClick={onExtend}>
            {t("session.extend")}
          </Button>
          <Button variant="secondary" onClick={onSignOut}>
            {t("session.signOut")}
          </Button>
        </>
      }
    >
      <p>{t("session.body")}</p>
      <p className="ds-session-time" aria-hidden="true">
        {t("session.remaining", { time: "" })}
        <strong dir="ltr" className="ds-ltr">
          {mmss(secondsRemaining)}
        </strong>
      </p>
      <div className="ds-vh" role="status" aria-live="polite">
        {t("session.remaining", { time: spoken })}
      </div>
    </Dialog>
  );
}

/* ---------- Toast ---------- */
export interface ToastOptions {
  tone?: "info" | "success" | "danger";
  title: ReactNode;
  description?: ReactNode;
  /** ms. Default 6000 for info/success. Errors stay until dismissed. 0 = stay. */
  duration?: number;
}
interface ToastItem extends ToastOptions {
  id: number;
}
interface ToastApi {
  show: (o: ToastOptions) => number;
  dismiss: (id: number) => void;
}
const ToastCtx = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const v = useContext(ToastCtx);
  if (!v) throw new Error("useToast must be used inside <ToastProvider>");
  return v;
}

export function ToastProvider({ children }: { children?: ReactNode }) {
  const { t } = useDesignSystem();
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setItems((l) => l.filter((x) => x.id !== id)), []);
  const show = useCallback(
    (o: ToastOptions) => {
      const id = ++seq.current;
      setItems((l) => [...l, { ...o, id }]);
      const ms = o.duration ?? (o.tone === "danger" ? 0 : 6000);
      if (ms > 0) setTimeout(() => dismiss(id), ms);
      return id;
    },
    [dismiss],
  );
  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);
  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="ds-toast-region" role="region" aria-label={t("toast.region")}>
        {items.map((it) => (
          <div key={it.id} className={cx("ds-toast", `ds-toast-${it.tone ?? "info"}`)} role={it.tone === "danger" ? "alert" : "status"}>
            <Icon name={it.tone === "success" ? "check" : it.tone === "danger" ? "alert" : "info"} size={20} />
            <div className="ds-toast-body">
              <div className="ds-toast-title">{it.title}</div>
              {it.description ? <div>{it.description}</div> : null}
            </div>
            <button type="button" className="ds-alert-dismiss" aria-label={t("common.dismiss")} onClick={() => dismiss(it.id)}>
              <Icon name="x" size={18} />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------- ConsentBanner ---------- */
export interface ConsentBannerProps {
  open: boolean;
  onAccept: () => void;
  onDecline: () => void;
  title?: ReactNode;
  children?: ReactNode;
  acceptLabel?: string;
  declineLabel?: string;
  learnMoreHref?: string;
  learnMoreLabel?: string;
}

/** Analytics consent. Default is off. Accept and Decline have equal weight (REQ-025). */
export function ConsentBanner({
  open,
  onAccept,
  onDecline,
  title,
  children,
  acceptLabel,
  declineLabel,
  learnMoreHref,
  learnMoreLabel,
}: ConsentBannerProps) {
  const { t } = useDesignSystem();
  const id = useId();
  if (!open) return null;
  return (
    <section className="ds-consent" aria-labelledby={id}>
      <div className="ds-consent-text">
        <h2 id={id} className="ds-consent-title">
          {title ?? t("consent.title")}
        </h2>
        <p>{children ?? t("consent.body")}</p>
        {learnMoreHref ? <a href={learnMoreHref}>{learnMoreLabel ?? t("consent.more")}</a> : null}
      </div>
      <div className="ds-consent-actions">
        <Button variant="secondary" onClick={onDecline}>
          {declineLabel ?? t("consent.decline")}
        </Button>
        <Button variant="secondary" onClick={onAccept}>
          {acceptLabel ?? t("consent.accept")}
        </Button>
      </div>
    </section>
  );
}
