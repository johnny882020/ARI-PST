# 11 — Canonical decisions (Wave 3)

Status: binding for the build. Source: R1 `10-review/red-team.md` and R2 `10-review/traceability.md`.
Rule: this file wins over any agent plan. The Contract Pack points here (§12).
Needs legal review: all retention values and all legal items.

## 1. Conflict resolutions (R2)
| ID | Decision | Reason |
|---|---|---|
| C-01 | **One request-state enum** (below). `withdrawn`, `expired` are `close_reason` values, not states. The stepper shows 8 steps from REQ-034. | Fixes A3/A4/A5/A6 drift |
| C-02 | **Sessions (A2):** idle 15 min staff, 30 min researchers; absolute 4 h admin, 8 h others; step-up MFA age ≤ 5 min. | A2 owns security |
| C-03 | **Same origin.** One host. SPA at `/`, API at `/api/v1`. Cookie `__Host-sid`, `Secure`, `HttpOnly`, `SameSite=Strict` on the API path, plus `__Host-csrf` double-submit token. No CORS in production. | Only model that works with `__Host-` |
| C-04 | **Blueprint = A7's.** Services: `ari-public`, `ari-app`, `ari-api`, `ari-db`, crons. A1 doc 05 updates to match. Instance count: 2 API instances in production, 1 in staging. **Amendment (B5, accepted):** no `ari-app` and no `ari-internal`. One web service `ari-api` serves `/api/v1` and the SPA on one host (needed by C-03). Crons: `ari-cron-staleness`, `ari-cron-audit-verify`, `ari-cron-purge`, `ari-cron-export`. Blueprint at repo-root `render.yaml`. | A7 file is executable |
| C-05 | `/livez` = process alive. `/readyz` = DB reachable + migrations at expected level. Both return JSON with `version`. Render check path = `/readyz`. Served under `/api/` for same origin. | A9 semantics |
| C-06 | **DB roles** (A3 SQL as base): separate `app_migrator` (owns objects, runs migrations only), `app_runtime` (API), `app_audit_writer`, `app_readonly_bg`, `app_break_glass`. Schemas `portal`, `audit`, `search`, `ext`, plus `agg`. Runtime role cannot `SET ROLE` to others. Center scope derives from role assignments, not from a client value. | R1 RT-04 |
| C-07 | **Retention (A2 decides, A3 table base):** request structured record 7 y after close; free text wiped at 24 months; audit 7 y; backups 35 d. All need legal review. | |
| C-08 | `k_policies.k` CHECK `>= 5`. Any change to k needs a second approver. | RT-06 |
| C-09 | UI shows "Too few to show". It never prints the threshold or `<5`. | Helps stop differencing |
| C-10 | **A3 OpenAPI is the contract.** The build adds missing endpoints (`/me`, `/session`, `/session/extend`, `/client-errors`, `/csp-report`, `/public/forms/*`, `/request-cart`, health). A8 authz matrix generates from OpenAPI `x-roles`. | |
| C-11 | **Audit action names (A2 catalog).** | |
| C-12 | Search p95 ≤ 800 ms. Test at 50k records. Design for 100k. | |
| C-13 | `ethics_approval_ref` pattern = A3's. | |
| C-14 | Staleness values live in `workflow_config` (A4 defaults). Cron daily, digest weekly. | |
| C-15 | **CI check names = A8's.** A7 maps its jobs. `ci-gate` stays the single required check. | |
| C-16 | Audit chain verify hourly. Purge nightly. | |
| C-17 | CMS ADR = A6's analysis, numbered `ADR-011` (supersedes ADR-006 text). | |
| C-18 | Global IDs assigned in `decision-register.md`. | |
| C-20 | Visible brand line uses `×`. | |
| C-21 | i18n key shape = `requests.tracker.stage.<stage>.<state>` style. | |

## 2. Canonical request states
```
draft → submitted → precheck → (needs_info ⇄ precheck) → committee_review
committee_review → approved | rejected
rejected → appeal_review → approved | closed(rejected)
approved → center_coordination → agreements → delivery → closed(delivered)
any non-terminal → closed(withdrawn | expired | policy_cancelled)
```
- States: `draft, submitted, precheck, needs_info, committee_review, appeal_review, approved, rejected, center_coordination, agreements, delivery, closed`.
- `close_reason`: `delivered, withdrawn, expired, rejected, policy_cancelled`.
- UI stepper (8 steps, REQ-034): Cart, Submission, Pre-check, Committee decision, Center coordination, MTA/DTA, Delivery, Closed.
- Transitions and votes are enforced **in the database** (not only in the API). One generated enum from `packages/contracts`.

## 3. R1 critical and high findings: disposition
| RT | Severity | Decision | Fix in build wave | Owner |
|---|---|---|---|---|
| RT-01, RT-02 | Critical | One privacy engine (A2 design). Count **distinct donors** (`donor_ref`), not samples. Neighbour/complement rule. Bands under 10. Attack-simulation test in CI. | B1 | Data |
| RT-03, RT-20, RT-26 | Critical | State machine and N-of-M voting enforced by DB triggers/functions. Applicant cannot reopen. Coordinator cannot mark delivered. One vote per member. | B1 | Data |
| RT-04, RT-05 | Critical | Role model C-06. SQL tests run as real non-superuser roles. Fix `ALTER OWNER`, FORCE RLS, `sync_attached_data`, purge. | B1 | Data |
| RT-06 | High | Role grants and `k` changes via definer functions with second approver. `k >= 5`. | B1 | Data |
| RT-07, RT-08 | High | C-02, C-03. One role-capability table generates SQL tests, OpenAPI `x-roles`, route table. | B0 | Platform |
| RT-09 | High | Audit write path: server-side actor, keyed hash chain, denials logged, no global lock bottleneck. | B1/B2 | Data, Backend |
| RT-10 | High | CMS editors work in a fork or a separate content repo. They cannot reach CI secrets. | B4/B5 | Public site, DevOps |
| RT-11 | High | No Cloudflare proxy in Phase 1. Use Render's CDN and TLS. Revisit by ADR. | B5 | DevOps |
| RT-12, RT-13 | High | **Thin Phase 1 slice** first (below). External gates on the critical path. | Roadmap | Orchestrator |
| RT-14 | High | Org-owned Render workspace with 2 owners. Backup plan slug fixed. Restore drill before real data. | B5 | DevOps, SRE |
Medium and low findings: tracked in `decision-register.md` with owner. Accepted risks need an owner decision.

## 4. Thin Phase 1 slice (build order)
1. Auth + MFA + roles + audit.
2. Sample entry (coordinator) + clinician center view.
3. Aggregate search with the privacy engine.
4. Request flow end to end.
5. CSV import and staleness.
6. Public site and CMS.
Each step must pass its gate (AGENT-RUNBOOK G1–G6) before the next starts. Scope cuts allowed: Hebrew editor review, analytics, notifications email polish.

## 5. Role capability decisions (answers to A2/A4 open questions)
- `researcher_intl`: aggregate view and a contact form only. Cannot submit requests in Phase 1.
- `system_admin`: user and config management, request metadata only. Cannot read sample data, approve, or lower `k` alone.
- Full export containing sample rows: break-glass only, two approvers, logged. Not `system_admin` alone.
- Applicant sees `sample_code` after delivery: **no** (default). Needs committee decision.
