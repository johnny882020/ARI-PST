import { cloneElement, useEffect, useId, useState, type ReactElement, type ReactNode } from "react";
import { cx } from "../core";

export interface TooltipProps {
  content: ReactNode;
  /** One focusable element. Tooltip text is added as its description. Never the only source of information. */
  children: ReactElement<{ "aria-describedby"?: string }>;
  className?: string;
}

export function Tooltip({ content, children, className }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  const existing = children.props["aria-describedby"];
  return (
    <span
      className={cx("ds-tooltip-host", className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {cloneElement(children, { "aria-describedby": [existing, id].filter(Boolean).join(" ") })}
      <span role="tooltip" id={id} className="ds-tooltip" data-open={open ? "true" : "false"}>
        {content}
      </span>
    </span>
  );
}
