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
  /**
   * Called when the API answers 401 STEP_UP_REQUIRED (sensitive action, second factor older than 5 minutes).
   * Resolve true after a successful POST /auth/step-up: the client then sends the same call once more.
   * Resolve false to give the caller the original problem. A step-up answer never counts as a lost session.
   */
  onStepUpRequired?: () => Promise<boolean>;
}

const STEP_UP_CODE = "STEP_UP_REQUIRED";

async function problemCode(response: Response): Promise<string | undefined> {
  try {
    const b = (await response.clone().json()) as { code?: unknown };
    return typeof b?.code === "string" ? b.code : undefined;
  } catch {
    return undefined;
  }
}

export function createApiClient(opts: ApiClientOptions = {}) {
  const client = createClient<AllPaths>({
    baseUrl: opts.baseUrl ?? API_BASE,
    credentials: "same-origin",
    ...(opts.fetch ? { fetch: (req: Request) => opts.fetch!(req) } : {}),
  });

  // Unsafe calls keep an unread copy, so a call refused for a stale second factor can be sent again after the step-up.
  const retryCopies = new WeakMap<Request, Request>();
  const send = (req: Request) => (opts.fetch ?? globalThis.fetch)(req);

  const mw: Middleware = {
    onRequest({ request }) {
      if (!SAFE.has(request.method.toUpperCase())) {
        const token = readCsrfCookie(opts.getCookieSource?.()) ?? opts.getCsrfFallback?.();
        if (token) request.headers.set(CSRF_HEADER, token);
      }
      if (!request.headers.has("Accept")) request.headers.set("Accept", "application/json, application/problem+json");
      if (opts.onStepUpRequired && !SAFE.has(request.method.toUpperCase())) retryCopies.set(request, request.clone());
      return request;
    },
    async onResponse({ response, request }) {
      const isAuthPath = new URL(request.url, "http://x").pathname.includes("/auth/");
      if (response.status === 401 && !isAuthPath) {
        if ((await problemCode(response)) === STEP_UP_CODE) {
          // Not a lost session: ask for the second factor, then retry once. Never fire onUnauthorized here.
          const copy = retryCopies.get(request);
          retryCopies.delete(request);
          if (copy && opts.onStepUpRequired && (await opts.onStepUpRequired())) response = await send(copy);
        } else {
          opts.onUnauthorized?.();
        }
      }
      retryCopies.delete(request);
      // 2xx with no body and no content type (e.g. a bare 202): treat as 204 so the parser does not choke.
      if (response.ok && response.status !== 204 && !response.headers.get("content-type")) {
        return new Response(null, { status: 204, headers: response.headers });
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
