import type { SearchFilters } from "@ari/api-client";

/** Filters live in the URL as enum codes only (never free text, never personal). */
const KEYS = { diagnosis: "dx", sampleType: "type", ageBand: "age", centerId: "center", timepoint: "tp", availability: "avail", attachedData: "data", sex: "sex" } as const;

export function filtersFromParams(p: URLSearchParams): SearchFilters {
  const out: Record<string, string[]> = {};
  for (const [field, key] of Object.entries(KEYS)) {
    const raw = p.get(key);
    if (raw) out[field] = raw.split(",").filter((s) => /^[a-zA-Z0-9_]{1,40}$/.test(s));
  }
  return out as SearchFilters;
}

export function filtersToParams(f: SearchFilters): URLSearchParams {
  const p = new URLSearchParams();
  for (const [field, key] of Object.entries(KEYS)) {
    const v = (f as Record<string, string[] | undefined>)[field];
    if (v?.length) p.set(key, v.join(","));
  }
  return p;
}

export function countActive(f: SearchFilters): number {
  return Object.values(f).reduce((n, v) => n + (Array.isArray(v) ? v.length : 0), 0);
}
export const FILTER_FIELDS = Object.keys(KEYS) as (keyof SearchFilters)[];
