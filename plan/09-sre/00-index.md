# A9 SRE — Index and Facts Register

Owner: A9. Binding input: `plan/00-contract-pack.md`. Covers REQ-048, REQ-066, REQ-067, REQ-072.
All data in all examples is synthetic. Items that need lawyers are marked "needs legal review".

## Files
| File | Content |
|---|---|
| 01-service-catalog-slo.md | Services, tiers, SLIs, SLOs, error budgets |
| 02-observability.md | Log schema, redaction, metrics, traces, dashboards, alerts |
| 03-backup-restore-dr.md | RPO/RTO, backups, PITR, drills, DR, region failure |
| 04-monitoring-on-render.md | Render metrics, log drain, uptime checks, deploy alerts |
| 05-safe-release.md | Deploy windows, rollback, stop a bad auto-deploy |
| 06-cutover-base44.md | Later move to Base44 |
| 07-incident-response.md | Roles, severities, comms, privacy-breach path, post-mortem |
| 08-runbooks.md | RB-01 to RB-08 |
| 09-oncall-capacity-vendor.md | On-call, game days, capacity, cost, vendor risk, exit |
| 10-operating-model.md | Post-launch ownership, content, freshness, support, reviews |

## Facts register (web research)
Research date: 2026-11-13. The Render docs host could not be fetched directly from this session (network block). Facts below come from web search snippets of Render docs.

| # | Fact | Source | Status |
|---|---|---|---|
| F1 | PITR window: Hobby workspace 3 days; Pro and higher 7 days. Free Postgres has no PITR. | render.com/docs/postgresql-backups (search snippet), 2026-11-13 | Verified by snippet; re-check in dashboard |
| F2 | Logical backups made by Render are kept 7 days, any plan. Free instances get none. | same | Verified by snippet |
| F3 | PITR is on all paid Postgres instances. | render.com/changelog/added-point-in-time-recovery-to-all-paid-database-instances, 2026-11-13 | Verified by snippet |
| F4 | A PITR restore creates a new database; app must be re-pointed. | Render docs (recalled) | UNVERIFIED |
| F5 | Postgres high availability (standby, automatic failover): plan, failover time, cost. | Render docs | UNVERIFIED |
| F6 | Log streams to external provider (syslog-style endpoint); dashboard log retention depends on plan. | Render docs | UNVERIFIED |
| F7 | Metrics streams (OpenTelemetry-compatible) to external provider. | Render docs | UNVERIFIED |
| F8 | Auto-deploy modes: On Commit, After CI Checks Pass, Off. Dashboard rollback to a prior deploy. Cancel deploy. `[skip render]` / `[render skip]` commit text skips deploy. | Render docs (recalled) | UNVERIFIED |
| F9 | Health check path; zero-downtime deploy waits for it to pass. Failed deploy notifications by email/Slack. | Render docs (recalled) | UNVERIFIED |
| F10 | Render region list includes Frankfurt; Israel region not known. | contract pack GATE-REGION | UNVERIFIED |

Rule: every UNVERIFIED item has a verification task in `09-oncall-capacity-vendor.md` section "Verification backlog".

## ASSUMPTIONs (A9)
- ASSUMPTION-A9-01: Protected DB runs on a paid Postgres instance in a Pro-or-higher workspace (7-day PITR). Hobby is not allowed for production.
- ASSUMPTION-A9-02: Render HA standby is enabled for the production protected DB if plan limits allow (F5). Otherwise the RTO uses PITR restore.
- ASSUMPTION-A9-03: Off-platform backup target is an S3-compatible bucket in an EU region owned by the operator, not on Render.
- ASSUMPTION-A9-04: Notification channels: one chat channel, one e-mail list, one phone/SMS pager service (vendor TBD).
- ASSUMPTION-A9-05: Until GATE-PROD-DATA closes, all environments hold synthetic data. SLOs apply from go-live with real data; before that they are targets for rehearsal.
