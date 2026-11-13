import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import "../src/styles/index.css";
import {
  AggregateCountTile, Alert, AppShell, Badge, Bdi, Button, Card, Checkbox, Chip, ConsentBanner, Dialog, EmptyState,
  ErrorState, FacetFilter, Field, Icon, IconButton, Input, LanguageSwitch, Ltr, Pagination, RadioGroup, SearchBox, Select,
  SessionTimeoutDialog, Skeleton, StatusPill, Stepper, SuppressionNotice, Switch, Table, Tabs, Textarea, ThemeToggle,
  ToastProvider, Tooltip, useRequestSteps, useToast, DesignSystemProvider, type Locale, type StatusKind,
} from "../src/index";

const rows = [
  { id: "1", code: "smp_01HZX3", type: "FFPE", n: 128 },
  { id: "2", code: "smp_01HZX4", type: "CSF", n: 42 },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBlock: "2rem" }}>
      <h2 style={{ fontFamily: "var(--font-display)" }}>{title}</h2>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "flex-start" }}>{children}</div>
    </section>
  );
}

function ToastDemo() {
  const { show } = useToast();
  return <Button onClick={() => show({ tone: "success", title: "Saved" })}>Show toast</Button>;
}

function Steps({ status }: { status?: StatusKind }) {
  return <Stepper steps={useRequestSteps({ current: "committee", status, dates: { cart: "2026-09-01", submission: "2026-09-02" } })} />;
}

function Gallery({ locale }: { locale: Locale }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string[]>(["ffpe"]);
  const [dlg, setDlg] = useState(false);
  const [sess, setSess] = useState(false);
  const [consent, setConsent] = useState(true);
  const [sort, setSort] = useState<{ key: string; direction: "asc" | "desc" }>({ key: "code", direction: "asc" });
  const [radio, setRadio] = useState("a");
  return (
    <>
      <Section title="Buttons">
        <Button variant="primary">Primary</Button>
        <Button>Secondary</Button>
        <Button variant="quiet">Quiet</Button>
        <Button variant="danger">Danger</Button>
        <Button loading>Loading</Button>
        <Button disabled>Disabled</Button>
        <IconButton label="Search"><Icon name="search" /></IconButton>
        <Chip onRemove={() => {}}>Medulloblastoma</Chip>
        <Badge tone="success">Badge</Badge>
        <ToastDemo />
        <Tooltip content="Tooltip text"><Button variant="quiet">Hover or focus</Button></Tooltip>
      </Section>
      <Section title="Forms">
        <div style={{ inlineSize: "20rem", display: "grid", gap: "1rem" }}>
          <Input label="Name" help="Help text" required />
          <Input label="With error" error="Please fill in this field" defaultValue="x" />
          <Input label="Sample code" dir="ltr" defaultValue="smp_01HZX3" readOnly />
          <Textarea label="Notes" showCount maxLength={200} />
          <Select label="Center" placeholder="Choose" options={[{ value: "a", label: "Synthetic Center A" }, { value: "b", label: "Synthetic Center B" }]} />
          <Field label="Custom control">{(p) => <input className="ds-control" {...p} />}</Field>
          <Checkbox label="Checkbox" />
          <Checkbox label="Indeterminate" indeterminate />
          <Switch label="Switch" />
          <RadioGroup legend="Radio group" name="r" value={radio} onChange={setRadio} options={[{ value: "a", label: "A" }, { value: "b", label: "B", help: "With help" }]} />
          <SearchBox label="Search" value={q} onChange={setQ} resultCount={q ? 12 : null} placeholder="Try a diagnosis" />
          <FacetFilter legend="Sample type" selected={sel} onChange={setSel} options={[{ value: "ffpe", label: <Bdi>FFPE</Bdi>, count: 128 }, { value: "csf", label: <Bdi>CSF</Bdi>, count: null }]} />
        </div>
      </Section>
      <Section title="Aggregate counts">
        <AggregateCountTile label="Samples" state="value" value={128} unit="samples" />
        <AggregateCountTile label="Samples" state="suppressed" />
        <AggregateCountTile label="Samples" state="merged" value={40} />
        <AggregateCountTile label="Samples" state="loading" />
        <AggregateCountTile label="Samples" state="error" onRetry={() => {}} />
        <AggregateCountTile label="Samples" state="value" value={1280} coordinatorView />
        <SuppressionNotice />
      </Section>
      <Section title="Status, alerts, states">
        {(["done", "current", "waiting-you", "waiting-others", "returned", "rejected", "upcoming"] as StatusKind[]).map((s) => <StatusPill key={s} status={s} />)}
        <div style={{ inlineSize: "100%", display: "grid", gap: "0.5rem" }}>
          <Alert tone="info" title="Info">Plain message.</Alert>
          <Alert tone="success" title="Success">Saved.</Alert>
          <Alert tone="warning" title="Warning">Check this.</Alert>
          <Alert tone="danger" title="Error" onDismiss={() => {}}>Could not save. Your work is kept.</Alert>
        </div>
        <Card heading="Card" footer={<Button size="sm">Action</Button>}>Card body with <Bdi>Medulloblastoma</Bdi> and <Ltr>2026-09</Ltr>.</Card>
        <EmptyState title="No samples match these filters" action={<Button>Clear filters</Button>}>Try removing one filter.</EmptyState>
        <ErrorState traceId="trc_01HZX3ABC" onRetry={() => {}} />
        <div style={{ inlineSize: "16rem" }}><Skeleton /></div>
      </Section>
      <Section title="Tabs, table, pagination, stepper">
        <div style={{ inlineSize: "100%" }}>
          <Tabs label="Demo" tabs={[{ id: "a", label: "Overview", panel: "Overview panel" }, { id: "b", label: "Details", panel: "Details panel" }]} />
        </div>
        <div style={{ inlineSize: "100%" }}>
          <Table
            caption="Samples (synthetic)"
            rows={[...rows].sort((a, b) => (sort.direction === "asc" ? 1 : -1) * String((a as Record<string, unknown>)[sort.key]).localeCompare(String((b as Record<string, unknown>)[sort.key])))}
            rowKey={(r) => r.id}
            sort={sort}
            onSortChange={(key, direction) => setSort({ key, direction })}
            columns={[
              { key: "code", header: "Code", sortable: true, render: (r) => <Ltr>{r.code}</Ltr> },
              { key: "type", header: "Type", sortable: true },
              { key: "n", header: "Count", numeric: true, sortable: true },
            ]}
          />
        </div>
        <Pagination hasPrevious={false} hasNext onPrevious={() => {}} onNext={() => {}} status="1–20" />
        <Steps />
        <Steps status="waiting-you" />
      </Section>
      <Section title="Overlays">
        <Button onClick={() => setDlg(true)}>Open dialog</Button>
        <Button onClick={() => setSess(true)}>Session timeout</Button>
        <Button onClick={() => setConsent(true)}>Show consent banner</Button>
        <Dialog open={dlg} onClose={() => setDlg(false)} title={locale === "he" ? "כותרת" : "Dialog title"} footer={<Button variant="primary" onClick={() => setDlg(false)}>OK</Button>}>
          Dialog body.
        </Dialog>
        <SessionTimeoutDialog open={sess} secondsRemaining={95} onExtend={() => setSess(false)} onSignOut={() => setSess(false)} />
        <ConsentBanner open={consent} onAccept={() => setConsent(false)} onDecline={() => setConsent(false)} learnMoreHref="#privacy" />
      </Section>
    </>
  );
}

function App() {
  const [locale, setLocale] = useState<Locale>("he");
  return (
    <DesignSystemProvider locale={locale} syncDocument>
      <ToastProvider>
        <AppShell
          brand="ARI-PST × Tech4Cancer"
          nav={[{ id: "g", label: locale === "he" ? "גלריה" : "Gallery", href: "#", current: true, icon: "filter" }, { id: "s", label: locale === "he" ? "חיפוש" : "Search", href: "#s", icon: "search" }]}
          headerActions={<><LanguageSwitch value={locale} onChange={setLocale} /><ThemeToggle /></>}
          footer="Synthetic data only"
        >
          <h1 style={{ fontFamily: "var(--font-display)" }}>{locale === "he" ? "גלריית רכיבים" : "Component gallery"}</h1>
          <Gallery locale={locale} />
        </AppShell>
      </ToastProvider>
    </DesignSystemProvider>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
