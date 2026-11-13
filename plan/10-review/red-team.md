# 10 — Red-team review (R1)

Reviewer: R1. Date: 2026-11-13. Scope: plan folders 01..09 and `plan/requests/`. No plan file was edited.
Style: short sentences. Severity: Critical, High, Medium, Low.

## How I tested
- I read `00-contract-pack.md` first. Then every plan folder and the OpenAPI file.
- I ran `001..004` and `tests/test_rls_k.sql` on a scratch PostgreSQL 16 cluster (`/var/tmp/r1pg`, now removed).
  - Run 1: as superuser (like A3's own test). Result: `ALL CHECKS PASSED`.
  - Run 2: as a normal owner role with `CREATEROLE` (like a managed database owner). Result: migration `003` failed.
  - Attack scripts used the real roles (`SET ROLE portal_external` and so on).
- "VERIFIED" below means I reproduced it on the scratch DB. "READ" means I found it by reading files only.
- Render and Base44 facts are not re-checked. Most are `UNVERIFIED` in the plan itself.

## Summary table
| Severity | Count | IDs |
|---|---|---|
| Critical | 4 | RT-01 to RT-04 |
| High | 10 | RT-05 to RT-14 |
| Medium | 13 | RT-15 to RT-27 |
| Low | 3 | RT-28 to RT-30 |
| Total | 30 | |

---

## Critical

### RT-01 — Differencing defeats k-anonymity in the built SQL (VERIFIED)
- Evidence:
  - `03-data-integration/sql/003_search.sql:101-109` (`total_count`) and `:114-174` (`facet_counts`). Each call checks only its own result.
  - `003_search.sql:39-44` (`count_label`). The label is "5-9", but `openapi.yaml:1126-1133` still returns the exact `count`.
  - `02-security-privacy/02-reidentification-controls.md` sections 1, 5.2, 5.3, 5.7 define a neighbour rule, budgets, epochs, rounding. None exists in SQL, OpenAPI or A3 files. `donor_ref`, schema `agg`, epoch: zero hits in `03-data-integration`.
- Attack run: `total_count(dmg)` = 12. `total_count(dmg, female)` = 8. Subtract: 4 male children, below k = 5. The `sex` facet hides it, but two plain count calls reveal it.
- Impact: an external researcher isolates any cell under k with 2 calls. Core promise REQ-033 fails.
- Fix:
  1. Decide one implementation. Put the neighbour check, cost budget, rounding and snapshot in the code path that the API really calls.
  2. Never return exact counts under 10. Return the band only.
  3. Cap predicates and OR values (A2 numbers). Rate-limit and audit the filter hash.
  4. Add the A2 attack simulation (P-14) as a CI gate. The current test file has no differencing test.
- Owner: A3 (SQL, API) with A2 (rules). A1 to decide where the logic lives.

### RT-02 — Counts samples, not donors. One child can show as "5" (READ + schema check)
- Evidence: `003_search.sql:57` counts rows of `portal.samples`. `001_core.sql` has no `donor_ref`. A2 asked for it (`requests/A2-to-A3.md` item 1). A2 file 02 section 2 says "count distinct donors". Nobody answered in A3 files.
- Impact: one child has FFPE, frozen, CSF, plasma, DNA samples. That is 5 samples and passes k = 5. The cell is one child. A rare tumour in a small country makes this common.
- Fix: add internal `donor_ref` now (schema v1, before data). Count distinct donors. Add a test with one donor and 6 samples.
- Owner: A3. A2 confirms.

### RT-03 — Request governance is not enforced in the database (VERIFIED)
- Evidence: `002_roles_rls.sql:130-133`, `:162`, `:133`.
  - `req_owner` has `USING` on owner only. The `WITH CHECK` only limits the NEW status. An applicant can update a `rejected` or `delivered` request to `submitted`, rewrite `research_question`, and set `delivered_at` (attack T1 worked).
  - `req_coord` is `FOR ALL`. A coordinator sets `status = 'delivered'` with no decision (T7 worked).
  - `dec_committee` is `FOR ALL`. One committee member inserts an `approved` decision with zero votes (T8 worked). The N-of-M rule is only in the API text (`openapi.yaml:522`).
  - A vote can be inserted for any request, even `draft` (no status check in `vote_committee_write`).
- Impact: the approval path (REQ-034, REQ-036) rests on one API layer. The plan says RLS is a second line. For this table it is not.
- Fix: a `BEFORE UPDATE` trigger with the transition table from A4. Make `status`, `decided_at`, `delivered_at` writable only through definer functions. Count votes inside the decision insert. Add recusal. Add DB tests.
- Owner: A3 (SQL) with A4 (transition table).

### RT-04 — Three conflicting DB role models, and the API can become any role (VERIFIED)
- Evidence:
  - A2 `05-identity-access.md` section 5 and `requests/A2-to-A1.md`: roles `app_owner`, `app_api`, `app_audit_writer`, GUC `app.role`.
  - A3 `002_roles_rls.sql:3-6, 25`: login `portal_app` plus `SET LOCAL ROLE portal_*`.
  - A1 `04-data-ownership.md:35`: `app_migrator`.
  - A7 `examples/render.yaml:34, 112, 121`: one database user `ari_app` (the Render owner). The same `DATABASE_URL` serves `migrate:deploy` and the running API. `portal_app` appears nowhere in A7.
- Attacks run: a session that can `SET ROLE` reaches every role, so one SQL injection or one logic bug equals coordinator plus admin plus committee. Any role can call `set_config('app.center_id', other center)` and then reads the other center (T5 worked).
- Impact: if the API runs as table owner, `FORCE RLS` is weak (the owner can alter policies). RLS is the "second line" and it collapses.
- Fix:
  1. Pick one model. Keep A3's `portal_*` roles (it works and is tested).
  2. Separate migration login (DDL, used in `preDeployCommand` only) from the runtime login (`portal_app`). Update `render.yaml`.
  3. Use `SET LOCAL ROLE` only. Add a pool hook that runs `DISCARD ALL` and a lint rule that bans plain `SET ROLE`.
  4. Derive `app.center_id` inside a definer function from `role_assignments`, not from a free GUC.
- Owner: A1 (decide), A3 (SQL), A7 (render.yaml), A2 (update file 05).

---

## High

### RT-05 — Migrations break for a non-superuser owner. The test hides it (VERIFIED)
- Evidence:
  - `003_search.sql:218-220`: `ALTER FUNCTION ... OWNER TO portal_agg` fails with "must be able to SET ROLE portal_agg" for a normal owner. (`CREATE ROLE` gives the creator ADMIN only, no SET.)
  - `002_roles_rls.sql:44-46, 82` and `:67-72`: `FORCE RLS` on `samples` with no policy for the owner. As owner: `INSERT INTO samples` fails (RLS). The `sync_attached_data` trigger (owner, `SECURITY DEFINER`) updates 0 rows. `attached_data` stays `{}` with no error.
  - `03-data-model.md:16` says the test "runs as superuser". `08-vnv/01-test-strategy.md:117` says "never a superuser". These conflict.
- Impact: the build fails at deploy, or (after a workaround) the `attachedData` filter and facet are silently wrong. The retention purge job (migration role) cannot delete samples.
- Fix: `GRANT portal_agg TO <owner> WITH SET TRUE` (or create roles in a bootstrap step by an admin). Add an owner policy or a definer purge function. Make `sync_attached_data` run as a role with a policy. Run all SQL tests as the real non-superuser owner in CI.
- Owner: A3, A8 (test setup), A7 (bootstrap).

### RT-06 — Separation of duties has holes in the database (VERIFIED)
- Evidence:
  - `002_roles_rls.sql:104, 111`: `portal_admin` has `FOR ALL` on `users` and `role_assignments`. Admin created a second user and granted `national_coordinator` (T10 insert worked). The trigger only checks one user. A2's "second approver" (`05-identity-access.md:61`) is not in SQL.
  - `002_roles_rls.sql:54` plus `001_core.sql:320`: admin can `UPDATE k_policies` to `k = 2` alone (T9 worked; the label shows "2-9"). A2 says floor 5 and "committee approves lowering" (`02-...:12`, `05-...:55`). `k >= 2` in SQL contradicts floor 5.
  - `002_roles_rls.sql:95, 103`: a coordinator can set `status = 'active'` on any user, including a suspended admin (T6 worked).
- Impact: one admin plus a sock-puppet account reaches all coordinator data and can sway committee votes. A single admin can weaken privacy.
- Fix: role grants and k changes only through definer functions that need a second user and a fresh step-up. Set the floor `k >= 5` in a CHECK. Limit the coordinator to `invited -> active` for researcher roles only.
- Owner: A3, A2.

### RT-07 — Session, cookie, CSRF and origin rules disagree (READ)
| Topic | A2 | A6 | A1 ADR | OpenAPI | A8 |
|---|---|---|---|---|---|
| Idle timeout | 15 staff / 30 researchers (`05-identity-access.md:24`) | 15 for all (`04-protected-app-security.md:97`) | 30 (`ADR-004:10`) | none | 30 (`02-security-verification.md:98`) |
| Absolute | 4 h admin / 8 h others (`:25`) | 8 h | 12 h | none | 8 h |
| Cookie name | `__Host-sid` | `__Host-ari_sid` (`:70`) | none | `ari_session` (`openapi.yaml:951`) | none |
| SameSite | Lax (Strict staff) | Strict | Lax | none | Lax or Strict |
| CSRF | Synchronizer token | Double-submit cookie, not HttpOnly (`:74`) | none | Header plus `csrfToken` in session body | none |
| Origin | not stated | same origin `app.<domain>/api` (`:8`) | `api.` domain (`ADR-001:10`) | `portal.example.invalid/api/v1` | none |
- Impact: a `__Host-` cookie cannot work across `api.` and `app.`. If A1 wins, the team will drop `__Host-` or relax SameSite. A6's rewrite to a private service is `UNVERIFIED` (`:9`). A6's CSRF cookie is JS-readable and a weaker design than A2's.
- Fix: A2 owns one table. A1 follows it. A6 and A8 copy it. Put timeouts in one config file. Add a contract test that reads the cookie name from that file.
- Owner: A2 (decide), A1, A6, A8, A3 (OpenAPI).

### RT-08 — Role capabilities differ between agents (VERIFIED where marked)
- Evidence:
  - `002_roles_rls.sql:5, 114`: `anonymous`, `researcher_il`, `researcher_intl` share one DB role `portal_external`. It has INSERT on `requests`. So `researcher_intl` can create requests at DB level (A2, A4, A6 all say no). Only the API blocks it. (`request_steps` etc. are also reachable.)
  - A2 matrix: clinician "W own center" for coordination and "verify/flag own" samples. `002_roles_rls.sql:62, 120`: clinician has SELECT only. Devs will widen grants.
  - A2 ABAC and recusal (`05-identity-access.md` sections 3-4) need `user.institution` and `applicant_institution`. `001_core.sql:84-95` has no such column.
  - Votes: committee sees all votes at once (`vote_committee_read USING (true)`). No blind voting. Votes need no `committee_review` state.
  - `/audit-events` is "system_admin only" in OpenAPI (`:684`) but A2 gives own-events to all and data events to coordinator. Outcome enum is `success/denied` in OpenAPI and SQL, `allow/deny` in A2 (`07-audit-log.md` section 1).
  - The owner decision (self-register, then approve) conflicts with A2 `05-...:139` "No self-registration".
- Fix: one role-capability table in the contract pack (generated into SQL tests, OpenAPI `x-roles`, route table). Separate DB roles for `researcher_il` and `researcher_intl`. Add institution to users.
- Owner: A2 (table), A3 (SQL, OpenAPI), A4, A6.

### RT-09 — Audit log: forgeable, serialised, and specified three ways (VERIFIED where marked)
- Evidence:
  - `002_roles_rls.sql:203-204`: every app role may call `audit.append` with a free `p_actor`. An external role forged `request.approve` as the admin (T3 worked). Also a flood fills the chain.
  - `001_core.sql:507`: `SELECT ... FROM audit.chain_head FOR UPDATE` in the business transaction. Every audited action (including each `sample.view`) queues on one row. At 2 API instances this is the throughput cap. Add to that: a hot lock plus long transactions can deadlock.
  - Chain uses plain `sha256` (`001_core.sql:510`) with no key and a different genesis from A2 (`07-audit-log.md` section 2). `render.yaml:22` creates `AUDIT_HMAC_KEY`, which nothing uses. Anyone who can write the table can recompute the whole chain.
  - A3 `08-retention-export-backup.md:15` says audit is partitioned by year. A one-table chain with `PRIMARY KEY (seq)` and a global head cannot be dropped by partition.
  - A2 says audit insert is in the same transaction and fails closed. Then a `denied` or `error` event is rolled back with the failed action and is lost. Table name also differs (`audit.entry` vs `audit.audit_events`).
- Impact: the log can mislead an investigation. That harms REQ-046 and breach response.
- Fix: the app role passes only event type and object. A definer function reads actor and role from the session context. Write denial events in a separate autonomous path (queue or second connection). Use HMAC with a key outside the DB. Shard or batch the head lock. Merge specs into one.
- Owner: A2 (spec), A3 (SQL).

### RT-10 — Content editors can reach CI secrets through the monorepo (READ)
- Evidence: `06-frontend/03-adr-cms-choice.md:43, 52`: CMS authors get "write on repo via branch". The CMS token (GitHub OAuth) normally grants repo write. `07-devops-cicd/examples/config/CODEOWNERS:11` gives `content/` to `content-editors` without engineering review. Code, workflows (`.github/`) and content share one repo.
- Impact: a phished editor pushes a branch that edits a workflow. CI runs same-repo PR jobs with repo secrets. They might reach the deploy hook secrets (only environment-protected ones are safer) or poison the public site.
- Fix: use a content-only repo, or a GitHub App limited to `apps/public-site/content/**` with a path-restricted ruleset. Enforce "workflows from base branch only". Keep deploy secrets in protected environments. Check that previews for `cms/*` branches have no secrets.
- Owner: A6 (CMS), A7 (rules).

### RT-11 — Cloudflare proxy is outside the threat model, region rule and DPA list (READ)
- Evidence: `examples/terraform/main.tf:38, 45` (`proxied = true`) for `www` and `app`. `04-iac.md:15` says "examples. ADR needed". The compliance map and A2 threat model list no CDN as a processor. `08-vnv/02-security-verification.md:82` relies on per-IP limits with no trusted-proxy rule (`trustProxy`, `CF-Connecting-IP`) anywhere in the plan.
- Impact: a global proxy would see passwords, session cookies, and all search traffic. That breaks the Frankfurt pin (GATE-REGION) and needs a DPA and transfer review. The Render `onrender.com` origin may also bypass the WAF (`10-never-in-portal...:114` is `UNVERIFIED`). Rate limits use a spoofable IP.
- Fix: decide first: no proxy for `app.`, or an EU-only, DPA-covered proxy. Block direct origin access (shared secret header or mTLS). Define the trusted-proxy chain in the API.
- Owner: A7, A2, A1 (ADR).

### RT-12 — The schedule is not realistic for 3 to 6 people (READ)
- Evidence: `04-product-workflow/05-roadmap-and-metrics.md:70-77`: build ends at week 16, acceptance at week 18, pilot data at week 26. Scope in Phase 1 (REQ-062 plus owner "fully functional"): bilingual RTL public site and CMS, passkeys plus TOTP, RLS, 7 roles, import wizard, differencing-safe search engine, 11-state workflow with appeals, N-of-M voting, tamper-evident audit, export/import round trip, Terraform plus Render plus Cloudflare, DAST, pen-test, restore drills, Base44 round-trip CI.
- Impact: the team will cut security features first (privacy engine, audit, tests). The plan also has a hard gate (`GATE-PROD-DATA`: DPA, legal, pen-test) that no engineering team controls.
- Fix: cut Phase 1 to a thin vertical slice (see "must fix" list). Plan a 9 to 12 month honest path. Treat external gates (legal, DPA, pen-test) as critical path items with owners now.
- Owner: A4, A1, orchestrator.

### RT-13 — Legal assumptions that may be wrong (READ; needs legal review)
- Evidence: `03-data-integration/08-retention-export-backup.md:20-21`: "nothing to erase per patient". But samples carry `sample_code`, and the center's own system maps that code to a child (link-out, `02-security-privacy/04-two-step-coding...`). `06-governance.md:170`: consent withdrawal only retires the record. The compliance map lists GDPR, PPL, Regulations 2017 and Amendment 13 as `UNVERIFIED` items, and the LQ-1..LQ-4 questions are open.
- Impact: coded health data of children is probably personal data for the operator and the centers (a key exists, even if elsewhere). Gaps: right to withdraw after delivery; re-consent at age 18; who is controller for the index; Israeli database registration; the cross-border path Israel to Frankfurt to Cloudflare; the audit log keeps `actor` ids of researchers (personal data, 7 years).
- Fix: do not state "no personal data" in any user-facing text or DPA until counsel confirms. Add a consent-withdrawal and delivered-sample process. Add a minors and age-18 rule. Put the legal questions on the critical path with dates.
- Owner: A2, A4.

### RT-14 — Backup, RPO and single points of failure do not add up (READ)
- Evidence:
  - `examples/render.yaml:36`: DB plan `basic-1gb`, comment "choose a plan with PITR". `09-sre/03-backup-restore-dr.md:18` needs Pro or higher for 7-day PITR. ASSUMPTION-05 asks RPO 15 min.
  - `03-backup-restore-dr.md:91`: after a region loss the data-loss window is up to 24 h. Real RPO is not 15 min.
  - A3 says backups 35 days. Render keeps 7 days (`03-backup-restore-dr.md:19`).
  - Contract pack section 11: the Render account is "owner's own". Single human holds the platform, the API key, and DB access. `09-sre/09-oncall-capacity-vendor.md:57` mentions "two key holders" with no named process.
  - Single DB, single region, single audit head lock, single SMTP path for invites and recovery (no provider choice or fallback in the plan).
- Fix: put the workspace under an organisation with at least 2 owners before real data. Fix the plan slug and the stated RPO. Add an SMTP fallback. Run restore drill D3 before any real data.
- Owner: A9, A7, A3.

---

## Medium

### RT-15 — Over-engineering and duplicated logic for a small team (READ)
- Evidence: the k-rule exists twice (pure TS in A2 section 8 and plpgsql in `003_search.sql`) with different rules (RT-01). Tools: Render Blueprint plus Terraform plus Cloudflare plus AWS KMS and bucket (`04-iac.md`), OPA/conftest, release-please, commitlint, dependency-cruiser, DORA workflow, Lighthouse, k6, DAST, CodeQL, Base44 round-trip workflow, 70+ pages of Base44 readiness and cutover for a decision that is "TBD". `08-vnv/test-catalog.csv` has 113 lines.
- Impact: effort goes to portability and tooling while the core privacy engine is unfinished. More vendors need more DPAs.
- Fix: one engine (SQL or TS). Keep Blueprint only; add Terraform later. Stop Base44 work until the owner reopens it. Keep the architecture test and the OpenAPI contract; drop the rest for Phase 1.
- Owner: A1, A7.

### RT-16 — Passkeys are tied to the domain. Migration and Base44 claims are weak (READ)
- Evidence: no file mentions the WebAuthn relying-party ID. `01-architecture/07-migration-and-exit-plan.md` and `09-sre/06-cutover-base44.md` plan domain moves. Capability map rows for Base44 are mostly "unknown" and from search snippets (`06-render-vs-base44-capability-map.md:4`).
- Impact: any domain change or move to Base44 voids every passkey. All staff re-enrol at once. Base44 cannot run a Fastify monolith (`:9`, rating gap), so "portable later" is mostly a rewrite of the back end.
- Fix: fix the RP ID to a stable parent domain now. Say plainly in the plan that back-end migration is a rewrite.
- Owner: A2, A1.

### RT-17 — The request flow is a side channel for small cells (READ)
- Evidence: `001_core.sql:352-358` (`criteria`, `requested_count` set by the applicant), `002_roles_rls.sql:141-144`. The cart accepts any criteria. The coordinator resolves them to samples. Status or reply ("no match", "2 samples approved") reveals what the aggregate screen hides. `A4` has no rule for "criteria below k".
- Fix: reject cart items whose filtered set is below k. Use the same band label in all replies. Log the resolved count only for coordinators.
- Owner: A4, A3.

### RT-18 — Timing and analytics side channels (READ + code path)
- Evidence: `003_search.sql:126-130`: when the total is below k the function returns early. Larger sets run a slower path. A2 P-17 says "within tolerance" with no padding design. `05-roadmap-and-metrics.md:112` stores `k_suppressed` and `filter_keys` per search.
- Fix: constant-work path (always run the full query). Add a minimum response time. Aggregate analytics events per day before storage.
- Owner: A2, A3, A4.

### RT-19 — Admin-set link-out template can leak sample codes (READ)
- Evidence: `requests/A2-to-A3.md` item 7: `center.local_url_template` is an https template with `{sample_code}`. Admin changes it with step-up only.
- Impact: a hostile or mistaken template sends every clinician click (code, center, referrer) to a third party, and works as a phishing link inside a trusted screen.
- Fix: allow-list of hosts per center, approved by the center contact and a second admin. `rel=noreferrer`, interstitial.
- Owner: A2, A6.

### RT-20 — `req_clinician` policy bug (VERIFIED)
- Evidence: `002_roles_rls.sql:136-138`: inside the subquery, `id` resolves to `st.id`, so the test is `st.request_id = st.id`. Never true. A clinician sees 0 requests (T4 returned 0). The same file (`:147-149`) uses `request_items.request_id` correctly.
- Impact: center coordination (REQ-034) fails for clinicians. The easy "fix" will be a wider grant.
- Fix: qualify as `requests.id`. Add a test.
- Owner: A3.

### RT-21 — Hard purge breaks on foreign keys (READ)
- Evidence: `001_core.sql:364-370`: `request_item_samples.sample_id REFERENCES samples(id)` with no cascade. Retention (`08-retention-export-backup.md:8`) hard-deletes samples. Also the purge runs as the owner, which has no policy (RT-05).
- Fix: purge function that clears links first, or set `ON DELETE SET NULL` plus a tombstone. Test the purge job.
- Owner: A3.

### RT-22 — Preview environments depend on unverified isolation (READ)
- Evidence: `examples/render.yaml:5-8`, `02-render-deploy-design.md:51-57`. "Previews have no secrets" and fork opt-out are `UNVERIFIED`. The guard `DATA_CLASSIFICATION != synthetic` is an env var that PR code can change. Previews are internet-reachable with real login code.
- Fix: previews use a separate Blueprint or group with dummy SMTP and object store. Disable previews for PRs touching `cms/*`. Verify the Render behaviour in a test PR before real data.
- Owner: A7.

### RT-23 — Supply-chain gaps (READ)
- `workflows/deploy-protected.yml:60` runs `pnpm dlx k6`. k6 is a Go binary. An npm package of that name is not the Grafana tool. This is a typosquat risk at deploy time. Use the official action or a pinned binary with a checksum.
- Example workflows use tags, not SHAs (`03-pipeline.md:47` admits it). Check every `uses:` before first run.
- `deploy-protected.yml:24` trusts `workflow_run.head_sha` and compares to staging `healthz`. A stale or forced staging deploy could pass. Compare the artifact digest.
- The Decap admin page and OAuth proxy are new third-party code on the public origin. Pin, self-host, add SRI.
- Owner: A7, A6.

### RT-24 — Error and log leakage paths (READ)
- `POST /api/v1/client-errors` (`04-protected-app-security.md:37`, `requests/A6-to-A1.md`) is a free-text intake. Stack traces carry URLs and filters. It conflicts with "no free text in logs" (contract pack section 8). Add schema, size and rate limits, and a scrubber.
- `search.aggregate` audit stores a hash of the canonical query (`07-audit-log.md:1`). The query space is small, so a dictionary attack shows who looked for which rare diagnosis. Use a keyed hash (HMAC) and restrict who can read it.
- `request_steps.internal_note` and `research_question` are free text. The "scan on submit" rule has no spec for false negatives. Owner: A2.
- Owner: A6, A2.

### RT-25 — Account recovery is a social-engineering target (READ)
- Evidence: `05-identity-access.md:13`: for researchers and clinicians, one `national_coordinator` re-proofs a user who lost all factors. TOTP (phishable) is allowed for clinicians who hold full own-center coded data (`:12`).
- Fix: two-person recovery for clinicians. Passkey required for clinicians. Out-of-band check with the center contact.
- Owner: A2.

### RT-26 — State names and steps do not match (READ)
- Evidence: A4 `02-access-request-state-machine.md:9-22` (11 states: `cart`, `pre_check`, `needs_more_info`, `committee_decision`, `appeal_review`, `mta_dta`, `closed`). SQL `001_core.sql:38-43` (13 states: `draft`, `precheck`, `needs_info`, `committee_review`, `approved`, `agreements`, `delivered`, `withdrawn`, plus a separate `step_key` enum). Mockup `request-tracker.html:294-295`: "Step 3 of 6" with 6 steps. SQL has no appeal state and no item state (partial approval in A4 section 1 has no table).
- Impact: three vocabularies. The UI, DB and tests will drift. Bugs in transition checks (RT-03).
- Fix: one generated enum in `packages/contracts` consumed by SQL, TS and the tracker.
- Owner: A4 (own), A3, A5.

### RT-27 — Full export and platform access sit outside the SoD story (READ)
- Evidence: `08-retention-export-backup.md:63`: `system_admin` plus a second admin approve a full export that contains all samples. OPEN-A3-07 is not closed. OpenAPI has no export endpoint. `examples/render.yaml` `ari-internal` builds it with unspecified DB role. `05-identity-access.md:77`: BG-OPS creates `app_readonly_bg` using owner-level rights. The Render workspace owner can open `psql` at will.
- Impact: two admins can dump all sample data; the platform owner is outside every control.
- Fix: export key split across two non-admin custodians. A named DB role for export with its own audit. List platform owners as privileged users with quarterly review. Close OPEN-A3-07 before real data.
- Owner: A2, A3, A9.

---

## Low

### RT-28 — `k` and exact small counts are disclosed
- `openapi.yaml:1126-1133` returns `k` and the exact count with a label "5-9". Learning the threshold helps probing. Return only the label for counts under 10. Owner: A3.

### RT-29 — `search_path` order in definer functions
- `003_search.sql:51, 103, 116`: `portal, search, pg_catalog`. `pg_catalog` should come first. Only the owner can create in `portal`, so risk is low. `004_views_clinician_value.sql:35` same. Owner: A3.

### RT-30 — Unbounded input in the cart
- `001_core.sql:354`: `criteria jsonb` has no size limit or schema check in the DB. `idempotency_keys` and `request_items` can bloat. Add a CHECK on size and keys. Owner: A3.

---

## Contradictions index (short)
| Topic | Where it differs |
|---|---|
| Session idle/absolute | A2 15/30, 4/8 h; A6 15, 8 h; A1 ADR-004 30, 12 h; A8 30, 8 h |
| Cookie name | `__Host-sid` (A2), `__Host-ari_sid` (A6), `ari_session` (OpenAPI) |
| API origin | same origin (A6) vs `api.` domain (ADR-001) |
| CSRF | synchronizer (A2) vs double-submit (A6) vs token in body (OpenAPI) |
| DB roles | `app_api` (A2), `portal_*` (A3), `app_migrator` (A1), `ari_app` (A7) |
| Count unit | donors (A2) vs samples (A3) |
| Audit table, enums, partitioning | `audit.entry` vs `audit.audit_events`; `allow/deny` vs `success/denied`; chain vs yearly partitions |
| Request states | A4 (11) vs SQL (13) vs mockup (6 steps) |
| `researcher_intl` requests | blocked in API; allowed by DB grant |
| Registration | self-register (owner) vs "no self-registration" (A2) vs `/admin/registrations` (A6) |
| Backup retention | 35 days (A3) vs 7 days PITR (A9) |
| Test as superuser | A3 test runs superuser; A8 says never |
| DB plan | `basic-1gb` (A7) vs Pro with PITR (A9) |

---

## Top 10 (what hurts most)
1. RT-01 Differencing breaks k-anonymity (2 calls).
2. RT-02 Samples counted, not donors.
3. RT-03 Approval path not enforced in the database.
4. RT-04 DB role model: three versions; API as owner; any role reachable.
5. RT-05 Migrations fail for a normal owner; trigger silently does nothing; test hides it.
6. RT-06 Admin SoD holes (sock-puppet coordinator, unilateral k lowering).
7. RT-09 Audit log forgeable and serialised.
8. RT-07 Session, cookie, CSRF, origin contradictions.
9. RT-10 CMS editors can reach CI through the shared repo.
10. RT-13 Legal: coded child health data treated as non-personal; consent withdrawal and age-18 gaps.

(RT-11 Cloudflare and RT-12 schedule are close behind.)

## Must fix before build (gate for the first real code sprint)
1. Close RT-01 and RT-02: pick one privacy engine, add `donor_ref`, add neighbour rule, band counts under 10, add the attack-simulation test to CI. Owner A2 + A3.
2. One DB role model (RT-04): separate migration login and runtime login; remove `SET ROLE` reach; derive center from role assignments. Update `render.yaml`. Owner A1, A3, A7.
3. Make SQL tests run as the real non-superuser owner and runtime roles (RT-05). Fix `ALTER OWNER`, FORCE RLS owner policy, `sync_attached_data`, purge. Owner A3 + A8.
4. Enforce the request state machine and N-of-M voting in the database; fix `req_clinician` (RT-03, RT-20, RT-26). One generated state enum. Owner A3 + A4.
5. Put role grants and `k` changes behind definer functions with a second approver and floor `k >= 5` (RT-06). Owner A3 + A2.
6. One session/cookie/CSRF/origin table, with one config file, and one role-capability table that generates SQL tests, OpenAPI `x-roles` and the route table (RT-07, RT-08). Owner A2.
7. Rewrite the audit write path: server-side actor, keyed chain, denial events kept, no global lock bottleneck, one spec (RT-09). Owner A2 + A3.
8. Isolate CMS from the code repo and CI secrets (RT-10); decide on Cloudflare or remove it (RT-11). Owner A6, A7, A1.
9. Re-plan the schedule with a thin Phase 1 slice and external gates on the critical path (RT-12, RT-13). Owner A4 + orchestrator.
10. Fix backup plan slug, organisation-owned Render workspace with 2 owners, and a restore drill before any real data (RT-14). Owner A9, A7.
