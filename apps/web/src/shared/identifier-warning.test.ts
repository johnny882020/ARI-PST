import { describe, expect, it } from "vitest";
import { looksIdentifying } from "./identifier-warning";

describe("looksIdentifying", () => {
  it("flags ids, emails, exact dates", () => {
    expect(looksIdentifying("id 123456789 here")).toBe(true);
    expect(looksIdentifying("write to a.b@example.test")).toBe(true);
    expect(looksIdentifying("born 03/04/2015")).toBe(true);
  });
  it("passes ordinary research text", () => {
    expect(looksIdentifying("Outcome of low-grade glioma in 120 samples")).toBe(false);
  });
});
