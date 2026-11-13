# Operating model

Source: `plan/09-sre/10-operating-model.md`. Short version for the team. No role depends on one person: each has a named deputy.

| Area | Owner | Does the work | Deputy |
|---|---|---|---|
| Public site content (he/en) | Content lead | Editors via the Git CMS. A reviewer approves each PR | Second editor |
| Index freshness | `national_coordinator` | Center coordinators | Deputy coordinator |
| Ingestion and pipelines | Tech lead | On-call engineer | Second engineer |
| Support (accounts, how-to) | Ops lead | Coordinator office, then an engineer | Tech lead |
| Access-request process | Committee chair | Coordinator pre-check, committee | Deputy chair |
| Security and privacy | Privacy lead | Security lead, tech lead | Deputy |
| Releases and SLOs | Tech lead | Engineers | Second engineer |
| Cost, vendors, contracts | Operator lead (assumed Tech4Cancer) | Ops lead | Legal |

## Cadence
- Weekly: DORA report (workflow `dora`), Blueprint drift check, dependency PRs.
- Monthly: metrics review (60 min), restore drill DR-1 on staging, cost line, access review prep.
- Quarterly: DR-2 offsite restore, DR-6 rollback drill, access review, secrets rotation (90 days).
- Yearly: DR-4 region test, DR-5 key custody test, vendor review, policy review (needs legal review).

## Release rules
- Everything is a pull request. Squash merge. `ci-gate` is the only required check.
- Public site: deploys by itself after CI. Protected area: two approvers in `production-protected`. Window: Sun to Thu, 09:00 to 15:00 Israel time. Emergency fixes need the incident commander.
- Pause switch: set repo variable `DEPLOY_PAUSED=true`.
- Freeze when the error budget is 0, during Sev1/Sev2, and on committee meeting days.

## Production access
- No standing admin. Elevated access is time-limited (1 to 4 hours), needs a reason and a second person, and is logged.
- Two sealed owner accounts with hardware keys for break-glass. Alert on any login.
- `system_admin` never reads sample data. Direct production DB access is metadata only, through a logged session.

## On-call and incidents
Severity: Sev1 data exposure or full outage; Sev2 major feature down; Sev3 minor; Sev4 cosmetic. Open a GitHub issue with the `incident` template. Use the runbooks in `docs/runbooks/`. Post-mortem for any impact over 15 minutes. Privacy lead decides whether an event is a breach (needs legal review).

## Handover checklist before real data
Owners and deputies named. On-call rota filled. Runbooks rehearsed once. Drills DR-1, 2, 3, 6 passed. Status page live. Support mailbox live. Render workspace owned by an organisation with 2 owners. GATE-PROD-DATA closed.
