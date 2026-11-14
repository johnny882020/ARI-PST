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

  it("accepts a bare 202 without body", async () => {
    const f = vi.fn(async (_req: Request) => new Response(null, { status: 202 }));
    const c = createApiClient({ baseUrl: "http://t.test/api/v1", fetch: f as unknown as typeof fetch });
    const r = await c.POST("/auth/register", { body: { email: "a@example.test", displayName: "x", institution: "y", termsVersion: "1.0" } });
    expect(r.error).toBeUndefined();
    expect(r.response.ok).toBe(true);
  });

  it("STEP_UP_REQUIRED: asks for step-up, retries the same call once, never fires onUnauthorized", async () => {
    const stepUp = { title: "x", status: 401, code: "STEP_UP_REQUIRED", traceId: "t" };
    const bodies: string[] = [];
    let n = 0;
    const f = vi.fn(async (req: Request) => {
      bodies.push(await req.text());
      n += 1;
      return n === 1
        ? new Response(JSON.stringify(stepUp), { status: 401, headers: { "content-type": "application/problem+json" } })
        : new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const onUnauthorized = vi.fn();
    const onStepUpRequired = vi.fn(async () => true);
    const c = createApiClient({ baseUrl: "http://t.test/api/v1", fetch: f as unknown as typeof fetch, onUnauthorized, onStepUpRequired, getCookieSource: () => ({ cookie: "__Host-csrf=abc" }) });
    const r = await c.PUT("/requests/{requestId}/votes", { params: { path: { requestId: "req_1" } }, body: { vote: "approve" } as never });
    expect(r.response.status).toBe(200);
    expect(onStepUpRequired).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(f).toHaveBeenCalledTimes(2);
    expect(bodies[1]).toBe(bodies[0]);
    expect(f.mock.calls[1]![0].headers.get("X-CSRF-Token")).toBe("abc");
  });

  it("STEP_UP_REQUIRED: a cancelled step-up returns the original problem and does not sign out", async () => {
    const f = mkFetch(401, { title: "x", status: 401, code: "STEP_UP_REQUIRED", traceId: "t" }, "application/problem+json");
    const onUnauthorized = vi.fn();
    const onStepUpRequired = vi.fn(async () => false);
    const c = createApiClient({ baseUrl: "http://t.test/api/v1", fetch: f as unknown as typeof fetch, onUnauthorized, onStepUpRequired });
    await expect(unwrap(c.POST("/governance/k", { body: {} as never }))).rejects.toMatchObject({ code: "STEP_UP_REQUIRED", status: 401 });
    expect(f).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});
