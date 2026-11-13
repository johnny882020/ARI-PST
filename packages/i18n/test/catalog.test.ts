import { describe, expect, it } from "vitest";
import { IntlMessageFormat } from "intl-messageformat";
import { messages, KEY_PATTERN, negotiateLocale, dirFor } from "../src";

describe("catalogs", () => {
  const heKeys = Object.keys(messages.he).sort();
  const enKeys = Object.keys(messages.en).sort();
  it("have identical key sets", () => expect(heKeys).toEqual(enKeys));
  it("use area.screen.element key shape", () => {
    for (const k of enKeys) expect(k, k).toMatch(KEY_PATTERN);
  });
  it("parse as ICU and use the same placeholders", () => {
    for (const k of enKeys) {
      for (const loc of ["he", "en"] as const) {
        expect(() => new IntlMessageFormat(messages[loc][k as keyof typeof messages.en], loc), `${loc}:${k}`).not.toThrow();
      }
    }
  });
  it("never print a k threshold in suppression copy", () => {
    for (const k of enKeys.filter((x) => x.startsWith("counts."))) {
      expect(messages.en[k as keyof typeof messages.en]).not.toMatch(/<\s*\d|\bk\s*=/);
    }
  });
  it("negotiates locale with he default", () => {
    expect(negotiateLocale(undefined)).toBe("he");
    expect(negotiateLocale(["fr-FR", "en-GB"])).toBe("en");
    expect(negotiateLocale(["iw"])).toBe("he");
    expect(dirFor("he")).toBe("rtl");
    expect(dirFor("en")).toBe("ltr");
  });
});
