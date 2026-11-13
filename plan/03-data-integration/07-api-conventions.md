# 07 API conventions: versioning and errors

Contract: `openapi/openapi.yaml` (OpenAPI 3.1.0, valid YAML, 55 schemas checked with a JSON Schema 2020-12 validator, all `$ref` resolve, 50 operations with unique `operationId`). A1 merges it into `packages/contracts`. Spectral lint is a CI job (A7). I could not run Spectral here (no package download allowed in this session).

## Versioning
- URL major version: `/api/v1`. Only breaking changes create `/api/v2`. Breaking = remove or rename a field, narrow an enum, change a type, change auth.
- Non-breaking within v1: add optional field, add enum value in a **response** (clients must tolerate unknown values), add endpoint.
- Request enums: adding a value is non-breaking. Removing is breaking.
- `info.version` follows semver for the contract (`1.0.0-draft` now). A contract diff job (oasdiff or similar, A7) blocks breaking changes in v1.
- Deprecation: `Deprecation` and `Sunset` headers (RFC 9745 / RFC 8594) and 6 months overlap. UNVERIFIED RFC numbers; check at implementation.
- Generated client `packages/api-client` is built from the contract. No hand-written calls.

## Conventions
| Topic | Rule |
|---|---|
| JSON | camelCase. Dates `date-time` UTC. `collectionMonth` `YYYY-MM` |
| Pagination | Cursor: `?cursor=&limit=` (max 100). Response `{items, nextCursor}`. Cursor is opaque (signed) |
| Idempotency | `Idempotency-Key` header on POST that creates requests, imports, samples. Stored in `idempotency_keys` (24 h). Same key + same body = same response. Same key + different body = 409 `IDEMPOTENCY_CONFLICT` |
| Concurrency | `ETag` on samples. `If-Match` required on PATCH. 412 on mismatch |
| Auth | Server-side session cookie `ari_session` (HttpOnly, Secure, SameSite=Strict) + `X-CSRF-Token` on unsafe methods |
| Partial update | `application/merge-patch+json` (RFC 7396) |
| Rate limits | 429 + `Retry-After`. Search endpoints have a tighter budget (see 04 item 7) |
| Content | No identifiers in any payload |

## Error model (RFC 9457)
Media type `application/problem+json`. Members: `type` (relative URI under `/problems/`), `title`, `status`, `detail`, `instance`, plus extensions `code` and `traceId` (contract pack). 422 adds `errors[] {field, rule}`. Rules: no user-supplied text and no identifiers in any member; `detail` is a fixed sentence per `code`; localised text comes from i18n keys on the client (`errors.<code>`).

Codes (stable): `VALIDATION_FAILED`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND` (also used when a row exists but is not visible), `CONFLICT`, `ETAG_MISMATCH`, `IDEMPOTENCY_CONFLICT`, `RATE_LIMITED`, `KANON_SUPPRESSED` (informational on aggregate calls; returned as 200 with `suppressed=true`, not as an error), `SOD_VIOLATION`, `IMPORT_FILE_INVALID`, `IMPORT_HASH_MISMATCH`, `REQUEST_STATE_INVALID`, `QUORUM_NOT_REACHED`, `INTERNAL`.
Machine list: `yaml/error-codes.yaml`.

Example (synthetic):
```json
{
  "type": "/problems/validation-failed",
  "title": "Validation failed",
  "status": 422,
  "code": "VALIDATION_FAILED",
  "traceId": "01HZSYNTHETICTRACE00000000",
  "errors": [{ "field": "sampleType", "rule": "VOCAB" }]
}
```
Security note: 404 for rows outside a clinician's center (not 403), so existence is not leaked.
