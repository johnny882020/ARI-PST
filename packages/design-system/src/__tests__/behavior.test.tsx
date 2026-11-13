import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  AggregateCountTile, Button, Checkbox, ConsentBanner, Dialog, FacetFilter, IconButton, Icon, Input, LanguageSwitch,
  Pagination, SessionTimeoutDialog, Stepper, Table, Tabs, ThemeToggle, ToastProvider, useToast, buildRequestSteps,
  REQUEST_STEP_IDS, DesignSystemProvider, Tooltip, Chip, Bdi, StatusPill, Select,
} from "../index";
import { renderIn } from "./helpers";

describe("Button / IconButton", () => {
  it("loading blocks clicks and sets aria-busy", async () => {
    const onClick = vi.fn();
    renderIn(<Button loading onClick={onClick}>Save</Button>);
    const b = screen.getByRole("button");
    await userEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
    expect(b).toHaveAttribute("aria-busy", "true");
  });
  it("IconButton exposes its label as the accessible name", () => {
    renderIn(<IconButton label="Close"><Icon name="x" /></IconButton>);
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });
});

describe("Field wiring", () => {
  it("links label, help and error", () => {
    renderIn(<Input label="Name" help="Helpful" error="Bad" required />);
    const el = screen.getByLabelText(/Name/);
    expect(el).toHaveAttribute("aria-invalid", "true");
    expect(el).toBeRequired();
    expect(el).toHaveAccessibleDescription("Helpful Bad");
  });
  it("Select renders options", () => {
    renderIn(<Select label="C" options={[{ value: "a", label: "A" }]} />);
    expect(screen.getByRole("combobox", { name: "C" })).toBeInTheDocument();
  });
  it("Checkbox toggles", async () => {
    renderIn(<Checkbox label="Agree" />);
    await userEvent.click(screen.getByLabelText("Agree"));
    expect(screen.getByLabelText("Agree")).toBeChecked();
  });
});

describe("Tabs", () => {
  const tabs = [{ id: "a", label: "A", panel: "pa" }, { id: "b", label: "B", panel: "pb" }, { id: "c", label: "C", panel: "pc" }];
  it("ArrowRight moves forward in LTR", async () => {
    renderIn(<Tabs label="x" tabs={tabs} />, "en");
    screen.getByRole("tab", { name: "A" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "B" })).toHaveAttribute("aria-selected", "true");
  });
  it("ArrowLeft moves forward in RTL", async () => {
    renderIn(<Tabs label="x" tabs={tabs} />, "he");
    screen.getByRole("tab", { name: "A" }).focus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "B" })).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "C" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("Dialog", () => {
  function Harness({ dismissible = true }: { dismissible?: boolean }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>open</button>
        <Dialog open={open} onClose={() => setOpen(false)} title="T" dismissible={dismissible} footer={<Button>OK</Button>}>
          body
        </Dialog>
      </>
    );
  }
  it("traps focus, closes on Escape, restores focus", async () => {
    renderIn(<Harness />);
    const opener = screen.getByText("open");
    opener.focus();
    await userEvent.click(opener);
    const dlg = screen.getByRole("dialog", { name: "T" });
    expect(dlg).toHaveAttribute("aria-modal", "true");
    expect(dlg).toContainElement(document.activeElement as HTMLElement);
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    expect(dlg).toContainElement(document.activeElement as HTMLElement);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();
  });
  it("non-dismissible ignores Escape", async () => {
    renderIn(<Harness dismissible={false} />);
    await userEvent.click(screen.getByText("open"));
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
  it("dialog portal keeps lang/dir", async () => {
    renderIn(<Dialog open onClose={() => {}} title="T">x</Dialog>, "he");
    expect(screen.getByRole("dialog").closest("[dir]")).toHaveAttribute("dir", "rtl");
  });
});

describe("SessionTimeoutDialog", () => {
  it("is an alertdialog, focuses extend, does not close on Escape", async () => {
    const onExtend = vi.fn();
    renderIn(<SessionTimeoutDialog open secondsRemaining={120} onExtend={onExtend} onSignOut={() => {}} />);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stay signed in" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Stay signed in" }));
    expect(onExtend).toHaveBeenCalled();
  });
});

describe("Toast", () => {
  function T() {
    const { show } = useToast();
    return <button onClick={() => show({ tone: "danger", title: "Failed" })}>go</button>;
  }
  it("errors use role=alert and persist until dismissed", async () => {
    renderIn(<ToastProvider><T /></ToastProvider>);
    await userEvent.click(screen.getByText("go"));
    const a = screen.getByRole("alert");
    expect(a).toHaveTextContent("Failed");
    await userEvent.click(within(a).getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("Tooltip", () => {
  it("describes the trigger and closes on Escape", async () => {
    renderIn(<Tooltip content="Tip"><button>b</button></Tooltip>);
    const b = screen.getByRole("button");
    expect(b).toHaveAccessibleDescription("Tip");
    await userEvent.tab();
    expect(screen.getByRole("tooltip", { hidden: true })).toHaveAttribute("data-open", "true");
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("tooltip", { hidden: true })).toHaveAttribute("data-open", "false");
  });
});

describe("Table", () => {
  it("sets aria-sort and calls onSortChange", async () => {
    const onSort = vi.fn();
    renderIn(
      <Table caption="C" rowKey={(r: { id: string }) => r.id} rows={[{ id: "1" }]} sort={{ key: "id", direction: "asc" }} onSortChange={onSort}
        columns={[{ key: "id", header: "ID", sortable: true }, { key: "x", header: "X", sortable: true }]} />,
    );
    expect(screen.getByRole("columnheader", { name: /ID/ })).toHaveAttribute("aria-sort", "ascending");
    expect(screen.getByRole("columnheader", { name: /X/ })).toHaveAttribute("aria-sort", "none");
    await userEvent.click(screen.getByRole("button", { name: /ID/ }));
    expect(onSort).toHaveBeenCalledWith("id", "desc");
  });
  it("shows empty and error states", () => {
    const { rerender } = renderIn(<Table caption="C" rowKey={() => "k"} rows={[]} columns={[{ key: "a", header: "A" }]} />);
    expect(screen.getByText("Nothing to show yet")).toBeInTheDocument();
    rerender(<DesignSystemProvider locale="en"><Table caption="C" error rowKey={() => "k"} rows={[]} columns={[{ key: "a", header: "A" }]} /></DesignSystemProvider>);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});

describe("Pagination", () => {
  it("disables unavailable directions", () => {
    renderIn(<Pagination hasPrevious={false} hasNext onPrevious={() => {}} onNext={() => {}} />);
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
  });
});

describe("Stepper (8 steps)", () => {
  it("has 8 request steps with one aria-current", () => {
    expect(REQUEST_STEP_IDS).toHaveLength(8);
    const labels = Object.fromEntries(REQUEST_STEP_IDS.map((i) => [i, i])) as Record<(typeof REQUEST_STEP_IDS)[number], string>;
    const steps = buildRequestSteps({ labels, current: "precheck", status: "waiting-you" });
    renderIn(<Stepper steps={steps} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(8);
    const cur = screen.getAllByRole("listitem").filter((li) => li.getAttribute("aria-current") === "step");
    expect(cur).toHaveLength(1);
    expect(cur[0]).toHaveTextContent("precheck");
    expect(steps.slice(0, 2).every((s) => s.status === "done")).toBe(true);
    expect(steps.slice(3).every((s) => s.status === "upcoming")).toBe(true);
  });
});

describe("AggregateCountTile: suppression", () => {
  it("never prints a number or threshold when suppressed, even if a value is passed", () => {
    const { container } = renderIn(<AggregateCountTile label="Samples" state="suppressed" value={3} />);
    expect(container.textContent).toContain("Too few to show");
    expect(container.textContent).not.toMatch(/\d/);
    expect(container.textContent).not.toMatch(/[<≤]/);
    expect(screen.getByText("Count not shown, to protect privacy")).toBeInTheDocument();
  });
  it("treats a missing value as suppressed, never zero", () => {
    const { container } = renderIn(<AggregateCountTile label="S" state="value" value={null} />);
    expect(container.textContent).toContain("Too few to show");
    expect(container.textContent).not.toMatch(/\d/);
  });
  it("shows value, merged chip, loading and error", () => {
    const { container } = renderIn(
      <>
        <AggregateCountTile label="A" state="value" value={1280} />
        <AggregateCountTile label="B" state="merged" value={40} />
        <AggregateCountTile label="C" state="loading" />
        <AggregateCountTile label="D" state="error" />
      </>,
    );
    expect(container.textContent).toContain("1,280");
    expect(container.textContent).toContain("Includes related categories");
    expect(screen.getByText("Loading count")).toBeInTheDocument();
    expect(container.textContent).toContain("Could not load");
  });
  it("Hebrew text", () => {
    renderIn(<AggregateCountTile label="דגימות" state="suppressed" />, "he");
    expect(screen.getByText("מעט מדי להצגה")).toBeInTheDocument();
  });
  it("suppressed tile does not use danger tone", () => {
    const { container } = renderIn(<AggregateCountTile label="S" state="suppressed" />);
    expect(container.innerHTML).not.toMatch(/danger|warning/);
  });
});

describe("FacetFilter", () => {
  it("shows a dash for suppressed counts, never a number", async () => {
    const onChange = vi.fn();
    renderIn(<FacetFilter legend="Type" selected={[]} onChange={onChange} options={[{ value: "a", label: "A", count: 12 }, { value: "b", label: "B", count: null }]} />);
    const b = screen.getByRole("checkbox", { name: /B/ });
    expect(b.closest("label")).toHaveTextContent("—");
    expect(b.closest("label")).not.toHaveTextContent(/\d/);
    await userEvent.click(screen.getByRole("checkbox", { name: /A/ }));
    expect(onChange).toHaveBeenCalledWith(["a"]);
  });
  it("collapsible toggles aria-expanded", async () => {
    renderIn(<FacetFilter legend="Type" collapsible defaultExpanded={false} selected={[]} onChange={() => {}} options={[]} />);
    const t = screen.getByRole("button", { name: "Type" });
    expect(t).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(t);
    expect(t).toHaveAttribute("aria-expanded", "true");
  });
});

describe("ConsentBanner", () => {
  it("offers equal-weight accept and decline", async () => {
    const a = vi.fn(), d = vi.fn();
    renderIn(<ConsentBanner open onAccept={a} onDecline={d} />);
    const acc = screen.getByRole("button", { name: "Accept" });
    const dec = screen.getByRole("button", { name: "Decline" });
    expect(acc.className).toBe(dec.className);
    await userEvent.click(dec);
    expect(d).toHaveBeenCalled();
  });
});

describe("LanguageSwitch / ThemeToggle / bidi", () => {
  it("marks lang and current", async () => {
    const onChange = vi.fn();
    renderIn(<LanguageSwitch value="he" onChange={onChange} />);
    expect(screen.getByRole("button", { name: "עברית" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "English" })).toHaveAttribute("lang", "en");
    await userEvent.click(screen.getByRole("button", { name: "English" }));
    expect(onChange).toHaveBeenCalledWith("en");
  });
  it("ThemeToggle sets data-theme and tolerates storage failure", async () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    renderIn(<ThemeToggle />);
    await userEvent.click(screen.getByRole("button", { name: /Dark/ }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    await userEvent.click(screen.getByRole("button", { name: /System/ }));
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    spy.mockRestore();
  });
  it("Bdi defaults to dir=auto; provider sets dir", () => {
    const { container } = renderIn(<Bdi>FFPE</Bdi>, "he");
    expect(container.querySelector("bdi")).toHaveAttribute("dir", "auto");
    expect(container.querySelector(".ds-root")).toHaveAttribute("dir", "rtl");
  });
  it("Chip remove label", () => {
    renderIn(<Chip onRemove={() => {}}>Medulloblastoma</Chip>);
    expect(screen.getByRole("button", { name: "Remove filter Medulloblastoma" })).toBeInTheDocument();
  });
  it("StatusPill always has text", () => {
    renderIn(<StatusPill status="rejected" />);
    expect(screen.getByText("Not approved")).toBeInTheDocument();
  });
});
void fireEvent; void render;
