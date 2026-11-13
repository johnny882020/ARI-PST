import { describe, expect, it } from "vitest";
import { fmtMonth, fmtRemaining, fmtNumber } from "./format";

describe("format", () => {
  it("shows collection month as month + year only", () => {
    expect(fmtMonth("2026-03", "en")).toMatch(/March 2026/);
    expect(fmtMonth("2026-03", "he")).toMatch(/2026/);
    expect(fmtMonth("garbage", "en")).toBe("garbage");
  });
  it("formats remaining time as m:ss", () => {
    expect(fmtRemaining(125)).toBe("2:05");
    expect(fmtRemaining(-4)).toBe("0:00");
  });
  it("formats numbers per locale", () => expect(fmtNumber(12345, "en")).toBe("12,345"));
});
