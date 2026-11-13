# A9 to A1 (Architect)
1. API endpoints `/healthz` and `/readyz` (no data in response).
2. Maintenance/read-only mode flag in the API (RB-02, cutover freeze).
3. OTel instrumentation and allow-list logger as a shared package in `observability`; `traceId` in RFC 9457 errors.
4. Ingestion must be idempotent by `sample_code` and emit reject reason codes without values.
5. Metrics listed in `plan/09-sre/02-observability.md` (names are final).
6. Feature flags for search facets and k value (RB-03).
7. Portable full export tool (also used for exit plan and cutover).
