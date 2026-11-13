# A2 to A1 — requests

1. Place pure privacy functions in `packages/domain/privacy` (`canonicalize`, `neighbours`, `mergeToSafe`, `suppress`, `roundDisplay`, validators) behind `CountPort`. No DB import.
2. Add `CryptoPort` and `AuditPort`; `authorize(subject, action, resource)` as a pure function in domain.
3. DB roles: `app_owner`, `app_api`, `app_audit_writer`, `app_readonly_bg`. One transaction per request with `SET LOCAL app.*` context for RLS.
4. Two schemas: `public` (index, ops) and `agg` (generalized snapshot). External roles only reach `agg` functions.
5. OpenAPI: `additionalProperties:false`, `x-roles` and `x-scope` per route, no record-level endpoint for external roles.
6. ADR numbers 201–209 reserved for A2 (ADR-201 k-anonymity; ADR-205 key service is proposed in file 06 and needs a number).
7. Link-out is browser-only; no server-to-center call. Keep the center system outside the portal boundary in all diagrams.
