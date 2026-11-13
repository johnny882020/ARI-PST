# Documentation audit (DOCS-1, 2026-11-13)

Scope: every `.md` file in the repo (220 files, including 52 CMS content pages that were checked for links only) plus `plan/traceability-matrix.csv`. Checks: relative links (script), Mermaid parse (mermaid 11 `parse`, 79 blocks, 0 failures), backticked paths in the top-level docs, and consistency with `canonical-decisions.md` and the code (`package.json` scripts, `render.yaml`, `db/`, `openapi.yaml`, `route-table.tsx`, `config.ts`, `ci.yml`).
Result: 0 broken relative links found before or after. Backticked path check found one dead path (`db/README.md`) and it was removed from the docs.

| File or group | Checked | Changed | Still unverified |
|---|---|---|---|
| `README.md`, `CLAUDE.md` | Commands, paths, scripts | Status line, DB test instructions (no `db/README.md`), links to new docs, extra commands | `pnpm test` was not run |
| `docs/architecture.md` | Topology, roles, k, cookies | One `ari-api` serves SPA and API, no `ari-app`; added C-01/02/03/05/06/09/11 summary; adapter names match code | none |
| `docs/deployment.md` | Names, env vars, scripts, workflows | Added section 12 (known gaps), flagged preview seeding as not implemented, migrator URL and bootstrap steps | Render facts (slugs, PITR, `IS_PULL_REQUEST`) |
| `docs/ops-model.md` | Workflow and variable names | none needed | Roles and rota are assumptions |
| `docs/runbooks/*` (9) | Script names, job paths, pages | RB-04 (secret names), RB-06 (`/freshness`, health page not built) | Drills not rehearsed |
| `docs/CHANGELOG.md`, `docs/KNOWN-ISSUES.md`, `docs/DOCS-AUDIT.md` | New | Created | Issue list is from reading code, not from running CI |
| `plan/MASTER-PLAN.md`, `plan/README.md`, `plan/ROADMAP.md`, `plan/decision-register.md` | Status, architecture box, gates | Status, one-service diagram, Build status section, links to docs, closed OPEN-A6-03, OPEN-A6-05, OPEN-A5-03 | Gate states are the owner's |
| `plan/11-integration/canonical-decisions.md` | Binding | C-04 amendment (B5 deviation) | none |
| `plan/00-contract-pack.md` | Repo layout | Blueprint location note | none |
| `plan/01-architecture/` (05, ADR-001, ADR-004, ADR-006, 01, 04, 08) | C-03/04/05/06/12/17 | Superseded notes, topology table and diagram, roles table, session values, p95 | Other files in the folder read only by search |
| `plan/02-security-privacy/` (01, 02, 05) | C-02/03/06/09 | Cookie and CSRF row, role names, mask label `Too few to show` | Legal items |
| `plan/03-data-integration/` (03, 07, 08) | C-03/06/07 | Cookie name, role note, retention (free text 24 months, record 7 y) | Retention needs legal review |
| `plan/04-product-workflow/` (02, 03, 04, 06, 07) | C-01/07/11/12 | State enum, diagram, state names, close reasons, audit-name note, p95 800 ms | Transition table timers are assumptions |
| `plan/05-design-brand/02-design-system.md` | C-09 | Wording closed | Brand line already used `×` (C-20), no change |
| `plan/06-frontend/` (02, 03, 04, 07, README) | C-02/03/09/17 | ADR renumbered ADR-011, cookie names, timeouts, step-up 5 min, origin model, route build-status note | Routes not built are listed in the note |
| `plan/07-devops-cicd/` (README, 01, 02, 03, 04, 05) | C-04/05/15 | Live file locations, health paths, CI job-name map, required check `ci-gate` only | Render facts |
| `plan/08-vnv/` (02, 05) | C-02/03/15 | Cookie, timeouts, required checks list | none |
| `plan/09-sre/` (03, 04) | C-05 | `/livez`, `/readyz` with `version`, Blueprint path | none |
| `plan/traceability-matrix.csv` | Stale names | none needed | Test status column is design-time |
| `plan/10-review/*`, `plan/requests/*`, `plan/AGENT-RUNBOOK.md` | Left as history | none (records of earlier findings) | Contain old names on purpose |
| Other `plan/**` files | Links, Mermaid | none | Not read line by line |
| `apps/public-site/**/*.md` (content, `CMS-SECURITY.md`), `packages/*/README.md`, `.github/*.md` | Links only | none | Hebrew copy is a machine draft, not reviewed |

## Remaining gaps
See `KNOWN-ISSUES.md`. The main ones for the docs: Render facts are UNVERIFIED, legal text needs legal review, several Blueprint and code settings do not match yet (documented in `deployment.md` section 12), and the router lists pages the UI does not have.
