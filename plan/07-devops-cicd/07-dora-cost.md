# 07 - DORA metrics and cost guardrails

## DORA (four keys)
| Metric | Source | Target (initial) |
|---|---|---|
| Deployment frequency | GitHub deployments API (`production-protected` and public site Render deploys) | public: daily possible. protected: weekly or better |
| Lead time for changes | first commit time to production deploy success | < 2 days (public), < 5 days (protected) |
| Change failure rate | deploys that needed rollback/hotfix / all deploys | < 15% |
| Time to restore | incident open to close (label `incident`) | < 4 h (matches RTO assumption) |
| Reliability (5th) | SLO from A9 | 99.9% public, 99.5% protected (ASSUMPTION-05) |

Report: `dora.yml` runs weekly, writes a Markdown summary to the job summary and artifact, using `scripts/dora_report.py` (to build). Render deploy events reach GitHub as Deployments only if the Render GitHub integration creates them (UNVERIFIED). Fallback: the workflow records deploys itself via the deployments API.

Small team (3-6 engineers): report is for learning, not ranking people. No per-person metrics.

## Cost guardrails
Costs are plan-based and unknown (GATE-BUDGET). Qualitative drivers: instance count and size, Postgres plan and disk, preview environments, cron instances, build minutes, log retention, egress, WAF/CDN, object storage.

| Guardrail | How |
|---|---|
| Lean option | Public site static (low cost). 1 API instance in staging. Small staging DB. Prod API 2 instances only for protected area |
| Preview cap | `expireAfterDays: 3`, `previewPlan` smallest, previews only for PRs touching `apps/api`, `db`, `infra` (use label `preview` to opt in for others, if manual mode chosen) |
| Teardown | Preview auto-delete on merge/close. Weekly job lists services not in Blueprint (orphans) |
| Policy | conftest denies new services/plans above a cap listed in `infra/policy/budget.yaml` (to build) |
| Review | Cost-affecting changes (plan, instances, new service) need `platform` CODEOWNER |
| Budget alerts | Render spend alert and cloud budget alert (Terraform), monthly review (UNVERIFIED Render alert feature) |
| CI minutes | concurrency cancel, caching, affected-only |
| Autoscaling | off by default. Enabled only with max instance cap (UNVERIFIED limits) |

Cost review is monthly and appears in the DORA report footer as a manual line (no figures invented here).
