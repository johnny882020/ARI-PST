import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../core";

/* ---------- Logo ----------
   Mark: thin light-grey ring, three concentric navy arcs (a rising sun), a small gold dot on top.
   Colours come from tokens through CSS classes, so the mark follows light, dark and forced-colors themes.
   The lock-up never flips in RTL: the wordmark is Latin and stays after the mark. */
export interface LogoMarkProps {
  /** Pixel size of the square mark. */
  size?: number;
  className?: string;
}

export function LogoMark({ size = 40, className }: LogoMarkProps) {
  return (
    <svg
      className={cx("ds-logo-mark", className)}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
    >
      <circle className="ds-logo-ring" cx="24" cy="24" r="22.75" fill="none" strokeWidth="1.5" />
      <g className="ds-logo-arcs" fill="none" strokeWidth="2.1" strokeLinecap="round">
        <path d="M5.8 31.1A19.1 19.1 0 0 1 42.2 31.1" />
        <path className="ds-logo-arc-mid" d="M12 34.3A12.8 12.8 0 0 1 36 34.3" />
        <path d="M18.6 37.6A6 6 0 0 1 29.4 37.6" />
      </g>
      <circle className="ds-logo-dot" cx="24" cy="16.6" r="3.1" />
    </svg>
  );
}

export interface LogoProps {
  /** Mark size in px. Wordmark size comes from CSS (.ds-logo-sm / default / .ds-logo-lg). */
  size?: number;
  /** Show the "ARI-PST" wordmark next to the mark (default true). */
  wordmark?: boolean;
  /** Add the "× Tech4Cancer" partner line under the wordmark (footer, about). */
  partner?: boolean;
  className?: string;
}

/** Brand lock-up. The visible wordmark is the accessible name; the mark is decorative. */
export function Logo({ size = 40, wordmark = true, partner = false, className }: LogoProps) {
  return (
    <span className={cx("ds-logo", className)} dir="ltr" lang="en">
      <LogoMark size={size} />
      {wordmark ? (
        <span className="ds-logo-text">
          <span className="ds-wordmark">ARI-PST</span>
          {partner ? <span className="ds-logo-partner">× Tech4Cancer</span> : null}
        </span>
      ) : (
        <span className="ds-vh">ARI-PST</span>
      )}
    </span>
  );
}

/* ---------- Eyebrow ---------- */
export interface EyebrowProps extends HTMLAttributes<HTMLElement> {
  as?: "p" | "span" | "div";
  /** Gold dot before the text (default true). */
  dot?: boolean;
  children: ReactNode;
}

/** Small, wide-tracked caps line above a heading. Hebrew gets no tracking and no caps (tokens handle it). */
export function Eyebrow({ as: Tag = "p", dot = true, className, children, ...rest }: EyebrowProps) {
  return (
    <Tag {...rest} className={cx("ds-eyebrow", className)}>
      {dot ? <span className="ds-eyebrow-dot" aria-hidden="true" /> : null}
      <span>{children}</span>
    </Tag>
  );
}

/* ---------- DisplayHeading ---------- */
export interface DisplayHeadingProps extends HTMLAttributes<HTMLHeadingElement> {
  level?: 1 | 2 | 3;
  /** "display" is the hero size; "title" is a page title in the app. */
  size?: "display" | "title";
  children: ReactNode;
}

export function DisplayHeading({ level = 1, size = "display", className, children, ...rest }: DisplayHeadingProps) {
  const Tag = `h${level}` as "h1" | "h2" | "h3";
  return (
    <Tag {...rest} className={cx("ds-display", size === "title" && "ds-display-title", className)}>
      {children}
    </Tag>
  );
}
