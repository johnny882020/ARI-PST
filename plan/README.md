# ARI-PST Portal — Plan index

> The files in this folder are design-time records. [`../docs/`](../docs/README.md) is the source of truth for the current system. Two files stay binding: `00-contract-pack.md` and `11-integration/canonical-decisions.md`.

Reading order:
1. `MASTER-PLAN.md` — 10-minute summary.
2. `00-contract-pack.md` — binding requirements, roles, gates, rules.
3. `ROADMAP.md` — sprints, dependencies, critical path.
4. Area plans (below).
5. `10-review/` — red-team and traceability findings.
6. `AGENT-RUNBOOK.md` — how to run the build with parallel agents.

| Folder | Owner | Content |
|---|---|---|
| `01-architecture/` | A1 | Architecture, C4, ADRs, Render topology, Base44 map, migration |
| `02-security-privacy/` | A2 | Threat model, k-anonymity, coding, access, crypto, audit, compliance |
| `03-data-integration/` | A3 | Schema, SQL, search, ingestion, OpenAPI, integrations |
| `04-product-workflow/` | A4 | Personas, state machine, requirements, user stories, governance |
| `05-design-brand/` | A5 | Brand, design system, RTL, accessibility, mockups |
| `06-frontend/` | A6 | Front-end and public-site design, CMS, budgets |
| `07-devops-cicd/` | A7 | Repo, Render deploy, pipelines, IaC, examples |
| `08-vnv/` | A8 | Test strategy, test catalog, UAT, traceability |
| `09-sre/` | A9 | SLOs, observability, backup, runbooks, incidents |
| `requests/` | all | Cross-agent requests |
| `10-review/` | R1, R2 | Findings |
| `11-integration/` | Orchestrator | `canonical-decisions.md` (wins over every plan) |

## Status
- Plan: complete (waves 1 to 3). The area plans `01-` to `10-` and `requests/` are kept as history and are not updated.
- Build: Phase 1 is built, on synthetic data only. CI `ci-gate` is green. `GATE-PROD-DATA` still blocks real data.
- Live demo: Render Blueprint `ari-pst-demo` (`../infra/render.free.yaml`), service `ari-demo-api-7teo`. The production Blueprint `../render.yaml` is not applied.
- Current documentation: [`../docs/README.md`](../docs/README.md). Gaps: [`../docs/KNOWN-ISSUES.md`](../docs/KNOWN-ISSUES.md). Deployment: [`../docs/deployment.md`](../docs/deployment.md). Google Cloud: [`../docs/migration/google-cloud.md`](../docs/migration/google-cloud.md).
- Decisions and gates: [`decision-register.md`](decision-register.md). REQ coverage: `traceability-matrix.csv`.
