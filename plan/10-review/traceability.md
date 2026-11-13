# R2 — Traceability and Consistency Review

Reviewer: R2. Date: 2026-11-13. Scope: plan folders 01..09 and `plan/requests/`.
No plan file was edited. Companion files in this folder:
- `traceability-matrix-draft.csv` (72 rows; columns as requested).
- `register-draft.csv` (all GATE, ASSUMPTION, OPEN IDs, one row each, plus 4 duplicate notes).

All numbers below come from scripts (Python, grep, Node, PostgreSQL 16.15), not from reading by eye.

## 1. Result in short
- All 72 REQs have a design element.
- 63 of 72 REQs have at least one TC. 9 have none.
- 26 conflicts found: 2 Critical, 6 High, 10 Medium, 8 Low (list in section 3).
- Every YAML, JSON, CSV and Mermaid block parses. The SQL applies.
- The OpenAPI file and the other docs do not agree on the request states, health endpoints, cookies and session timeouts.

## 2. Requirement coverage (check 1)
Method. Script `req.py`: parse REQ rows in the pack, the catalog (`04/03`), and `08-vnv/test-catalog.csv`. Then scan all design folders for REQ IDs.

| Check | Result |
|---|---|
| REQ rows in pack | 72 |
| REQ rows in catalog | 72 (same IDs; priority and phase match the pack, 0 mismatches) |
| TCs in catalog | 112 (no duplicates, all TC IDs referenced in docs exist, all `req_id` values valid) |
| REQs with a TC | 63 |
| REQs with a design element | 72 (64 cite the REQ ID in a design folder; 8 found by topic only) |
| Matrix status | covered 35; covered-with-conflict 22; covered-design-untagged 6; hook-only-no-test 5; phase0-no-test 4 |

### 2.1 REQs with no TC (gap G-1)
| REQ | Phase | Why no TC | Fix |
|---|---|---|---|
| REQ-049 | 0 | Legal review task | Add manual evidence TC (GATE-COMPLIANCE) |
| REQ-050 | 0 | DPA | Add manual evidence TC (GATE-PROD-DATA) |
| REQ-052 | 0 | Region decision | Add manual evidence TC (GATE-REGION) |
| REQ-061 | 0 | Phase 0 outputs | Add manual review TC (GATE-SCHEMA) |
| REQ-057 | 2 | Hook only | Add flag-off test for the pathology port |
| REQ-059 | 2 | Hook only | Add test that the OIDC adapter slot is off |
| REQ-060 | 3 | Hook only | Add test that no partner route is built |
| REQ-064 | 2 | Scope and exit | Add roadmap-review TC |
| REQ-065 | 3 | Scope and exit | Add roadmap-review TC |

Note. `08-vnv/05` section 1 says the `trace-check` job fails when a Phase 1 REQ has no TC. All Phase 1 REQs have one, so that rule passes. Phase 0 REQs (049, 050, 052, 061) are not Phase 1, so they escape the rule. The release exit criteria for Phase 0 name them. Add TCs anyway.

### 2.2 REQs where no design doc cites the REQ ID (gap G-2)
REQ-005, 008, 010, 013, 061, 062, 063, 064. A matching design exists for 005, 010, 013 (search design, schema, OpenAPI `createRequest`). It is only untagged. REQ-008 depends on the "unified collection-protocols document". That document is not in the plan (gap G-8). REQ-061 to 064 are process or phase items owned by A4.
REQs cited by one design doc only: REQ-004, 006, 009, 012, 023, 026, 029, 055, 056, 058, 003. They are thin but present.

### 2.3 Other traceability gaps
- G-3. `openapi.yaml` has no `x-roles`, `x-scope` or `x-audit`. A8 (`A8-to-A1`) and A2 (`A2-to-A1`) require them for the authz matrix. Only 16 `additionalProperties` entries exist; A2 asks for `false` on all request bodies.
- G-4. A2 requested these items from A3. None is in the SQL or OpenAPI: `donor_ref`, `code_block`, schema `agg`, `center.local_url_template`, `schema-allowlist.json`. Without `local_url_template` the GATE-CLINICIAN-ID link-out has no data field (REQ-015, 037, 039).
- G-5. A7 pipeline and Blueprint miss items other agents depend on: crons for retention/purge, approval expiry, aggregate snapshot, identifier scanner, audit anchor, staging cleanup (A2, A3 asks); the `DEPLOY_PAUSED` variable (A9; only in `09-sre/05`); the `trace-check` job.
- G-6. No DDL for sessions, TOTP secrets, WebAuthn keys, invitations, outbox. A1 lists them (`04-data-ownership.md`). A3 says the auth adapter owns schema `authn`. No file defines them.
- G-7. Missing ADRs: same-origin and API routing; DB role model and SQL-function portability (A3 asked A1); ADR-205 key service (proposed in `06-crypto-secrets.md`, no file); A7 vendor choice (`04-iac.md` says "ADR needed"); ADR for `openapi-typescript` (ASSUMPTION-A6-01).
- G-9. `04-user-stories-phase1.md` defines 56 stories. IDs US-007..009, 018..019, 028..029, 043..049, 058..059, 065..069, 074..079 do not exist (27 gaps). No broken references. A8 asked for TCs for "US-001..US-083". Confirm the numbering is intentional.
- G-11. Hebrew text exists in only 24 files, mostly A5. A4 and A6 have no Hebrew strings for their UI. See section 6.

## 3. Conflicts (check 2)
Severity: Critical = blocks build or breaks a binding rule. High = causes rework in two or more folders. Medium = local rework. Low = cosmetic.
"Winner" is the version that should be kept. "Why" gives the reason.

| ID | Sev | Conflict (evidence) | Winner and why |
|---|---|---|---|
| C-01 | Critical | **Request state enums differ.** A4 `REQUEST_STATES` = cart, submitted, pre_check, needs_more_info, committee_decision, rejected, appeal_review, center_coordination, mta_dta, delivery, closed + `CLOSE_REASONS`. A3 SQL `request_status` and OpenAPI `RequestStatus` = draft, submitted, precheck, needs_info, committee_review, approved, rejected, center_coordination, agreements, delivery, delivered, withdrawn, closed. A3 `step_key` has 8 values. A5 mockup shows "Step 3 of 6", A5 `05-ux-writing` has 8 statuses, A5 `04-accessibility` says "of 8". A6 routes use `precheck`. A4 says `withdrawn` and `expired` are close reasons; A3 makes `withdrawn` a state. `appeal_review` is absent from SQL. | **A4 owns the content** (appeal, close reason, item states) and the enum must live once in `packages/contracts`. Keep the token spelling that five docs already use (`precheck`, `needs_info`, `committee_review`). A3 regenerates SQL and OpenAPI. A5 adds a table that maps states to the displayed stages. A4 asked A1 to reuse the enums; A3 did not. |
| C-02 | High | **Session timeouts: four values.** A2 `05-identity-access.md`: idle 15 min (staff) / 30 min (researchers), absolute 4 h (admin) / 8 h (others), step-up `mfa_age` <= 5 min. A1 ADR-004: idle 30 min, absolute 12 h. A6 `04-protected-app-security.md`: idle 15 min, absolute 8 h, step-up 10 min. A8 `02-security-verification.md`: idle 30 min, absolute 8 h. | **A2.** A1 and A6 both say "A2 sets final". Update ADR-004, A6 values, A8 test thresholds. |
| C-03 | Critical | **Cookie and origin model.** Names: `ari_session` (A3 `07-api-conventions`), `__Host-sid` (A2), `__Host-ari_sid` + `__Host-ari_csrf` (A6). SameSite: Lax (A1, A2, A8) vs Strict (A3, A6). Hosts: A1 ADR-001 = `www.`, `app.`, `api.` (cross-origin). A6 = SPA and API on one host (`/api/*`). A7 `render.yaml` = one host `portal.example.org`, but `ari-app` has no `/api` proxy route. A7 deploy workflow checks `/healthz` on staging and `/api/healthz` on prod. A3 OpenAPI server `portal.example.invalid/api/v1`. A6 says Render static-site proxy to API is UNVERIFIED. | **A6 model** (same origin, `__Host-` cookies, no CORS). It is the only model that works with `__Host-` and Strict. A2 and A6 agree on the cookie name `__Host-ari_sid`; A3 and A2 text change. Needs an ADR. Fallback if Render cannot proxy: API service serves the SPA files. That changes A1 topology and A7 Blueprint, so decide before coding. |
| C-04 | High | **Render topology.** A1 (`05-render-topology.md`, ADR-001): `ari-public`, `ari-app`, `ari-api`, `ari-db`; 3 crons (staleness, retention, export-check); no private service in Phase 1; one API instance at first. A7 `render.yaml`: `ari-public-site`, `ari-app`, `ari-api` (2 instances), `ari-db`, private service `ari-internal`, 3 crons (staleness, backup-export, audit-verify). A9 adds offsite backup 02:00, hourly audit export, daily freshness. A2 and A3 add approval-expiry, nightly purge, aggregate snapshot, identifier scanner, anchor. A1 diagram puts the public API inside the "private network" box. | **A7 for the Blueprint** (executable, validated shape). A1 renames to `ari-public-site`, adds or drops `ari-internal` explicitly, and the crons become one consolidated table (see C-16). A1 keeps the architecture rationale. |
| C-05 | High | **Health endpoints.** A7: `/healthz` = DB + migration level (readiness), `/livez`. A9: `/healthz` = liveness, `/readyz` = readiness, Render check path = `/readyz`. A6 route table: `/health`. A7 `render.yaml` `healthCheckPath: /healthz`. None is in OpenAPI. A7 workflow reads a JSON `version` from `/healthz`. | **A9 semantics** (`/livez` or `/healthz` = process, `/readyz` = DB + migrations, plus `version` in JSON). A7 changes `healthCheckPath` to `/readyz`. A3 adds them to OpenAPI outside `/api/v1`, or routes them under `/api/` for same-origin. |
| C-06 | High | **DB roles and schemas.** A1: `app_runtime`, `app_migrator`, `app_readonly_report`, `app_admin_break_glass`, `app_audit_writer`. A2: `app_owner`, `app_api`, `app_audit_writer`, `app_readonly_bg`; schemas `public` + `agg`. A3 SQL (tested): `portal_external`, `portal_clinician`, `portal_app` and more; schemas `portal`, `audit`, `search`, `ext`; no `agg`. Audit table: `audit.audit_events` (A3) vs `audit.entry` (A2). Context keys `app.user_id`, `app.center_id`, `app.role` match across A1, A3, A8. | **A3 SQL as base** (it runs and passes `test_rls_k.sql`). A2 owns the policy and adds `app_audit_writer`, a migrator and a break-glass role, and the `agg` schema (G-4). A1 doc 04 updates names. One table name for audit. |
| C-07 | High | **Retention periods.** Request records: 7 y after close (A3 `08-retention`), life + 7 y (A2 `07-audit-log`), form text and files 24 months after close (A4 ASSUMPTION-407). Backups: 35 d (A3, A9), 30 d logical export (A1 NFR-BCK-04), Render PITR 7 d (A9 F1). Audit 7 y in A1, A2, A3 (consistent). Public-form messages 30 d after delivery (A6) not in A3 table. Evidence >= 7 y (A8). | **A2 decides, A3 table is the base.** Reconcile A4: wipe free text at 24 months, keep the structured request 7 y (A3 already wipes free text first). A1 changes 30 d to 35 d. Add public-form messages to A3 table. All need legal review. |
| C-08 | Medium | **k floor.** ADR-201 says k never below 5 "forbidden in code". SQL `k_policies.k` has `CHECK (k >= 2)`. | **A2.** Change CHECK to `k >= 5`. |
| C-09 | Medium | **Suppression wording.** A2 `03-adr-201`: UI says "counts below 5 are hidden". A5: never print `<k` or the number ("Too few to show"). A6: no number (OPEN-A6-05). A3 OpenAPI `label` example `"<5"`, `"5-9"` and `search.count_label`. | **A5 and A6** (no number; avoids helping differencing). A2 closes OPEN-A5-03 / OPEN-A6-05 as "no number". A3 removes the `<5` example. Count banding stays an open A2 decision. |
| C-10 | High | **Endpoints used by docs but not in OpenAPI.** `/me`, `/session`, `/session/extend`, `/client-errors`, `/csp-report`, `/public/forms/{join|contact}`, `/request-cart` (A6); `/search/counts` GET (A4); `GET /search/aggregates` (A8) and `POST /search` (A9) vs `POST /search/aggregate` (A3); health endpoints. OpenAPI has `/auth/session`, A6 uses `/session`. A8 authz matrix (7 rows) uses operationIds that do not exist (`searchAggregates`, `createAccessRequest`, `getAccessRequest`, `decideRequest`, `listAuditEvents`) and `PUT /samples/{id}` where the spec has `PATCH`. OpenAPI parses; 69 `$ref` all resolve; 51 operations. | **A3's OpenAPI is the contract.** A3 adds A6's endpoints (`/me`, session, forms, client-errors, csp-report). A4, A8, A9 rename to `searchAggregate` / `POST /search/aggregate`. Cart = request draft (`status=draft`), not `/request-cart`. |
| C-11 | Medium | **Audit action names.** A2 list: `sample.view`, `request.decide`, `authz.deny`, `export.create`. A4 stories: `sample.viewed`, `request.committee_decided`, `authz.denied`, `export.created`, `identity.*`, `governance.*`, `search.executed`, `sample.created`. | **A2** owns the catalog. A4 renames in stories and TCs. |
| C-12 | Medium | **Search latency and scale.** A4 NFR-001: p95 < 1 s at 50,000 records. A8 and A9: p95 < 800 ms at 50k. A1 NFR-PRF-04: 800 ms at 100,000. LCP: A6 lab <= 2.0 s, A1 <= 2.5 s p75, A4 < 2.5 s (compatible). | **800 ms** (A1, A8, A9). Test at 50k, design to 100k. A4 updates NFR-001 and checklist 07. |
| C-13 | Medium | **`ethics_approval_ref` pattern.** A3 `^[A-Za-z0-9._/-]{3,64}$`. A2 `^[A-Z0-9][A-Z0-9\-\/]{2,39}$`. A8 synthetic `SYN-IRB-####`. A5 mockups `SYN-0000`. `collection_month` year: A3 1980-2099, A2 `\d{4}`. | **A3** (schema owner). A2 aligns the pattern doc. A8 and A5 samples must match A3's regex. |
| C-14 | Medium | **Staleness policy.** A3: SLA 180 d, warn 30 d, hide from ordering at SLA + 90 d. A4 ASSUMPTION-406: `stale_after_days` 180, `reminder_days` 7, `escalate_days` 21, `hide_after_days` 60 after first reminder. A9 `08-runbooks`: silent 30 d / 60 d. Cron cadence: weekly Mon 06:00 UTC (A3) vs daily (A7, A9). | **A4** owns the workflow values (they are data in `workflow_config`). A3 aligns `staleness_policies` defaults. Cron stays daily; digest weekly. |
| C-15 | Medium | **CI check names.** A8 required checks (16 names, `05-traceability-dod.md` s7): `lint-types`, `arch-deps`, `property`, `integration-pg`, `contract-schemathesis`, `sast-codeql`, `container-scan`, `canary-smoke`, `e2e-smoke-he-en`, `trace-check`, others. A7 `ci.yml` jobs: `setup-lint-type`, `unit`, `architecture`, `openapi`, `migration-dry-run`, `build`, `secret-scan`, `dependency-license`, `sast-semgrep`, `iac-scan`, `a11y-lighthouse`, `ci-gate`. Seven required checks have no A7 job; `trace-check` is absent. A7 CodeQL is in a separate workflow. Render "After CI Checks Pass" only works if the checks exist. | **A8 names** (they are the quality gate). A7 maps or renames and adds missing jobs. |
| C-16 | Medium | **Cron set and schedule.** See C-04 for services. Audit verify: hourly (A7, A2) vs nightly (A9 request). Staleness: see C-14. | **A2** (hourly verify; nightly purge). A7 owns one consolidated table of all crons. |
| C-17 | Medium | **ADR numbering and duplicates.** No numeric collision. But: ADR-006 (A1) and ADR-A6-001 (A6) both decide the CMS. A6 says the orchestrator may renumber. A2 reserved 201-209 and uses only 201 and 205 (205 has no file). Pack format is `ADR-###`; `ADR-A6-001` breaks it. A6 adds an OAuth proxy and a Sveltia exit path that ADR-006 lacks. | **Keep A6's analysis**, publish it as the single CMS ADR (supersedes ADR-006 text), number it in A1's series (for example ADR-011). Create the missing ADR-205 file. |
| C-18 | Medium | **ID schemes.** Pack: `OPEN-###`, `ASSUMPTION-##`. Used: `OPEN-4xx` (A4), `OPEN-A3-xx`, `OPEN-A5-xx`, `OPEN-A6-xx`, `OPEN-A7-01`, `OPEN-A8-xx`, `OPEN-A9-xx`, `OPEN-LOGO-PERMISSION`; `ASSUMPTION-4xx`, `ASSUMPTION-A#-xx`, `ASSUMPTION-S1..S5`. Four topic duplicates (see `register-draft.csv`, rows DUP-01..04). | Keep the agent prefixes during the review. The orchestrator assigns global IDs in `decision-register.md` using the register draft. |
| C-19 | Low | **Backup RTO scope.** Pack and A4: RTO 4 h. A9: region loss RTO 8-24 h (stated as RISK-A9-01). A9 lean plan: one API instance; A7: two. | Keep. Already flagged by A9. Owner must accept RISK-A9-01. |
| C-20 | Low | **Brand line.** Pack `ARI-PST × Tech4Cancer`. ASCII `x` appears in 3 logo SVGs, `tokens.css` and 7 mockups (some also have `×`). | Use `×` in visible text. |
| C-21 | Low | **i18n key shape.** Pack: `area.screen.element`. A5: `tracker.status.needsInfo` (camelCase leaf). A6 asked for `requests.tracker.stage.<stage>.<state>`. A3: `search.filters.<facet>.<value>`. | A6 shape, because it keys on the C-01 states. A5 renames. |
| C-22 | Low | **Hebrew term variants.** See section 6. | See section 6. |
| C-23 | Low | **Deploy health URL mismatch inside A7.** Staging `/healthz` at root, prod `/api/healthz`. | Follow C-05 and C-03. |
| C-24 | Low | **Index size assumption.** A1 100,000 records; A4 and A8 50,000; A9 "thousands to tens of thousands". | Document 100k as design max. |
| C-25 | Low | **Gender and quote forms.** `רכז/ת` (pack, A5 tracker text) vs `רכז`/`רכזות` (A5 buttons, A8 UAT). | See section 6. |
| C-26 | Low | **A3 `SameSite` text in `03-data-integration/openapi/openapi.yaml` line 63 vs A2.** Part of C-03. | See C-03. |

Count by severity: Critical 2 (C-01, C-03). High 6 (C-02, C-04, C-05, C-06, C-07, C-10). Medium 10 (C-08, C-09, C-11, C-12, C-13, C-14, C-15, C-16, C-17, C-18). Low 8 (C-19..C-26).

### 3.1 Checked and consistent (no conflict)
- Role names. Pack s5 names appear as written in SQL `role_name`, OpenAPI `Role`, route table, A4, A5, A8. No variant forms found in code spans.
- `researcher_intl` cannot submit requests. Agreed by A2 (ASSUMPTION-S4), A4 story (`POST /requests` returns 403), A6 route table, A5 wireframe, A8 TC-021, SQL/OpenAPI (`createRequest` is `researcher_il` only).
- Separation of duties. `system_admin` cannot read samples or approve; `committee_member` cannot edit the index. Same in A2, A3 RLS, A5 mockup text, A4.
- k = 5. Pack, A2 ADR-201, A3 search design, A3 test (`ALL CHECKS PASSED`). See C-08 for the SQL floor.
- SLOs 99.9 / 99.5 %, RPO 15 min, RTO 4 h. Same in A1, A4, A7, A8, A9.
- Branch and environment names. `main` = production, `staging` = staging, previews synthetic. A1, A7, A9 agree. GitHub Environment `production-protected` is A7 only; no conflict.
- Frankfurt region everywhere (`region: frankfurt`, `REGION_PIN`).
- Module names (10) used as in pack s6.
- Entity ID prefixes and ULID rule.
- Node/Postgres versions: Postgres 16 everywhere.

## 4. Gates, assumptions, open questions (check 3)
Output: `register-draft.csv`. Method: regex over all text files; one row per ID; definition line chosen by script; owner = folder of the definition.

| Type | Unique IDs |
|---|---|
| Gates (pack s7) | 13 (all 13 appear in the plan; no gate invented by an agent) |
| Assumptions | 39 (6 pack + 33 agent IDs) |
| Open questions | 46 |
| Duplicate notes | 4 (DUP-01..04) |

Findings.
- No exact ID collision across agents. Prefixes (`A3`, `A6`, `4xx`, `S`) keep IDs apart.
- Four topic duplicates (C-18). They should be merged in the decision register.
- Three pack gates are closed or provisional by the owner (2026-11-13): GATE-CLINICIAN-ID, GATE-K, GATE-REGION. GATE-PLATFORM is closed. The register marks them. Legal review is still open for CLINICIAN-ID and REGION.
- Some agents record open points only in prose, with no ID: A1 (no OPEN IDs; open points sit in `requests/A1-to-*`), A2 (uses `LQ-1..LQ-n` legal questions and `RISK-S01..S04`), A9 uses `V-xx` and `F-xx` for facts. These are not in the register. Add them when the orchestrator builds the final register.
- Risk IDs `RISK-S01..S04` (A2) and `RISK-A9-01` (A9) do not follow the pack list `RISK-##`.
- The register `text` column is the source line as extracted. Some rows (for example OPEN-A5-01..04) show a shared line. Read the source file for the full text.

## 5. External facts (check 4)
Method: counted `UNVERIFIED` tags (about 190 across 48 files); sampled claims about Render, laws, standards, and tools.

Good practice found.
- A7 `08-research-log.md` and A9 `00-index.md` list facts with source, date and status.
- A2 `08-compliance-map.md` has a status column (`VERIFIED-SECONDARY`, `UNVERIFIED`).
- Render plan slugs, PITR, HA, regions, rollback and `autoDeployTrigger` are tagged.

Gaps (sample).
1. A6 `06-browser-device-matrix.md`: build floor "Chrome 109, Safari 16.4, Firefox 115" has no source.
2. A5 `02-design-system.md`: font licenses "believed OFL; verify". A5 asks A6 to confirm licenses. Open.
3. A2 `10-never-in-portal...` R17 (Render SOC 2, ISO 27001, HIPAA BAA) cites only "search summary". Needs the official page before the DPA step.
4. A2 `08-compliance-map.md` L1: Amendment 13 in-force date 14 Aug 2025 is "common date"; sources differ. Tagged, but legal must confirm.
5. A1 `ADR-002`: Israel to Frankfurt RTT 60-90 ms is an assumption. Tagged ASSUMPTION. Measure in staging.
6. A1 `08-nfr.md`: load figures (500 users, 20 req/s, 100,000 records) are A1 proposals (ASSUMPTION-A1-01). Not sourced.
7. A9 `01-service-catalog-slo.md`: Render platform SLA terms UNVERIFIED (F5). The SLO may exceed what Render gives.
8. A7 `render.yaml`: Render keys `previewPlan`, `maxShutdownDelaySeconds`, `buildFilter` are "V (secondary)" from a local skill doc. No official page was fetched. All agents state that render.com was blocked.
9. A2 `05-identity-access.md`: Argon2id floor m = 19 MiB, t = 2, p = 1 tagged UNVERIFIED for 2026.
10. A2 `01-threat-model.md` and A8: no source for attack-test success thresholds. These are design targets, not facts.

No untagged claim was found that states an unsourced fact as certain in the checked sample. The sample was about 40 lines chosen by keyword (Render, law names, versions, prices). No prices appear anywhere in the plan.

## 6. Hebrew terms (check 5)
Hebrew appears in 24 files. 97 strings are in `05-ux-writing.md`; the rest are in mockups, the SQL seed, and a few docs.

Consistent.
- בקשה = request; סל הבקשה = request cart; מעקב בקשות = tracker; הוועדה = committee; פורטל = portal; שערי צדק and מדגם as in the pack; פרטיות = privacy.

Inconsistent or risky.
1. `רכז/ת` (pack, tracker) vs `רכז` (cart, UX copy) vs `רכזות מחקר` (A8 UAT). Pick the gender-neutral form `רכז/ת` and use it everywhere.
2. `סל בקשה` (mockup nav, no definite article) vs `סל הבקשה` (body copy and a11y text).
3. Ethics approval: `מספר אישור אתיקה` (coordinator entry) vs `מספר אישור אתיקה/הלסינקי` (cart) vs `הלסינקי` alone. Pick one label per screen role and define it in a glossary.
4. `מדגם` (Madgam, the data source) is also the Hebrew word for "sample (statistical)" and is close to `דגימה` (biological sample). Always show `Madgam (מדגם)` and a gloss on first use.
5. `רמב"ם` uses an ASCII quote in the pack and A4. Typographic `רמב״ם` (gershayim) is the usual form. The pack is binding. Decide once.
6. The pack asks for Hebrew next to English in user-facing docs. A4 stories, A6 route table and A1-A3 have no Hebrew for role names, states or error messages. A5 has no Hebrew for the 11 A4 states (it has 8 tracker statuses).
7. No Hebrew glossary exists. Recommend `plan/05-design-brand/` owner adds one (roles, states, sample types, k message). Not created here (ownership rule).

Role names in Hebrew are not defined for the seven roles. The mockup shows `מנהל ...` for admin but no other role label.

## 7. Artifact validation (check 6)
| Artifact | Tool | Result |
|---|---|---|
| YAML: `openapi.yaml`, `error-codes.yaml`, `import-columns.yaml`, `synthetic-generator.yaml`, 12 files in `07-devops-cicd/examples` (render.yaml, render.staging.yaml, dependabot.yml, 8 workflows) | PyYAML `safe_load_all` | All parse |
| JSON: `lighthouserc.json` | `json.load` | Parses |
| CSV: `test-catalog.csv` | `csv` | 113 lines, 5 columns on every line |
| CSV drafts written here | `csv` | Fixed column counts (matrix 9, register 7) |
| OpenAPI | custom script | 3.1.0; 51 operations; all have `operationId`; no duplicate IDs; 69 `$ref`, 0 unresolved. Spectral not run (not installed). |
| Mermaid | `mermaid@10.9.1` `parse()` in Node with jsdom | 73 blocks, 0 failures. A negative test (2 bad blocks) failed as expected, so the check is live. Parse only; no render or layout check. |
| SQL | PostgreSQL 16.15, empty DB, non-root user | `001` to `004` apply with `ON_ERROR_STOP`; `005_expand_contract_example.sql` applies; seed + `tests/test_rls_k.sql` print `ALL CHECKS PASSED`. `pg_trgm` and `unaccent` available. |
| Terraform, Rego, GitHub Actions semantics, dependency-cruiser config | not run | No tool installed. YAML shape only. |
| HTML mockups, SVG logos, `tokens.css` | not validated | Out of scope. |

Notes from validation.
- SQL: `k_policies` allows k >= 2 (C-08). Roles and schemas differ from A1 and A2 (C-06).
- `render.yaml`: `autoDeployTrigger: checksPass` for the public site and `"off"` for protected services. Consistent with the pack. Key names tagged UNVERIFIED by A7.
- No plan file outside `plan/00-contract-pack.md` sits at plan root. File ownership looks respected (no cross-folder writes seen in file placement).

## 8. Recommended order of fixes
1. Critical: C-01 (state enum, one source in `packages/contracts`), C-03 (same-origin ADR; verify Render proxy).
2. High: C-02, C-05, C-06, C-10 (A3 OpenAPI v1.1 with A6 endpoints and `x-` annotations), C-04, C-07.
3. Medium: align names and numbers (C-08 to C-18).
4. Add 9 TCs (section 2.1) and the missing ADRs (G-7).
5. Create the Hebrew glossary and fix term variants.
