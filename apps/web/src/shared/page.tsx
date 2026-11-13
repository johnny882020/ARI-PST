import { useEffect, useRef, type ReactNode } from "react";
import { useT } from "../app/locale";
import type { MessageKey } from "@ari/i18n";

/** Every route: sets document.title and moves focus to the single h1 (SPA a11y). */
export function PageHeading({ titleKey, lead, actions }: { titleKey: MessageKey; lead?: ReactNode; actions?: ReactNode }) {
  const t = useT();
  const ref = useRef<HTMLHeadingElement>(null);
  const title = t(titleKey);
  useEffect(() => {
    document.title = `${title} · ARI-PST`;
    ref.current?.focus({ preventScroll: false });
  }, [title]);
  return (
    <header className="page-head">
      <div>
        <h1 ref={ref} tabIndex={-1} className="page-title">
          {title}
        </h1>
        {lead ? <p className="page-lead">{lead}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}
