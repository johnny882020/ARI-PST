import { describe, expect, it } from "vitest";
import { filtersFromParams, filtersToParams, countActive } from "./filters";

describe("search filters url", () => {
  it("round-trips enum codes", () => {
    const f = { sampleType: ["ffpe", "csf"], ageBand: ["0_lt1"] } as const;
    const p = filtersToParams(f as never);
    expect(p.toString()).toBe("type=ffpe%2Ccsf&age=0_lt1");
    expect(filtersFromParams(p)).toEqual(f);
    expect(countActive(filtersFromParams(p))).toBe(3);
  });
  it("drops values that are not enum-like", () => {
    const p = new URLSearchParams("type=ffpe,<script>,a b");
    expect(filtersFromParams(p)).toEqual({ sampleType: ["ffpe"] });
  });
});
