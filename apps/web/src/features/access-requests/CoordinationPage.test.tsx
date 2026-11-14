import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { renderWithApp } from "../../test/render";

const CA = "ctr_" + "1".repeat(26);
const CB = "ctr_" + "2".repeat(26);
const S1 = "smp_" + "1".repeat(26);
type Call = { method: string; path: string; body?: unknown };
const st: { request: Record<string, unknown>; links: unknown[]; agreements: unknown[]; samples: unknown[]; perms: Set<string>; centerId: string | null; calls: Call[] } = {
  request: {}, links: [], agreements: [], samples: [], perms: new Set(), centerId: null, calls: [],
};
const ok = (data: unknown) => ({ data, response: { ok: true, status: 200 } });
vi.mock("../../lib/api", () => ({
  api: {
    GET: async (path: string) => {
      if (path === "/requests/{requestId}") return ok(st.request);
      if (path === "/requests/{requestId}/resolved-samples") return ok({ items: st.links });
      if (path === "/requests/{requestId}/agreements") return ok({ items: st.agreements });
      if (path === "/samples") return ok({ items: st.samples, nextCursor: null });
      if (path === "/centers") return ok({ items: [{ id: CA, code: "syn_a", nameEn: "Synthetic Center A", nameHe: "א", isActive: true }, { id: CB, code: "syn_b", nameEn: "Synthetic Center B", nameHe: "ב", isActive: true }] });
      return ok({ items: [] });
    },
    PUT: async (path: string, o: { body?: unknown }) => { st.calls.push({ method: "PUT", path, body: o.body }); return { data: undefined, response: { ok: true, status: 204 } }; },
    PATCH: async (path: string, o: { body?: unknown; params?: { path?: { stepKey?: string } } }) => { st.calls.push({ method: "PATCH", path: path.replace("{stepKey}", o.params?.path?.stepKey ?? ""), body: o.body }); return ok({}); },
    POST: async (path: string, o: { body?: unknown }) => { st.calls.push({ method: "POST", path, body: o.body }); return ok(st.request); },
  },
  setCsrfFallback: vi.fn(),
  onUnauthorized: vi.fn(),
}));
vi.mock("../../app/session", () => ({
  useCan: (p: string) => st.perms.has(p),
  useSession: () => ({ state: { status: "authenticated", roles: [], permissions: st.perms, centerId: st.centerId, session: {} } }),
}));
vi.mock("@ari/api-client", async (orig) => {
  const actual = await orig<typeof import("@ari/api-client")>();
  return { ...actual, unwrap: async (p: Promise<{ data: unknown }>) => (await p).data, unwrapVoid: async (p: Promise<unknown>) => { await p; } };
});
import { CoordinationPage, readyForDelivery } from "./CoordinationPage";

const req = (status: string, steps: unknown[] = []) => ({ id: "req_" + "9".repeat(26), status, closeReason: status === "closed" ? "delivered" : null, createdAt: "2026-11-01T00:00:00Z",
  items: [{ id: "rit_1", criteria: { diagnosis: ["mb_shh"], sampleType: ["ffpe"] }, shownCountBucket: "10_plus" }], steps });
const step = (stepKey: string, centerId: string, status: string, accepted: boolean | null = null) => ({ stepKey, centerId, status, accepted, publicNote: null, startedAt: null, completedAt: null });
const view = () => renderWithApp(<Routes><Route path="/requests/:id/coordination" element={<CoordinationPage />} /></Routes>, { route: `/requests/req_${"9".repeat(26)}/coordination` });

beforeEach(() => { st.calls = []; st.links = []; st.agreements = []; st.samples = []; st.centerId = null; st.perms = new Set(); });

describe("readyForDelivery", () => {
  it("needs a signed agreement for every accepted center", () => {
    const steps = [step("center_coordination", CA, "done", true), step("center_coordination", CB, "done", false)] as never;
    expect(readyForDelivery(steps, [])).toBe(false);
    expect(readyForDelivery(steps, [{ centerId: CA, kind: "mta", docRef: "MTA-1", status: "sent" }])).toBe(false);
    expect(readyForDelivery(steps, [{ centerId: CA, kind: "mta", docRef: "MTA-1", status: "signed", signedMonth: "2026-01" }])).toBe(true);
    expect(readyForDelivery([] as never, [])).toBe(false);
  });
});

describe("CoordinationPage", () => {
  it("coordinator links samples per item and starts coordination", async () => {
    st.perms = new Set(["requests.coordinate", "requests.manage"]);
    st.request = req("approved");
    st.samples = [{ sampleCode: S1, sourceCenterId: CA, sampleType: "ffpe", availability: "available" }];
    view();
    const box = await screen.findByRole("checkbox", { name: new RegExp(S1) });
    expect(screen.getByRole("button", { name: "Start center coordination" })).toBeDisabled();
    fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: "Save links" }));
    await waitFor(() => expect(st.calls).toContainEqual({ method: "PUT", path: "/requests/{requestId}/resolved-samples", body: { itemId: "rit_1", sampleIds: [S1] } }));
  });

  it("coordinator answers on behalf of a center WITH its centerId (the E2E-2 bug)", async () => {
    st.perms = new Set(["requests.coordinate", "requests.manage"]);
    st.request = req("center_coordination", [step("center_coordination", CA, "pending")]);
    view();
    fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
    await waitFor(() => expect(st.calls[0]).toEqual({ method: "PATCH", path: "/requests/{requestId}/steps/center_coordination", body: { centerId: CA, accepted: true } }));
  });

  it("coordinator records an MTA with status and month; delivery stays locked until signed", async () => {
    st.perms = new Set(["requests.coordinate", "requests.manage"]);
    st.request = req("agreements", [step("center_coordination", CA, "done", true)]);
    view();
    expect(await screen.findByRole("button", { name: "Move to delivery" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Agreement reference/), { target: { value: "MTA-2026-001" } });
    fireEvent.change(screen.getByLabelText(/Month signed/), { target: { value: "2026-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Save agreement" }));
    await waitFor(() => expect(st.calls[0]).toEqual({ method: "PATCH", path: "/requests/{requestId}/steps/mta_dta", body: { centerId: CA, agreement: { kind: "mta", docRef: "MTA-2026-001", status: "signed", signedMonth: "2026-01" } } }));
  });

  it("refuses an agreement reference that is not a plain code", async () => {
    st.perms = new Set(["requests.coordinate", "requests.manage"]);
    st.request = req("agreements", [step("center_coordination", CA, "done", true)]);
    view();
    fireEvent.change(await screen.findByLabelText(/Agreement reference/), { target: { value: "a b" } });
    fireEvent.click(screen.getByRole("button", { name: "Save agreement" }));
    expect(await screen.findByText(/Use 3 to 64 letters/)).toBeInTheDocument();
    expect(st.calls).toEqual([]);
  });

  it("clinician marks the own center delivered; the coordinator has no delivery button", async () => {
    st.perms = new Set(["requests.coordinate", "requests.deliver"]); st.centerId = CA;
    st.request = req("delivery", [step("center_coordination", CA, "done", true), step("delivery", CA, "pending")]);
    st.links = [{ itemId: "rit_1", sampleId: S1, centerId: CA }];
    view();
    expect(await screen.findByRole("link", { name: S1 })).toHaveAttribute("href", `/samples/${S1}`);
    fireEvent.click(await screen.findByRole("button", { name: "Mark delivered" }));
    await waitFor(() => expect(st.calls[0]).toMatchObject({ method: "PATCH", path: "/requests/{requestId}/steps/delivery", body: { centerId: CA, status: "done" } }));
  });

  it("coordinator sees delivery read-only", async () => {
    st.perms = new Set(["requests.coordinate", "requests.manage"]);
    st.request = req("delivery", [step("center_coordination", CA, "done", true), step("delivery", CA, "pending")]);
    view();
    expect(await screen.findByText("Only the holding center confirms delivery.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark delivered" })).toBeNull();
  });

  it("closed as delivered says so", async () => {
    st.perms = new Set(["requests.coordinate", "requests.deliver"]); st.centerId = CA;
    st.request = req("closed", [step("center_coordination", CA, "done", true), step("delivery", CA, "done")]);
    view();
    expect(await screen.findByText("Closed – delivered")).toBeInTheDocument();
  });
});
