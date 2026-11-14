# Documentation index

The `docs/` folder describes the current system. It is the source of truth for how the portal is built, deployed and run.
The `plan/` folder holds the design-time records. Two plan files stay binding: [`plan/00-contract-pack.md`](../plan/00-contract-pack.md) (requirements, roles, gates) and [`plan/11-integration/canonical-decisions.md`](../plan/11-integration/canonical-decisions.md) (wins over every other plan file).

## Start here

| Reader | Read first |
|---|---|
| New developer | [`../README.md`](../README.md), [`architecture.md`](architecture.md), [`../CLAUDE.md`](../CLAUDE.md) |
| Operator | [`deployment.md`](deployment.md), [`ops-model.md`](ops-model.md), [`runbooks/`](runbooks/README.md) |
| Reviewer or auditor | [`KNOWN-ISSUES.md`](KNOWN-ISSUES.md), [`REVIEW-2026-11.md`](REVIEW-2026-11.md), [`qa/REPORT.md`](qa/REPORT.md) |

## System

| Document | Content |
|---|---|
| [`architecture.md`](architecture.md) | Context, modules, ports and adapters, security design, Render topology |
| [`../db/README.md`](../db/README.md) | Database roles, function contract, privacy engine, retention |
| [`../packages/contracts/openapi.yaml`](../packages/contracts/openapi.yaml) | API contract (OpenAPI 3.1) |

## Design

| Document | Content |
|---|---|
| [`design/STYLE-GUIDE.md`](design/STYLE-GUIDE.md) | Visual style: calm navy and gold, pill controls, Hebrew-first RTL. Screenshots in `design/screenshots/` |

## Operations

| Document | Content |
|---|---|
| [`deployment.md`](deployment.md) | Free demo, production Blueprint, variables, GitHub settings, rollback |
| [`migration/google-cloud.md`](migration/google-cloud.md) | Step-by-step move from Render to Google Cloud |
| [`ops-model.md`](ops-model.md) | Owners, cadence, release rules, incidents |
| [`runbooks/README.md`](runbooks/README.md) | Runbooks RB-01 to RB-08 |

## Quality and status

| Document | Content |
|---|---|
| [`KNOWN-ISSUES.md`](KNOWN-ISSUES.md) | Open gaps by severity, unverified facts, legal items |
| [`REVIEW-2026-11.md`](REVIEW-2026-11.md) | Code review findings |
| [`qa/REPORT.md`](qa/REPORT.md) | QA results (accessibility, layout, role guards, flows) |
| [`qa/BUGS.md`](qa/BUGS.md) | QA bug list and fix status |
| [`qa/flows/REPORT.md`](qa/flows/REPORT.md) | End-to-end flow report for every role, with screenshots |
| [`qa/scripts/README.md`](qa/scripts/README.md) | How to run the QA scripts |
| [`CHANGELOG.md`](CHANGELOG.md) | Release history |

## Package and app guides

| Path | Guide |
|---|---|
| `apps/api` | [`../apps/api/README.md`](../apps/api/README.md) |
| `apps/web` | [`../apps/web/README.md`](../apps/web/README.md) |
| `apps/public-site` | [`../apps/public-site/README.md`](../apps/public-site/README.md), [`CMS-SECURITY.md`](../apps/public-site/CMS-SECURITY.md) |
| `packages/domain` | [`../packages/domain/README.md`](../packages/domain/README.md) |
| `packages/contracts` | [`../packages/contracts/README.md`](../packages/contracts/README.md) |
| `packages/api-client` | [`../packages/api-client/README.md`](../packages/api-client/README.md) |
| `packages/design-system` | [`../packages/design-system/README.md`](../packages/design-system/README.md) |
| `packages/i18n` | [`../packages/i18n/README.md`](../packages/i18n/README.md) |
| `packages/synthetic-data` | [`../packages/synthetic-data/README.md`](../packages/synthetic-data/README.md) |

## Writing rules for these documents

- Describe the current system only. Put history in [`CHANGELOG.md`](CHANGELOG.md).
- Use short, plain sentences and numbered steps.
- Mark facts that were not checked as UNVERIFIED.
- Mark legal and regulatory statements as "needs legal review".
- Use synthetic examples only. Never add personal data or secrets.
