import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cx, Icon, Spinner, useDesignSystem, useTheme, type Locale, type Theme } from "../core";
import { Tooltip } from "./tooltip";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

/** Class names for a button look on another element (router Link, plain <a>). */
export function buttonClass({ variant = "secondary", size = "md", arrow = false }: { variant?: ButtonVariant; size?: ButtonSize; arrow?: boolean } = {}): string {
  return cx("ds-btn", `ds-btn-${variant}`, size !== "md" && `ds-btn-${size}`, arrow && "ds-btn-with-arrow");
}

/** Trailing arrow for "go forward" buttons and links. Points to the inline end, so it mirrors in RTL. */
export function ButtonArrow() {
  return <Icon name="arrow-end" size={20} className="ds-btn-arrow" />;
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** sm 44 px, md 48 px, lg 56 px (hero). All sizes are full pills. */
  size?: ButtonSize;
  /** Trailing arrow (mirrored in RTL). Use for one "go forward" action per view. */
  arrow?: boolean;
  /** Keeps width, shows spinner, blocks clicks, keeps focus. */
  loading?: boolean;
  iconStart?: ReactNode;
  iconEnd?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", arrow = false, loading, iconStart, iconEnd, className, children, onClick, type = "button", disabled, ...rest },
  ref,
) {
  const { t } = useDesignSystem();
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      disabled={disabled}
      aria-disabled={loading || undefined}
      aria-busy={loading || undefined}
      className={cx(buttonClass({ variant, size, arrow }), loading && "ds-loading", className)}
      onClick={(e) => {
        if (loading) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
    >
      {loading ? <Spinner /> : iconStart}
      <span className="ds-btn-label">{children}</span>
      {iconEnd}
      {arrow && !loading ? <ButtonArrow /> : null}
      {loading ? <span className="ds-vh">{t("common.loading")}</span> : null}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  /** Required accessible name. Also shown as a tooltip. */
  label: string;
  /** "outline" is the round, light-bordered button (menu, close in headers). */
  variant?: "quiet" | "secondary" | "primary" | "danger" | "outline";
  children: ReactNode;
  noTooltip?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, variant = "quiet", className, children, noTooltip, type = "button", ...rest },
  ref,
) {
  const btn = (
    <button
      {...rest}
      ref={ref}
      type={type}
      aria-label={label}
      className={cx("ds-btn ds-btn-icon", `ds-btn-${variant}`, className)}
    >
      {children}
    </button>
  );
  return noTooltip ? btn : <Tooltip content={label}>{btn}</Tooltip>;
});

/* ---------- Chip ---------- */
export interface ChipProps {
  children: ReactNode;
  /** Plain name used in the remove button label, e.g. "Medulloblastoma". Defaults to children when it is a string. */
  name?: string;
  onRemove?: () => void;
  tone?: "neutral" | "primary";
  className?: string;
}

export function Chip({ children, name, onRemove, tone = "neutral", className }: ChipProps) {
  const { t } = useDesignSystem();
  const plain = name ?? (typeof children === "string" ? children : "");
  return (
    <span className={cx("ds-chip", tone === "primary" && "ds-chip-primary", className)}>
      <span className="ds-chip-text">{children}</span>
      {onRemove ? (
        <button type="button" className="ds-chip-remove" aria-label={t("filter.remove", { name: plain })} onClick={onRemove}>
          <Icon name="x" size={14} />
        </button>
      ) : null}
    </span>
  );
}

/* ---------- LanguageSwitch ---------- */
export interface LanguageOption {
  locale: Locale;
  /** Endonym: "עברית", "English". This is the accessible name. */
  label: string;
  /** Short visible label, e.g. "EN", "עב". Must be part of the label (WCAG 2.5.3 label in name). */
  short?: string;
  /** When set, renders a link with hreflang (public site). Otherwise a button. */
  href?: string;
}

const DEFAULT_LANGS: LanguageOption[] = [
  { locale: "en", label: "English", short: "EN" },
  { locale: "he", label: "עברית", short: "עב" },
];

export interface LanguageSwitchProps {
  value: Locale;
  onChange?: (locale: Locale) => void;
  options?: LanguageOption[];
  className?: string;
}

export function LanguageSwitch({ value, onChange, options = DEFAULT_LANGS, className }: LanguageSwitchProps) {
  const { t } = useDesignSystem();
  // Links to other pages make a navigation landmark. In-place buttons are a plain group,
  // so two switches on one page do not create two landmarks with the same name.
  const asNav = options.some((o) => o.href);
  const Tag = asNav ? "nav" : "div";
  return (
    <Tag className={cx("ds-segmented ds-langswitch", className)} role={asNav ? undefined : "group"} aria-label={t("lang.label")}>
      {options.map((o) => {
        // Visible short code, full endonym as the accessible name ("EN" is inside "English").
        const text = o.short ? (
          <>
            <span aria-hidden="true">{o.short}</span>
            <span className="ds-vh">{o.label}</span>
          </>
        ) : (
          o.label
        );
        const current = o.locale === value;
        const common = {
          lang: o.locale,
          dir: (o.locale === "he" ? "rtl" : "ltr") as "rtl" | "ltr",
          className: cx("ds-segment", current && "ds-selected"),
          "aria-current": current ? ("true" as const) : undefined,
        };
        return o.href ? (
          <a key={o.locale} {...common} href={o.href} hrefLang={o.locale} onClick={() => onChange?.(o.locale)}>
            {text}
          </a>
        ) : (
          <button key={o.locale} type="button" {...common} aria-pressed={current} onClick={() => onChange?.(o.locale)}>
            {text}
          </button>
        );
      })}
    </Tag>
  );
}

/* ---------- ThemeToggle ---------- */
export interface ThemeToggleProps {
  /** Controlled. If omitted, the component manages theme itself with useTheme(). */
  value?: Theme;
  onChange?: (theme: Theme) => void;
  className?: string;
}

const THEME_ICON = { light: "sun", dark: "moon", system: "globe" } as const;

export function ThemeToggle({ value, onChange, className }: ThemeToggleProps) {
  const { t } = useDesignSystem();
  const [own, setOwn] = useTheme();
  const current = value ?? own;
  const set = (th: Theme) => {
    setOwn(th);
    onChange?.(th);
  };
  return (
    <div role="group" aria-label={t("theme.label")} className={cx("ds-segmented", className)}>
      {(["light", "dark", "system"] as const).map((th) => (
        <button
          key={th}
          type="button"
          className={cx("ds-segment", current === th && "ds-selected")}
          aria-pressed={current === th}
          onClick={() => set(th)}
        >
          <Icon name={THEME_ICON[th]} size={16} /> <span>{t(`theme.${th}` as const)}</span>
        </button>
      ))}
    </div>
  );
}
