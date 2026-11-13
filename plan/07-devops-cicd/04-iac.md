# 04 - Infrastructure as code

## Order of use
1. Render Blueprint (`render.yaml` at the repo root, `infra/render.staging.yaml`; as built). Default for everything Render hosts.
2. Terraform (`infra/terraform`) only for what Blueprint cannot do:
   | Area | Why not Blueprint | Tool |
   |---|---|---|
   | DNS records | outside Render | Terraform DNS provider |
   | CDN / WAF / rate limit | outside Render (Render has built-in CDN for static, no WAF config in Blueprint, UNVERIFIED) | Terraform edge provider |
   | KMS key + backup bucket | outside Render | Terraform cloud provider |
   | Monitoring/alerts, uptime checks | outside Render | Terraform monitoring provider |
   | Render account-level items (workspace members, SSO, audit log streams) | Not in Blueprint (UNVERIFIED). Optional Render Terraform provider (UNVERIFIED) | manual runbook or provider |
3. Never click-ops in production. A manual change is drift. Drift check weekly (`terraform plan` + Blueprint sync status).

Vendor choices in `main.tf` (Cloudflare, AWS) are examples. ADR needed. Data-region rule applies to every vendor.

## Region pin
- Blueprint: every resource `region: frankfurt`. Immutable for Postgres after create.
- Terraform: `var.region` with a `validation` block. Only `eu-central-1` allowed (GATE-REGION default, Israel region UNVERIFIED).
- Policy: `examples/policy/render.rego` denies other regions. Same rule in `policy-tf` for plans.
- Change of region = ADR + data migration plan. Not a config edit.

## Policy-as-code checks
| Check | Tool | Rule |
|---|---|---|
| Blueprint schema | `render blueprints validate` | valid |
| Blueprint policy | conftest + `render.rego` | region, private DB, no `commit` deploy, protected services `off`, health check, preDeploy, no literal secrets |
| Terraform | `terraform fmt/validate`, Trivy config | no public buckets, encryption, key rotation |
| Dockerfile | hadolint, Trivy | non-root, pinned base |
| Actions | pinact/zizmor | pinned SHAs, least privilege |

State: remote encrypted backend with lock. State holds no secrets from the app. Apply needs approval in `production-infra`.
