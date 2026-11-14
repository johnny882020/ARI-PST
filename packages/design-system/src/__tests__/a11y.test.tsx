import { useState, type ReactElement } from "react";
import { describe, expect, it } from "vitest";
import {
  Alert, AggregateCountTile, AppShell, Badge, Button, Card, Checkbox, Chip, ConsentBanner, Dialog, EmptyState,
  ErrorState, FacetFilter, Field, IconButton, Icon, Input, LanguageSwitch, Pagination, Radio, RadioGroup,
  SearchBox, Select, SessionTimeoutDialog, Skeleton, StatusPill, Stepper, Switch, Table, Tabs, Textarea,
  ThemeToggle, ToastProvider, Tooltip, SuppressionNotice, SuppressedCell, Bdi, Ltr, useRequestSteps,
  Logo, Eyebrow, DisplayHeading, buttonClass, ButtonArrow,
} from "../index";
import { axe, LOCALES, renderIn } from "./helpers";

function Steps() {
  return <Stepper steps={useRequestSteps({ current: "committee", dates: { cart: "2026-09-01" } })} />;
}
function Controlled() {
  const [v, setV] = useState("");
  return <SearchBox label="Search" value={v} onChange={setV} resultCount={12} />;
}

const rows = [
  { id: "1", code: "smp_A", n: 12 },
  { id: "2", code: "smp_B", n: 7 },
];

const FIXTURES: Record<string, () => ReactElement> = {
  Button: () => (
    <div>
      <Button variant="primary">Send</Button>
      <Button loading>Saving</Button>
      <Button disabled>Off</Button>
      <Button variant="danger">Delete</Button>
      <Button variant="quiet">Quiet</Button>
    </div>
  ),
  IconButton: () => (
    <IconButton label="Search">
      <Icon name="search" />
    </IconButton>
  ),
  Input: () => <Input label="Name" help="Help" error="Required" required />,
  Textarea: () => <Textarea label="Notes" showCount maxLength={100} />,
  Select: () => <Select label="Center" placeholder="Choose" options={[{ value: "a", label: "Synthetic Center A" }]} />,
  Field: () => (
    <Field label="Code" help="h">
      {(p) => <input {...p} />}
    </Field>
  ),
  Checkbox: () => <Checkbox label="Agree" help="h" />,
  Radio: () => (
    <RadioGroup legend="Type" name="t" value="a" onChange={() => {}} options={[{ value: "a", label: "A" }, { value: "b", label: "B" }]} />
  ),
  Switch: () => <Switch label="Reduce motion" />,
  Card: () => <Card heading="Title">Body</Card>,
  Badge: () => <Badge tone="success">ok</Badge>,
  StatusPill: () => (
    <div>
      <StatusPill status="done" />
      <StatusPill status="waiting-you" />
      <StatusPill status="rejected" />
    </div>
  ),
  Tabs: () => <Tabs label="Sections" tabs={[{ id: "a", label: "A", panel: "pa" }, { id: "b", label: "B", panel: "pb" }]} />,
  Dialog: () => (
    <Dialog open onClose={() => {}} title="Title" footer={<Button>OK</Button>}>
      Body
    </Dialog>
  ),
  SessionTimeoutDialog: () => <SessionTimeoutDialog open secondsRemaining={95} onExtend={() => {}} onSignOut={() => {}} />,
  Toast: () => <ToastProvider>x</ToastProvider>,
  Tooltip: () => (
    <Tooltip content="Tip">
      <button type="button">Hover</button>
    </Tooltip>
  ),
  Table: () => (
    <Table
      caption="Samples"
      rows={rows}
      rowKey={(r) => r.id}
      sort={{ key: "code", direction: "asc" }}
      columns={[
        { key: "code", header: "Code", sortable: true },
        { key: "n", header: "Count", numeric: true, sortable: true },
      ]}
    />
  ),
  TableEmpty: () => <Table caption="C" rows={[]} rowKey={() => "x"} columns={[{ key: "a", header: "A" }]} />,
  TableLoading: () => <Table caption="C" rows={[]} loading rowKey={() => "x"} columns={[{ key: "a", header: "A" }]} />,
  Pagination: () => <Pagination hasPrevious={false} hasNext onPrevious={() => {}} onNext={() => {}} status="1-20" />,
  Stepper: () => <Steps />,
  EmptyState: () => <EmptyState title="Empty" action={<Button>Go</Button>}>Body</EmptyState>,
  ErrorState: () => <ErrorState traceId="trc_01H" onRetry={() => {}} />,
  Skeleton: () => <Skeleton />,
  AppShell: () => (
    <AppShell brand="ARI-PST" nav={[{ id: "a", label: "Home", href: "/", current: true }, { id: "b", label: "Search", href: "/s" }]} footer="f">
      <h1>Page</h1>
    </AppShell>
  ),
  LanguageSwitch: () => <LanguageSwitch value="he" />,
  LanguageSwitchLinks: () => <LanguageSwitch value="en" options={[{ locale: "en", label: "English", short: "EN", href: "/en/" }, { locale: "he", label: "עברית", short: "עב", href: "/he/" }]} />,
  Brand: () => (
    <div>
      <a href="/"><Logo /></a>
      <Logo partner />
      <Eyebrow>A national initiative · Paediatric oncology</Eyebrow>
      <DisplayHeading>Advancing research.</DisplayHeading>
      <a className={buttonClass({ variant: "primary", size: "lg", arrow: true })} href="/portal"><span className="ds-btn-label">Enter</span><ButtonArrow /></a>
      <Button arrow variant="primary">Next</Button>
      <IconButton label="Menu" variant="outline"><Icon name="menu" /></IconButton>
    </div>
  ),
  ThemeToggle: () => <ThemeToggle value="system" onChange={() => {}} />,
  AggregateCountTile: () => (
    <div>
      <AggregateCountTile label="Samples" state="value" value={128} unit="samples" coordinatorView />
      <AggregateCountTile label="Samples" state="suppressed" />
      <AggregateCountTile label="Samples" state="merged" value={40} />
      <AggregateCountTile label="Samples" state="loading" />
      <AggregateCountTile label="Samples" state="error" onRetry={() => {}} />
      <SuppressionNotice />
      <SuppressedCell />
    </div>
  ),
  FacetFilter: () => (
    <FacetFilter
      legend="Sample type"
      selected={["ffpe"]}
      onChange={() => {}}
      options={[{ value: "ffpe", label: "FFPE", count: 12 }, { value: "csf", label: "CSF", count: null }]}
    />
  ),
  FacetFilterCollapsible: () => (
    <FacetFilter legend="Center" collapsible selected={[]} onChange={() => {}} options={[{ value: "a", label: "A", count: 3 }]} />
  ),
  SearchBox: () => <Controlled />,
  ConsentBanner: () => <ConsentBanner open onAccept={() => {}} onDecline={() => {}} learnMoreHref="/privacy" />,
  Alert: () => (
    <div>
      <Alert tone="info" title="Info">x</Alert>
      <Alert tone="danger" title="Err" onDismiss={() => {}}>x</Alert>
    </div>
  ),
  Chip: () => <Chip onRemove={() => {}}>Medulloblastoma</Chip>,
  Bidi: () => (
    <p>
      <Bdi>FFPE</Bdi> <Ltr>2026-09</Ltr>
    </p>
  ),
};

describe("axe: no violations, he (RTL) and en (LTR)", () => {
  for (const [name, make] of Object.entries(FIXTURES)) {
    for (const locale of LOCALES) {
      it(`${name} [${locale}]`, async () => {
        const { baseElement } = renderIn(make(), locale);
        expect(await axe(baseElement)).toHaveNoViolations();
      });
    }
  }
});
