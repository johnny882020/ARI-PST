import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-path";

describe("safeNext", () => {
  it("accepts same-origin paths", () => {
    expect(safeNext("/requests/req_1?x=1")).toBe("/requests/req_1?x=1");
  });
  it("rejects open redirects", () => {
    for (const bad of ["//evil.test", "https://evil.test", "/\\evil", "javascript:alert(1)", "evil", "/login", ""]) {
      expect(safeNext(bad)).toBe("/");
    }
  });
});
