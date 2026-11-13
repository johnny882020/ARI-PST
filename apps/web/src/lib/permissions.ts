import type { Role } from "@ari/api-client";

/**
 * One role -> capability table. Client guards are UX only; the API enforces every rule.
 * Components ask `useCan(permission)`, never for role names.
 */
export type Permission =
  | "search.aggregate"
  | "search.records"
  | "cart.use"
  | "requests.own"
  | "requests.queue.precheck"
  | "requests.queue.committee"
  | "requests.vote"
  | "requests.coordinate"
  | "samples.read"
  | "samples.write"
  | "samples.verify"
  | "import.run"
  | "freshness.view"
  | "committee.dashboard"
  | "audit.read"
  | "users.admin"
  | "registrations.approve"
  | "centers.admin"
  | "settings.privacy"
  | "health.view";

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  researcher_il: ["search.aggregate", "cart.use", "requests.own"],
  researcher_intl: ["search.aggregate"],
  center_clinician: ["search.aggregate", "search.records", "samples.read", "samples.verify", "freshness.view", "requests.coordinate"],
  national_coordinator: [
    "search.aggregate", "search.records", "samples.read", "samples.write", "samples.verify", "import.run", "freshness.view",
    "requests.queue.precheck", "requests.coordinate", "registrations.approve", "centers.admin",
  ],
  committee_member: ["search.aggregate", "requests.queue.committee", "requests.vote", "committee.dashboard"],
  system_admin: ["audit.read", "users.admin", "centers.admin", "settings.privacy", "health.view"],
};

export function permissionsFor(roles: readonly Role[]): Set<Permission> {
  const out = new Set<Permission>();
  for (const r of roles) for (const p of ROLE_PERMISSIONS[r] ?? []) out.add(p);
  return out;
}

/** Role home (`/` redirect). */
export function homeFor(roles: readonly Role[]): string {
  const has = (r: Role) => roles.includes(r);
  if (has("national_coordinator")) return "/home";
  if (has("system_admin")) return "/home";
  if (has("committee_member")) return "/committee";
  if (has("center_clinician")) return "/samples";
  return "/search";
}
