# ADR-010 — Portability layer
Status: Proposed. Date: 2026-11-13. Covers: REQ-054, REQ-069, REQ-070.

## Context
Move to Base44 later is TBD, not decided. Must not be blocked.

## Decision
- Hexagonal core, ports for auth, storage, email, clock, audit, search, repositories.
- Contracts first: OpenAPI 3.1 and plain SQL schema are the portable artifacts.
- Platform capability map (doc 06) kept current. Reviewed each phase.
- Export/import round trip: one command exports DB to a versioned archive (SQL + manifest + checksums); one command imports it into an empty DB; CI proves equality with a synthetic data set.
- Portability CI job: run the full integration suite against a plain `postgres` container with no Render features.
- Arch test fails the build when domain imports platform libs (doc 03).
- Render-specific files (`render.yaml`) are isolated in `infra/`. Terraform in `infra/terraform` for neutral parts.
- Adapter inventory with a "replacement notes" column kept in doc 07.

## Consequences
- Extra discipline and ports (small overhead).
- Exit effort is bounded and testable.

## Trade-off
Using Render-native features freely (e.g. Render Redis for sessions) is faster now but adds lock-in. We use only standard features.
