import { api } from "../lib/api";

declare const __APP_VERSION__: string | undefined;
const sent = new Set<string>();

/** Same-origin only. Sends error name, route path (no query, no digits runs) and version. Nothing else. */
export function reportClientError(name: string, path: string, traceId?: string): void {
  const route = path.replace(/[?#].*$/, "").replace(/(req|smp|usr|imp|ctr)_[0-9A-Z]{26}/g, "$1_:id").replace(/\d{5,}/g, "#");
  const key = `${name}|${route}`;
  if (sent.has(key) || sent.size > 20) return;
  sent.add(key);
  void api
    .POST("/client-errors", { body: { name: name.slice(0, 60), route: route.slice(0, 120), version: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev", traceId } })
    .catch(() => undefined);
}
