import { Badge, Table, type TableColumn } from "@ari/design-system";
import type { Center } from "@ari/api-client";
import { useT } from "../../app/locale";
import { PageHeading } from "../../shared/page";
import { ErrorPanel } from "../../shared/errors";
import { useCenters } from "../../shared/enums";

export function CentersPage() {
  const t = useT();
  const { centers, label, query } = useCenters();
  const cols: TableColumn<Center>[] = [
    { key: "name", header: t("admin.centers.col.name"), render: (c) => label(c.id) },
    { key: "code", header: t("admin.centers.col.code"), render: (c) => <bdi dir="ltr">{c.code}</bdi> },
    { key: "contact", header: t("samples.field.contact"), render: (c) => c.contactRole },
    { key: "feeds", header: t("admin.centers.col.feeds"), render: (c) => <Badge tone={c.feedsRegularly ? "success" : "neutral"}>{t(c.feedsRegularly ? "common.yes" : "common.no")}</Badge> },
  ];
  return (
    <div className="stack">
      <PageHeading titleKey="admin.centers.title" />
      <Table caption={t("admin.centers.caption")} columns={cols} rows={centers} rowKey={(c) => c.id} loading={query.isPending} error={query.isError ? <ErrorPanel error={query.error} /> : undefined} empty={t("table.empty.title")} />
    </div>
  );
}
