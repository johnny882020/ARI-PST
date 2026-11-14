import { describe, expect, it } from "vitest";
import { messages } from "@ari/i18n";
import { countBandKey } from "./CartPage";

describe("cart count band", () => {
  it("maps the API band tokens to approved wording, never a raw token or a threshold", () => {
    expect(messages.en[countBandKey("10_plus")!]).toBe("10 or more");
    expect(messages.he[countBandKey("10_plus")!]).toBe("10 או יותר");
    expect(messages.en[countBandKey("lt10")!]).toBe("Fewer than 10");
    expect(countBandKey("other")).toBeNull();
    for (const k of ["cart.count.10_plus", "cart.count.lt10"] as const) expect(messages.en[k]).not.toMatch(/<\s*\d|\bk\s*=|_/);
  });
});
