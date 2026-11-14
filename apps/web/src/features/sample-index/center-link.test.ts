import { describe, expect, it } from "vitest";
import { centerSystemUrl } from "./center-link";

const v = { sampleCode: "smp_" + "1".repeat(26), centerCode: "syn_a" };
describe("centerSystemUrl", () => {
  it("has a safe default: no template, no link", () => {
    expect(centerSystemUrl(undefined, v)).toBeNull();
    expect(centerSystemUrl("", v)).toBeNull();
  });
  it("fills the coded id and center code, URL-encoded", () => {
    expect(centerSystemUrl("https://records.center.example/lookup?code={sampleCode}&c={centerCode}", v)).toBe(`https://records.center.example/lookup?code=${v.sampleCode}&c=syn_a`);
    expect(centerSystemUrl("https://x.example/{centerCode}", { ...v, centerCode: "a b&c" })).toBe("https://x.example/a%20b%26c");
  });
  it("refuses non-https, credentials and unknown placeholders", () => {
    expect(centerSystemUrl("http://x.example/{sampleCode}", v)).toBeNull();
    expect(centerSystemUrl("javascript:alert({sampleCode})", v)).toBeNull();
    expect(centerSystemUrl("https://u:p@x.example/{sampleCode}", v)).toBeNull();
    expect(centerSystemUrl("https://x.example/{patientName}", v)).toBeNull();
  });
});
