import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "./generated/schema";
import type { ExtPaths } from "./ext";
import { toApiProblem } from "./problem";

export type AllPaths = paths & ExtPaths;

export const API_BASE = "/api/v1";
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);
export const CSRF_COOKIE = "__Host-csrf";
export const CSRF_HEADER = "X-CSRF-Token";

/** Reads the double-submit token from the (non-HttpOnly) __Host-csrf cookie. Never from storage. */
export function readCsrfCookie(doc: { cookie: string } | undefined = typeof document === "undefined" ? undefined : document): string | undefined {
  if (!doc) return undefined;
  for (const part of doc.cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === CSRF_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export interface ApiClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Token fallback (e.g. Session.csrfToken held in memory) when the cookie is not readable. */
  getCsrfFallback?: () => string | undefined;
  /** Called once per 401 on a non-auth endpoint. The app clears state and shows the expiry flow. */
  onUnauthorized?: () => void;
  getCookieSource?: () => { cookie: string } | undefined;
}

export function createApiClient(opts: ApiClientOptions = {}) {
  const client = createClient<AllPaths>({
    baseUrl: opts.baseUrl ?? API_BASE,
    credentials: "same-origin",
    ...(opts.fetch ? { fetch: (req: Request) => opts.fetch!(req) } : {}),
  });

  const mw: Middleware = {
    onRequest({ request }) {
      if (!SAFE.has(request.method.toUpperCase())) {
        const token = readCsrfCookie(opts.getCookieSource?.()) ?? opts.getCsrfFallback?.();
        if (token) request.headers.set(CSRF_HEADER, token);
      }
      if (!request.headers.has("Accept")) request.headers.set("Accept", "application/json, application/problem+json");
      return request;
    },
    onResponse({ response, request }) {
      if (response.status === 401 && !new URL(request.url, "http://x").pathname.includes("/auth/")) {
        opts.onUnauthorized?.();
      }
      return response;
    },
  };
  client.use(mw);
  return client;
}

export type ApiClient = ReturnType<typeof createApiClient>;

type Res = { data?: unknown; error?: unknown; response: Response };

/** Unwraps an openapi-fetch result: returns data, or throws ApiProblem. */
export async function unwrap<R extends Res>(p: Promise<R>): Promise<NonNullable<R["data"]>> {
  const r = await p;
  if (r.error !== undefined || !r.response.ok) throw toApiProblem(r.error, r.response);
  return r.data as NonNullable<R["data"]>;
}

/** Same as unwrap but for 204 responses: resolves void. */
export async function unwrapVoid(p: Promise<{ error?: unknown; response: Response }>): Promise<void> {
  const r = await p;
  if (r.error !== undefined || !r.response.ok) throw toApiProblem(r.error, r.response);
}

export function idempotencyKey(): string {
  return crypto.randomUUID();
}
