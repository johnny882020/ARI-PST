import { describe, expect, it, vi } from "vitest";
import { createApiClient, readCsrfCookie, unwrap, ApiProblem } from "../src";

function mkFetch(status: number, body: unknown, ct = "application/json") {
  return vi.fn(async (_req: Request) => new Response(JSON.stringify(body), { status, headers: { "content-type": ct, "Retry-After": "7" } }));
}

describe("api client", () => {
  it("reads CSRF cookie", () => {
    expect(readCsrfCookie({ cookie: "a=1; __Host-csrf=tok%20en; b=2" })).toBe("tok en");
    expect(readCsrfCookie({ cookie: "a=1" })).toBeUndefined();
  });

  it("adds X-CSRF-Token on unsafe methods only", async () => {
    const f = mkFetch(200, { items: [] });
    const c = createApiClient({ baseUrl: "http://t.test/api/v1", fetch: f as unknown as typeof fetch, getCookieSource: () => ({ cookie: "__Host-csrf=abc" }) });
    await c.GET("/centers");
    expect(f.mock.calls[0]![0].headers.get("X-CSRF-Token")).toBeNull();
    await c.POST("/auth/logout");
    expect(f.mock.calls[1]![0].headers.get("X-CSRF-Token")).toBe("abc");
  });

  it("throws ApiProblem with code, traceId, retry-after", async () => {
    const f = mkFetch(429, { type: "/p", title: "Rate", status: 429, code: "RATE_LIMITED", traceId: "t1" }, "application/problem+json");
    const c = createApiClient({ baseUrl: "http://t.test/api/v1", fetch: f as unknown as typeof fetch });
    await expect(unwrap(c.GET("/centers"))).rejects.toMatchObject({ code: "RATE_LIMITED", traceId: "t1", status: 429, retryAfter: 7 });
    await expect(unwrap(c.GET("/centers"))).rejects.toBeInstanceOf(ApiProblem);
  });

  it("calls onUnauthorized for 401 outside /auth", async () => {
    const f = mkFetch(401, { title: "x", status: 401, code: "UNAUTHENTICATED", traceId: "t" }, "application/problem+json");
    const onUnauthorized = vi.fn();
    const c = createApiClient({ baseUrl: "http://t.test/api/v1", fetch: f as unknown as typeof fetch, onUnauthorized });
    await c.GET("/centers");
    await c.GET("/auth/session");
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
});
