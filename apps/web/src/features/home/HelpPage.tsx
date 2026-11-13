import { Card, SuppressionNotice } from "@ari/design-system";
import { useT } from "../../app/locale";
import { PageHeading } from "../../shared/page";

export function HelpPage() {
  const t = useT();
  return (
    <div className="stack narrow">
      <PageHeading titleKey="help.title" />
      <Card heading={t("help.privacy.title")} headingLevel={2}>
        <p>{t("privacy.notice.short")}</p>
        <p>{t("help.privacy.neverStored")}</p>
      </Card>
      <Card heading={t("counts.suppressed.why.title")} headingLevel={2}>
        <SuppressionNotice />
        <p>{t("counts.merged.body")}</p>
      </Card>
    </div>
  );
}
