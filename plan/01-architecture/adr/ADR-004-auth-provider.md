# ADR-004 — Auth provider
Status: Proposed. Date: 2026-11-13. Covers: REQ-044, REQ-045, REQ-059.

## Context
Need 2FA, RBAC, sessions, later SSO. Base44 may replace the platform later. A third-party identity SaaS would add a processor and a DPA.

## Decision
- Own `AuthPort` in domain. Adapter `auth-local`.
- Passwords: Argon2id. Second factor: WebAuthn passkeys, TOTP fallback. 2FA is mandatory for all protected roles.
- Server-side sessions in Postgres. Cookie: `HttpOnly`, `Secure`, `SameSite=Lax`, idle timeout 30 min, absolute 12 h (A2 may tighten).
- Roles from contract pack. Role checks live in `identity-access` (`AccessPolicy`).
- Phase 2: OIDC adapter behind same port.

## Consequences
- No new data processor. Full export of accounts possible.
- We own security upkeep (hash params, recovery flows, rate limits). A2 reviews.
- Moving to Base44 auth later needs a new adapter and credential reset (hashes may not import; UNVERIFIED).

## Trade-off
Managed IdP (Auth0, Cognito) saves effort but adds vendor, cost, and lock-in. Own adapter costs more build time but keeps the portability rule.
