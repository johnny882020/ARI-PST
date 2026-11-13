import type { components } from "./generated/schema";

type ProblemBody = components["schemas"]["Problem"];
type ValidationBody = components["schemas"]["ValidationProblem"];

/** RFC 9457 Problem Details, parsed from application/problem+json. No identifiers, no user text. */
export class ApiProblem extends Error {
  readonly status: number;
  readonly code: string;
  readonly traceId: string | undefined;
  readonly type: string | undefined;
  readonly title: string;
  readonly errors: { field: string; rule: string }[];
  readonly retryAfter: number | undefined;

  constructor(
    init: Partial<ValidationBody> & { status: number; retryAfter?: number },
  ) {
    super(init.title ?? `HTTP ${init.status}`);
    this.name = "ApiProblem";
    this.status = init.status;
    this.code = init.code ?? "UNKNOWN";
    this.traceId = init.traceId;
    this.type = init.type;
    this.title = init.title ?? "";
    this.errors = (init as ValidationBody).errors ?? [];
    this.retryAfter = init.retryAfter;
  }
}

export function isApiProblem(e: unknown): e is ApiProblem {
  return e instanceof ApiProblem;
}

/** Build an ApiProblem from any non-2xx response body. Never trusts the shape. */
export function toApiProblem(body: unknown, response: Response): ApiProblem {
  const b = (body && typeof body === "object" ? body : {}) as Partial<ProblemBody> &
    Partial<ValidationBody>;
  const ra = Number(response.headers.get("Retry-After"));
  return new ApiProblem({
    status: response.status,
    title: typeof b.title === "string" ? b.title : undefined,
    code: typeof b.code === "string" ? b.code : undefined,
    traceId: typeof b.traceId === "string" ? b.traceId : undefined,
    type: typeof b.type === "string" ? b.type : undefined,
    errors: Array.isArray(b.errors) ? b.errors : undefined,
    retryAfter: Number.isFinite(ra) && ra > 0 ? ra : undefined,
  });
}
