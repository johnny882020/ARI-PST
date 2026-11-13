# ADR-001 — Render service layout
Status: Accepted with amendment. Date: 2026-11-13. Covers: REQ-053, REQ-069, REQ-072.

> **Amended by canonical-decisions C-03 and C-04 (build wave B5).** There is **no** separate `ari-app` static site. One web service `ari-api` serves `/api/v1` and the protected SPA on the same host, so the `__Host-sid` cookie works and no CORS is needed. Services as built: `ari-public` (static), `ari-api`, `ari-db`, and crons `ari-cron-staleness`, `ari-cron-audit-verify`, `ari-cron-purge`, `ari-cron-export`. The Blueprint is `render.yaml` at the repo root. The trade-off paragraph below is kept for history.

## Context
We need public site and protected app on Render. Team is small. Public and protected layers must be separate.

## Decision
- Static site `ari-public` (Astro) on `www.` domain.
- ~~Static site `ari-app`~~ Superseded: the SPA is served by `ari-api` at `/`.
- Web service `ari-api` (Fastify): API at `/api/v1` and SPA at `/`, one host (C-03).
- One managed Postgres `ari-db`. Reached by internal URL.
- Cron jobs (as built): `ari-cron-staleness`, `ari-cron-audit-verify`, `ari-cron-purge`, `ari-cron-export`.
- Private network is used for API to DB and cron to DB.
- Three environments: production, staging, PR previews. Each has its own DB. Previews use synthetic data only.
- No worker and no Key Value in Phase 1 (see doc 05 for the trigger).
- All defined in `render.yaml` (repo root).

## Consequences
- Few services = low cost and low ops.
- Public site stays up if the API is down.
- 2 API instances in production, 1 in staging (C-04). Zero-downtime deploy uses the `/readyz` health check.

## Trade-off
Separate static sites cost a little more config than one web service serving all. We accept it for isolation and CDN speed. A single service would be simpler but couples public uptime to API.
