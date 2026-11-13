import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithApp } from "../../test/render";

const state: { aggregate: unknown } = { aggregate: null };
vi.mock("../../lib/api", () => ({
  api: {
    GET: async (path: string) => ({ data: path === "/centers" ? { items: [] } : path === "/diagnoses" ? { items: [] } : { items: [] }, response: { ok: true, status: 200 } }),
    POST: async (path: string) =>
      path === "/search/aggregate"
        ? { data: state.aggregate, response: { ok: true, status: 200 } }
        : { data: { k: 5, facets: { diagnosis: [{ bucket: "typ_a", level: "value", count: null, suppressed: true }, { bucket: "other", level: "group_other", count: 9, suppressed: false }] } }, response: { ok: true, status: 200 } },
  },
  setCsrfFallback: vi.fn(),
  onUnauthorized: vi.fn(),
}));
vi.mock("../../app/session", () => ({ useCan: (p: string) => p === "cart.use", useSession: () => ({ state: { status: "authenticated", roles: ["researcher_il"], permissions: new Set(), centerId: null, session: {} } }) }));
vi.mock("@ari/api-client", async (orig) => {
  const actual = await orig<typeof import("@ari/api-client")>();
  return { ...actual, unwrap: async (p: Promise<{ data: unknown }>) => (await p).data };
});
import { SearchPage } from "./SearchPage";

describe("SearchPage suppression", () => {
  beforeEach(() => { state.aggregate = { suppressed: true, count: null, label: "<5", k: 5 }; });

  it("shows 'Too few to show', never the threshold, and disables add-to-cart", async () => {
    renderWithApp(<SearchPage />, { route: "/search?type=csf" });
    expect((await screen.findAllByText("Too few to show")).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/<\s*5|<5|\bk\s*=\s*5/);
    expect(screen.getByRole("button", { name: "Add to request cart" })).toBeDisabled();
  });

  it("labels merged buckets as grouped and never plots them as zero", async () => {
    renderWithApp(<SearchPage />, { route: "/search" });
    expect(await screen.findByText(/Other \(grouped\)/)).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});
