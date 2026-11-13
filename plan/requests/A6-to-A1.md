# A6 to A1 (Architect)

1. Same-origin deploy (OPEN-A6-03). `__Host-` cookies need SPA and API on one host. Please decide: Render proxy rule `/api/*` to the API (UNVERIFIED it works for a static site), or API service serves the SPA files.
2. Public forms endpoint (OPEN-A6-02). Need `POST /api/v1/public/forms/{join|contact}` (unauthenticated, strict schema, 202, rate limit, CORS for the site origin only). Or a separate tiny service. Please decide and add to the contract.
3. `GET /api/v1/me` must return `permissions[]` and `features{}` so the UI does not check role names. Add `POST /api/v1/session/extend`, `GET /api/v1/session` (`expiresAt`, `absoluteExpiresAt`, `lastMfaAt`), `POST /api/v1/client-errors`, `POST /api/v1/csp-report`.
4. Aggregate search response must carry `exact`, `suppressed`, `mergedInto` per bucket (shape in `04-protected-app-security.md` section 8).
5. Request cart: server-side `/api/v1/request-cart` and request drafts with `status=draft` (OPEN-A6-01).
6. Errors: `validation_failed` must carry `errors[] {pointer, code}`; `403` with `code: step_up_required`.
7. Download links: one-time `dl_<ULID>` URL, 60 s, session-bound.
