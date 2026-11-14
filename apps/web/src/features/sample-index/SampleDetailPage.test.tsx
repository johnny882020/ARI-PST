import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { renderWithApp } from "../../test/render";

vi.mock("../../lib/api", () => ({
  api: {
    GET: async (path: string) => path === "/samples/{sampleId}"
      ? { data: undefined, error: { type: "about:blank", title: "Not found", status: 404, code: "NOT_FOUND" }, response: new Response(null, { status: 404 }) }
      : { data: { items: [] }, response: { ok: true, status: 200 } },
  },
  setCsrfFallback: vi.fn(),
  onUnauthorized: vi.fn(),
}));
vi.mock("../../app/session", () => ({ useCan: () => true, useSession: () => ({ state: { status: "authenticated", roles: ["center_clinician"], permissions: new Set(), centerId: null, session: {} } }) }));
import { LocalSystemCard, SampleDetailPage } from "./SampleDetailPage";

const CODE = "smp_" + "2".repeat(26);
describe("SampleDetailPage", () => {
  it("another center's record: clear 'Not available' page, not a generic error", async () => {
    renderWithApp(<Routes><Route path="/samples/:id" element={<SampleDetailPage />} /></Routes>, { route: `/samples/${CODE}` });
    expect(await screen.findByRole("heading", { level: 1, name: "Not available" })).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).toBeNull();
    expect(document.title).toContain("Not available");
  });
  it("link-out opens the configured center system in a new tab with rel=noopener", () => {
    renderWithApp(<LocalSystemCard sampleCode={CODE} centerCode="syn_a" template="https://records.center.example/lookup?code={sampleCode}" />);
    const a = screen.getByRole("link", { name: /Open in the center's system/ });
    expect(a).toHaveAttribute("href", `https://records.center.example/lookup?code=${CODE}`);
    expect(a).toHaveAttribute("target", "_blank");
    expect(a.getAttribute("rel")).toContain("noopener");
  });
  it("without a template it shows a labelled reference and no link", () => {
    renderWithApp(<LocalSystemCard sampleCode={CODE} centerCode="syn_a" template={undefined} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(/No link to the center system is set up/)).toBeInTheDocument();
    expect(screen.getByText(CODE)).toBeInTheDocument();
  });
});
