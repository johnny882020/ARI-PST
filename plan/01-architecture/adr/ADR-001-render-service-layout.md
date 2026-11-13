# ADR-001 — Render service layout
Status: Proposed. Date: 2026-11-13. Covers: REQ-053, REQ-069, REQ-072.

## Context
We need public site and protected app on Render. Team is small. Public and protected layers must be separate.

## Decision
- Static site `ari-public` (Astro) on `www.` domain.
- Static site `ari-app` (React SPA) on `app.` domain.
- Web service `ari-api` (Fastify) on `api.` domain (or `app.` path `/api`).
- One managed Postgres `ari-db`. Reached by internal URL.
- Cron jobs: `ari-cron-staleness`, `ari-cron-retention`, `ari-cron-export-check`.
- Private network is used for API to DB and cron to DB.
- Three environments: production, staging, PR previews. Each has its own DB. Previews use synthetic data only.
- No worker and no Key Value in Phase 1 (see doc 05 for the trigger).
- All defined in `infra/render.yaml`.

## Consequences
- Few services = low cost and low ops.
- Public site stays up if the API is down.
- API is one instance at first; zero-downtime deploy needs health checks (A7).

## Trade-off
Separate static sites cost a little more config than one web service serving all. We accept it for isolation and CDN speed. A single service would be simpler but couples public uptime to API.
