# 09 On-Call, Game Days, Capacity, Cost, Vendor Risk, Exit

## On-call model (ASSUMPTION-06: 3 to 6 engineers)
- One primary on call, one secondary (backup), weekly rotation, hand-off Sunday 10:00 Israel time.
- With only 3 engineers: primary rotates among 3; secondary is the tech lead. If fewer than 3 are available, the operator must add a contractor or reduce the SLO (decision for owner, OPEN-A9-07).
- Hours: business hours (Sun to Thu 08:00 to 18:00 Israel time) for Sev2 and Sev3. Night and weekend paging only for Sev1 and for Sev2 with no workaround. This matches the 99.5% target for the protected area and avoids burnout.
- Response targets: Sev1 ack in 15 min; Sev2 ack in 30 min (business hours) and 60 min (off hours); Sev3 next business day.
- Pager: vendor TBD (ASSUMPTION-A9-04). Escalation: primary, 15 min, secondary, 15 min, tech lead, then executive contact.
- Compensation and time off after a night page: set by the operator (needs HR input).
- Access: on-call has Render access with least privilege, MFA, and a break-glass account kept in the vault. Break-glass use is logged and reviewed in 24 h.
- Handoff note: open incidents, risky changes, scheduled drills. Handoff is 10 min.
- Public holiday and Shabbat: no planned risky work. Night-time Sev1 page still applies.
- Ops training: every engineer runs every runbook once in a game day within 3 months of joining.

## Game days
| Game day | Frequency | Scenario |
|---|---|---|
| GD-1 Bad deploy | Quarterly (with DR-6) | Ship a known-bad build to staging; practice RB-01 |
| GD-2 DB restore | Quarterly | RB-02 on staging with DR-1 or DR-2 |
| GD-3 Identifier in logs | Twice a year | Plant a fake identifier in staging logs; run RB-03 |
| GD-4 Key leak | Twice a year | Fake leaked secret; run RB-04 and rotate |
| GD-5 Region outage tabletop | Yearly | Walk RB-08; DR-4 builds the stack |
| GD-6 Audit-chain break | Yearly | Alter a staging row; run RB-07 |
| GD-7 Pager test | Monthly | Fire a test alert; check ack path |
Each game day: 90 min, scribe, gaps become tickets. Production is not touched by game days.

## Capacity planning
Expected load is small: a few hundred researchers, a few dozen staff, an index of thousands to tens of thousands of records (assumption; no real figures yet, OPEN-A9-08).
| Resource | Plan |
|---|---|
| API | Start with 1 small paid instance; move to 2 instances once protected area has real users (zero-downtime deploys and failover for one instance dying). Check Render's rules about scaling and single instance (UNVERIFIED). |
| Database | Paid instance with enough RAM to hold the working set (full-text index + trigram index). Disk autoscale on if offered (UNVERIFIED). Watch connections; use a small pool; add pooling only if needed. |
| Search | Postgres FTS + `pg_trgm`. Revisit at 100k records or p95 over 800 ms. |
| Static sites | CDN; bandwidth check monthly |
| Load test | k6 before go-live: 50 concurrent users, searches mixed with request flow; run again each quarter and before a center is onboarded |
| Triggers to review | CPU over 70% for a day; memory over 80%; DB disk over 70%; p95 above SLO |

## Cost planning
GATE-BUDGET is unknown. Cost drivers (qualitative): Render DB instance size and HA standby; API instance count; Pro workspace seat cost (needed for 7-day PITR, F1); preview environments; observability vendor (volume of logs and traces); uptime and pager vendors; offsite storage with object lock and a second bucket; egress.
| Option | Content | Risk |
|---|---|---|
| Lean | 1 API instance, DB without HA, Pro workspace, nightly offsite dump, free-tier probes, 30-day logs | RTO up to 4 h at instance loss; brief outages on deploy mistakes |
| Recommended | 2 API instances, DB with HA if available (F5), paid probes with 3 regions, pager, 30-day logs, second offsite bucket | Higher cost; meets ASSUMPTION-05 more safely |
Rule: never cut backups, audit, or the external probe to save money. Cut previews, log volume, or trace sampling first. Cost review is part of the monthly review. Budget alert on Render and vendors at 80% of plan.

## Dependency and vendor risk
| Dependency | Risk | Mitigation | Exit |
|---|---|---|---|
| Render (hosting, DB, CDN) | Outage, plan change, region lack, lockout | Offsite backup, Blueprint, DR-3, probes outside Render | Move to other host or Base44; standard stack, SQL migrations, S3 API |
| GitHub | Outage, account loss | Mirror to second remote; protected admin accounts | Any Git host; CI notes are host-neutral |
| Object store | Data loss, key leak | Versioning, object lock, write-only key | Any S3-compatible |
| Email (SMTP) | Delivery failure, leak of contact data | Two providers configured; no clinical content in mail | Swap adapter |
| Observability, pager, uptime vendors | Outage, data residency | No identifiers in telemetry; separate from Render | Swap; OTel is vendor-neutral |
| Domain registrar and DNS | Hijack, expiry | Registrar lock, MFA, expiry 2+ years, alerts AL-20; DNS provider separate from Render | Move DNS |
| npm packages | Supply-chain attack | Lockfile, `pnpm audit`, pinned versions, SBOM, Dependabot, minimal packages | Replace package |
| Decap CMS | Unsupported | Content is plain Markdown/JSON in Git | Any CMS |
| People | Key person gone | Runbooks, two key holders, docs | Cross-training |
Vendor review yearly: security posture, DPA status, region, incidents, price. Needs legal review for the DPA.

## Exit plan (leave Render)
1. Keep portable: standard Node, standard Postgres, plain SQL, Docker-free build commands or a Dockerfile that runs anywhere, S3 API only.
2. Keep exports: weekly full export in the portable format (A3) in the offsite bucket.
3. Time to exit target: 2 weeks to a new host for the whole stack on synthetic rehearsal; DR-3 proves the core path.
4. Triggers: failed compliance check, region unavailable, repeated Sev1 caused by the platform, price change beyond budget, Base44 decision.
5. Process: the same as `06-cutover-base44.md`, with a different target.

## Verification backlog (UNVERIFIED facts to close before GATE-PROD-DATA)
| ID | Task | Owner |
|---|---|---|
| V-01 | Confirm PITR window for our workspace plan in the dashboard (F1) | A9 |
| V-02 | Measure real PITR restore time and RPO in DR-1 | A9 |
| V-03 | Confirm HA availability, failover time, cost for our DB tier (F5) | A9 |
| V-04 | Confirm Render regions list and DPA data location terms (F10) | A2 |
| V-05 | Test health check and zero-downtime behavior on a failing deploy (F9) | A7 |
| V-06 | Confirm log stream providers and whether HTTP request logs can be filtered (F6) | A9 |
| V-07 | Confirm metrics stream availability on our plan (F7) | A9 |
| V-08 | Confirm auto-deploy option names, rollback and skip-deploy behavior (F8) | A7 |
| V-09 | Confirm Render breach-notice duties in DPA | A2 + legal |
| V-10 | Confirm Render SLA terms for our plan | A9 |
| V-11 | Confirm legal breach timelines (Israel, GDPR if applicable) | Legal |
