# A2 to A8 — requests

1. Implement privacy properties P-01..P-18 (`plan/02-security-privacy/02-reidentification-controls.md`, section 7) with fast-check.
2. Implement canary tests CAN-01..CAN-08 (`10-never-in-portal-and-render-hardening.md`).
3. RLS matrix test: every role x table x operation (`05-identity-access.md`, section 5). Include "no context = zero rows" and "system_admin reads zero sample rows".
4. Audit tests (`07-audit-log.md`, section 6): chain tamper, insert-only, fail-closed, seq gap.
5. Session/MFA tests: timeouts, rotation, CSRF, passkey-required roles, enumeration timing.
6. Authz contract test: every OpenAPI route x every role.
7. Pen-test readiness: provide attack scripts for differencing/tracker (P-14).
