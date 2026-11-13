/** `next` must be a same-origin path. No scheme, no protocol-relative, no backslashes, no auth routes. */
export function safeNext(raw: string | null | undefined, fallback = "/"): string {
  if (!raw) return fallback;
  if (!/^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/?#]*$/.test(raw)) return fallback;
  if (raw.startsWith("//") || raw.includes("\\")) return fallback;
  if (raw.startsWith("/login") || raw.startsWith("/session-ended")) return fallback;
  return raw;
}
