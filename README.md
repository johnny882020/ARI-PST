# ARI-PST Portal

National index of **de-identified** pediatric solid-tumor samples, plus a public site. Hebrew (RTL) and English.
Initiative: ARI-PST × Tech4Cancer.

> **Status: Phase 1 built and in verification, synthetic data only.** Known gaps: `docs/KNOWN-ISSUES.md`. No real patient data may enter any environment until the `GATE-PROD-DATA` conditions are met (DPA, region control, export round trip, migration path, legal review, pen-test). See `plan/decision-register.md`.
>
> Demo: a free-plan Render demo with synthetic data runs from `infra/render.free.yaml` (service `ari-demo-api-7teo`, `docs/deployment.md` section 13).

The portal holds an index. Tissue and identifying data stay in the medical centers.

## Quick start
Needs Node ≥ 22.18, pnpm 10, and PostgreSQL 16 for database and API tests.
```bash
pnpm install
pnpm test            # all package tests
pnpm typecheck && pnpm lint
pnpm arch            # architecture rules (domain imports no platform library)
```
Run one area:
```bash
pnpm --filter @ari/public-site dev          # public site (he/en)
pnpm --filter @ari/web dev                  # protected app; `pnpm --filter @ari/web mock` serves a mock API
pnpm --filter @ari/design-system gallery:dev   # component gallery
pnpm --filter @ari/db test                    # database tests: starts a throwaway PostgreSQL 16 (db/scripts/test-db.sh)
```

## Layout
| Path | What |
|---|---|
| `apps/public-site` | Astro static site, Git-based CMS |
| `apps/web` | React SPA for the protected area |
| `apps/api` | Fastify API, ten modules, ports and adapters |
| `packages/domain` | Pure rules, roles, request state machine, ports |
| `packages/contracts` | OpenAPI 3.1 (the API contract) |
| `packages/design-system`, `i18n`, `api-client`, `synthetic-data` | Shared packages |
| `db/` | Forward-only SQL migrations, runner, seed, tests |
| `render.yaml`, `infra/`, `scripts/`, `.github/` | Render Blueprint (repo root), staging and free-demo Blueprints (`infra/render.staging.yaml`, `infra/render.free.yaml`) and policy, pre-deploy, smoke and backup scripts, CI |
| `plan/` | Plan, decisions, reviews. Start at `plan/README.md` |
| `docs/` | Architecture, deployment, runbooks, QA, changelog, known issues |

## Documentation
- Architecture: `docs/architecture.md`
- Deploy to Render: `docs/deployment.md`
- Migrate to Google Cloud (step by step): `docs/migration/google-cloud.md`
- Runbooks: `docs/runbooks/`
- QA reports and screenshots: `docs/qa/`
- What was built: `docs/CHANGELOG.md`. What is missing or unverified: `docs/KNOWN-ISSUES.md`. Documentation audit: `docs/DOCS-AUDIT.md`. Code review findings: `docs/REVIEW-2026-11.md`
- Operating model: `docs/ops-model.md`
- Rules for contributors and agents: `CLAUDE.md`

## Contributing
- Every change is a pull request. CI check `ci-gate` must pass.
- Synthetic data only. Use `packages/synthetic-data`.
- Change the contract first (`openapi.yaml`, SQL migrations), then the code.
- If code and plan disagree, `plan/11-integration/canonical-decisions.md` decides.
- Legal and regulatory text is a draft and needs legal review.
