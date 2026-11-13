import { describe, expect, it } from "vitest";
import { homeFor, permissionsFor, ROLE_PERMISSIONS } from "./permissions";
import { canOpen, ROUTES } from "../routes/route-table";
import type { Role } from "@ari/api-client";

const ROLES = Object.keys(ROLE_PERMISSIONS) as Role[];
const route = (id: string) => ROUTES.find((r) => r.id === id)!;

describe("separation of duties in the client capability table", () => {
  it("system_admin cannot read samples, search, vote or approve", () => {
    const p = permissionsFor(["system_admin"]);
    for (const x of ["samples.read", "search.aggregate", "requests.vote", "requests.queue.precheck", "search.records"] as const) expect(p.has(x)).toBe(false);
  });
  it("committee_member cannot edit the index or import", () => {
    const p = permissionsFor(["committee_member"]);
    expect(p.has("samples.write")).toBe(false);
    expect(p.has("import.run")).toBe(false);
  });
  it("researcher_intl is aggregate only: no cart, no requests", () => {
    const p = permissionsFor(["researcher_intl"]);
    expect(p.has("search.aggregate")).toBe(true);
    expect(p.has("cart.use")).toBe(false);
    expect(p.has("requests.own")).toBe(false);
  });
});

describe("route table", () => {
  it("has unique ids and paths", () => {
    expect(new Set(ROUTES.map((r) => r.id)).size).toBe(ROUTES.length);
    expect(new Set(ROUTES.map((r) => r.path)).size).toBe(ROUTES.length);
  });
  it("matches the plan matrix for key routes", () => {
    const matrix: Record<string, Role[]> = {
      cart: ["researcher_il"],
      "samples-new": ["national_coordinator"],
      import: ["national_coordinator"],
      audit: ["system_admin"],
      committee: ["committee_member"],
      decision: ["committee_member"],
      precheck: ["national_coordinator"],
      users: ["system_admin"],
      "privacy-settings": ["system_admin"],
    };
    for (const [id, allowed] of Object.entries(matrix)) {
      for (const r of ROLES) expect(canOpen(route(id), [r]), `${id} for ${r}`).toBe(allowed.includes(r));
    }
  });
  it("search is closed to system_admin", () => expect(canOpen(route("search"), ["system_admin"])).toBe(false));
  it("clinician can open samples but not write", () => {
    expect(canOpen(route("samples"), ["center_clinician"])).toBe(true);
    expect(canOpen(route("samples-new"), ["center_clinician"])).toBe(false);
  });
  it("every role has a home that it may open (or an any-role page)", () => {
    for (const r of ROLES) {
      const home = homeFor([r]);
      const def = ROUTES.find((x) => x.path === home)!;
      expect(def, `${r} -> ${home}`).toBeTruthy();
      expect(canOpen(def, [r])).toBe(true);
    }
  });
});
