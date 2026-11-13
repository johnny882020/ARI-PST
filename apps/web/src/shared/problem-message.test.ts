import { describe, expect, it } from "vitest";
import { ApiProblem } from "@ari/api-client";
import { problemMessageKey } from "./problem-message";
import { messages } from "@ari/i18n";

describe("problemMessageKey", () => {
  it("maps stable codes and statuses to existing i18n keys", () => {
    const cases: [number, string][] = [[401, "INVALID_CREDENTIALS"], [429, "RATE_LIMITED"], [409, "SOD_VIOLATION"], [403, "FORBIDDEN"], [500, "X"], [409, "OTHER"]];
    for (const [status, code] of cases) expect(messages.en).toHaveProperty(problemMessageKey(new ApiProblem({ status, code })));
  });
  it("falls back to the generic message for unknown errors", () => {
    expect(problemMessageKey(new Error("boom"))).toBe("error.generic.body");
  });
});
