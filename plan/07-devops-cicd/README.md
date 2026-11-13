# 07 - DevOps / CI-CD (A7)

Status: draft v1. Owner: A7. Binding source: `plan/00-contract-pack.md`.

| File | Content |
|---|---|
| `01-repo-strategy.md` | Monorepo, trunk-based model, commits, CODEOWNERS, branch protection, environments, config and secrets |
| `02-render-deploy-design.md` | Branch-to-environment map, Blueprint design, gates, zero downtime, rollback, migrations |
| `03-pipeline.md` | Pipeline stages, gates, action pinning, scans |
| `04-iac.md` | Blueprint first, Terraform for the rest, region pin, policy-as-code |
| `05-release-strategy.md` | Flags, auto-rollback, approvals, two pipelines, production access model |
| `06-base44-readiness.md` | Round-trip job and portability tests |
| `07-dora-cost.md` | DORA metrics and cost guardrails |
| `08-research-log.md` | Render facts with source, date, status |
| `examples/render.yaml` | Production Blueprint (valid YAML) |
| `examples/render.staging.yaml` | Staging Blueprint (generated variant) |
| `examples/workflows/*.yml` | GitHub Actions: ci, codeql, dast-preview, deploy-protected, base44-roundtrip, dora, release-please, terraform |
| `examples/config/*` | CODEOWNERS, dependency-cruiser, commitlint, Lighthouse, Dependabot |
| `examples/policy/render.rego` | conftest policy for Blueprints |
| `examples/terraform/main.tf` | Illustrative Terraform |

Validation done: all YAML/JSON parse with Python `yaml`/`json`. `actionlint`, `conftest`, `terraform` and `render blueprints validate` were not available. Run them in the first CI run.

```mermaid
flowchart LR
  PR["Pull request"] --> CI["CI: ci-gate"]
  CI --> PV["Render preview (synthetic)"]
  PV --> DAST["ZAP baseline"]
  CI --> MAIN["merge to main"]
  MAIN --> STG["staging branch auto-deploy"]
  MAIN --> PUB["Public site auto-deploy (checksPass)"]
  STG --> APR{"Approval: production-protected"}
  APR --> PROD["Protected area deploy"]
  PROD --> HC["Health + smoke"]
  HC -->|fail| RB["Auto rollback"]
```
