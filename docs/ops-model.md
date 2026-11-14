# Operating model

Short version for the team. Full design: [`plan/09-sre/10-operating-model.md`](../plan/09-sre/10-operating-model.md). Roles and the rota are assumptions until the operator is chosen (GATE-OPERATOR).

## Owners

No role depends on one person. Each role has a named deputy.

| Area | Owner | Does the work | Deputy |
|---|---|---|---|
| Public site content (he/en) | Content lead | Editors through the Git CMS. A reviewer approves each PR | Second editor |
| Index freshness | `national_coordinator` | Center coordinators | Deputy coordinator |
| Ingestion and pipelines | Tech lead | On-call engineer | Second engineer |
| Support (accounts, how-to) | Ops lead | Coordinator office, then an engineer | Tech lead |
| Access-request process | Committee chair | Coordinator pre-check, committee | Deputy chair |
| Security and privacy | Privacy lead | Security lead, tech lead | Deputy |
| Releases and SLOs | Tech lead | Engineers | Second engineer |
| Cost, vendors, contracts | Operator lead (assumed Tech4Cancer) | Ops lead | Legal |

## Cadence

| Interval | Tasks |
|---|---|
| Weekly | DORA report (workflow `dora`), Blueprint drift check, dependency PRs |
| Monthly | Metrics review (60 min), restore drill DR-1 on staging, cost review, access review preparation |
| Quarterly | DR-2 offsite restore, DR-6 rollback drill, access review, secrets rotation (90 days) |
| Yearly | DR-4 region test, DR-5 key custody test, vendor review, policy review (needs legal review) |

## Release rules

- Every change is a pull request. Squash merge. `ci-gate` is the only required check.
- Public site: deploys after CI.
- Protected area: two approvers in the GitHub Environment `production-protected`. Window: Sunday to Thursday, 09:00 to 15:00 Israel time. Emergency fixes need the incident commander.
- Free demo: manual deploy in the Render Dashboard.
- Pause switch: set repository variable `DEPLOY_PAUSED=true`.
- Freeze when the error budget is 0, during Sev1 or Sev2, and on committee meeting days.

## Production access

- No standing admin. Elevated access is time-limited (1 to 4 hours), needs a reason and a second person, and is logged.
- Two sealed owner accounts with hardware keys for break-glass. Alert on any sign-in.
- `system_admin` never reads sample data. Direct production database access is metadata only, through a logged session.

## On-call and incidents

| Severity | Meaning |
|---|---|
| Sev1 | Data exposure or full outage |
| Sev2 | Major feature down |
| Sev3 | Minor issue |
| Sev4 | Cosmetic |

1. Open a GitHub issue with the `incident` template.
2. Follow the runbook in [`runbooks/`](runbooks/README.md).
3. Write a post-mortem for any impact over 15 minutes.
4. The Privacy lead decides whether an event is a breach (needs legal review).

## Handover checklist before real data

- [ ] Owners and deputies named.
- [ ] On-call rota filled.
- [ ] Runbooks rehearsed once.
- [ ] Drills DR-1, DR-2, DR-3 and DR-6 passed.
- [ ] Status page live.
- [ ] Support mailbox live.
- [ ] Render workspace owned by an organisation with 2 owners.
- [ ] `GATE-PROD-DATA` closed.
