# 05 - Release strategy

## Trunk-based + feature flags
- Merge small changes to `main` often. Unfinished work hides behind flags.
- Flags are config (env var or DB table), typed, with owner and expiry date. Evaluate server-side. No third-party flag SaaS in Phase 1 (data region).
- Flag kinds: release (remove in 30 days), ops kill switch (long life), permission/role flag. Phase 2/3 features exist only as off flags (ports/hooks).
- Dark launch in staging first, then prod flag on for a role group, then all.

## Two pipelines
| | Public site | Protected area |
|---|---|---|
| Services | `ari-public` | `ari-api` (serves API and SPA), crons, DB (C-04; no `ari-app`, no `ari-internal`) |
| Trigger | Render `checksPass` on `main` | GitHub Action after approval |
| Approval | none (PR review is the control) | `production-protected`: 2 reviewers, not the author |
| Content edits (CMS) | PR to `main`, same path, preview first | n/a |
| Rollback | Render rollback or `git revert` | Render rollback API, auto on failed smoke |
| Window | any time | weekdays, not Friday afternoon (israel time), emergency exception with note |

Public site build must not need the DB or any secret. A failure in the public site never blocks the API (REQ-053).

## Auto-rollback rules
Run for 15 minutes after each protected deploy (in `deploy-protected.yml` and monitored by A9 alerts):
| Signal | Threshold | Action |
|---|---|---|
| Health check fails after deploy | at deploy | Render keeps old version. Workflow fails |
| `/readyz` version never matches SHA | 15 min | rollback |
| 5xx rate | > 2% for 5 min | rollback |
| p95 latency | > 2x baseline for 10 min | alert, human decides |
| Audit-chain verify fails | any | stop, page, no auto rollback (data issue) |
| Migration fails | at deploy | deploy aborted. Fix forward |
Thresholds are initial. A9 owns SLO tuning.

## Approval gates (protected area)
1. CI green on exact SHA.
2. Staging runs the same SHA and e2e pass.
3. Environment approval by 2 reviewers from `@ari-org/release-approvers` (not author).
4. Extra: migrations with contract steps need data-owner approval and a fresh backup ID.
5. Changes to auth, RBAC, audit, RLS need security approval (CODEOWNERS).

## Production access model
- No standing admin. Nobody has permanent write access to the Render production workspace.
- Just-in-time (JIT): a person requests elevated role with a reason and a ticket. A second person approves. Access expires in 1-4 hours. Grant and expiry are logged.
- Render roles: members get Viewer-type access by default (role names UNVERIFIED). Elevation done by workspace owner under break-glass runbook. Render has no native JIT (UNVERIFIED), so process + audit review is the control. Quarterly access review.
- Break-glass: two sealed owner accounts, hardware keys, alert on any login.
- Prod DB access: no direct human access by default. Read access to metadata only via JIT, via bastion-less `render psql` session, logged. No access to sample data for `system_admin` (separation of duties, contract pack section 5).
- Deploy credentials: deploy hooks and API keys live only in GitHub Environment secrets. Rotate every 90 days.
- CI cannot change its own protections (workflow file changes need security review).
- Needs A2 confirmation. See request file.
