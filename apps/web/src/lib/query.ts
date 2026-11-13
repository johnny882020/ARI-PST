import { QueryClient } from "@tanstack/react-query";
import { isApiProblem } from "@ari/api-client";

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: true,
        retry: (count, err) => {
          if (isApiProblem(err) && err.status >= 400 && err.status < 500) return false;
          return count < 2;
        },
      },
      mutations: { retry: false },
    },
  });
}

/** Key = [module, resource, params]. */
export const qk = {
  session: ["auth", "session"] as const,
  centers: ["admin", "centers"] as const,
  diagnoses: ["search", "diagnoses"] as const,
  aggregate: (p: unknown) => ["search", "aggregate", p] as const,
  facets: (p: unknown) => ["search", "facets", p] as const,
  cart: ["requests", "cart"] as const,
  requests: (p?: unknown) => ["requests", "list", p ?? null] as const,
  request: (id: string) => ["requests", "detail", id] as const,
  tally: (id: string) => ["requests", "tally", id] as const,
  samples: (p?: unknown) => ["samples", "list", p ?? null] as const,
  sample: (id: string) => ["samples", "detail", id] as const,
  staleness: (id: string) => ["samples", "staleness", id] as const,
  importJobs: ["ingest", "jobs"] as const,
  importJob: (id: string) => ["ingest", "job", id] as const,
  importRows: (id: string, outcome?: string) => ["ingest", "rows", id, outcome ?? "all"] as const,
  users: (p?: unknown) => ["admin", "users", p ?? null] as const,
  registrations: ["admin", "registrations"] as const,
  kPolicies: ["admin", "kPolicies"] as const,
  roleGrants: ["admin", "roleGrants"] as const,
  audit: (p: unknown) => ["audit", "events", p] as const,
  methods: ["auth", "methods"] as const,
};
