import { Link, useLocation } from "react-router-dom";
import { Alert } from "@ari/design-system";
import { useT } from "../../app/locale";
import { PageHeading } from "../../shared/page";
import { safeNext } from "../../lib/safe-path";

export function SessionEndedPage() {
  const t = useT();
  const { state } = useLocation() as { state: { next?: string } | null };
  const next = safeNext(state?.next, "");
  return (
    <>
      <PageHeading titleKey="auth.sessionEnded.title" />
      <Alert tone="info">{t("error.session.body")}</Alert>
      <p>{t("auth.sessionEnded.draftNote")}</p>
      <p>
        <Link className="ds-btn ds-btn-primary" to={next ? `/login?next=${encodeURIComponent(next)}` : "/login"}>
          <span className="ds-btn-label">{t("auth.sessionEnded.signIn")}</span>
        </Link>
      </p>
    </>
  );
}
