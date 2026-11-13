# ARI-PST Portal — Plan index

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

Status: plan complete. Phase 1 built and in verification (synthetic data only). Build status and gaps: `MASTER-PLAN.md` (Build status), `../docs/KNOWN-ISSUES.md`, `../docs/CHANGELOG.md`. Operator docs: `../docs/deployment.md`, `../docs/architecture.md`, `../docs/runbooks/`. QA evidence: `../docs/qa/`. Documentation audit: `../docs/DOCS-AUDIT.md`.

Wave 3 files: `11-integration/canonical-decisions.md`, `decision-register.md`, `traceability-matrix.csv` (REQ coverage: design 72/72, tests 63/72; 9 REQs are Phase 0 or later gate items).
Not yet verified: Render facts (docs were unreachable), legal items. Mermaid blocks were parse-checked on 2026-11-13 (see `../docs/DOCS-AUDIT.md`).
