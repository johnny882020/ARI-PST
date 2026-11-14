# Requirements validation (Phase 1)

Date: 2026-11-14. Data: synthetic only. Baseline: `main` after PR #9, plus the fixes in [section 4](#4-fixes-made-in-this-validation).

Inputs:
- Specification: [`docs/requirements/concept-and-spec-v1.0.md`](../requirements/concept-and-spec-v1.0.md) ("the spec"). Section numbers below are spec sections.
- Requirement IDs `REQ-001` to `REQ-072`: [`plan/00-contract-pack.md`](../../plan/00-contract-pack.md) §3.
- Binding decisions: [`plan/11-integration/canonical-decisions.md`](../../plan/11-integration/canonical-decisions.md).
- Code, tests, the flow report [`docs/qa/flows/REPORT.md`](../qa/flows/REPORT.md) (step numbers "Flow N", screenshots `NN`), [`KNOWN-ISSUES.md`](../KNOWN-ISSUES.md), [`REVIEW-2026-11.md`](../REVIEW-2026-11.md), the timeline workbook [`docs/planning/ARI_PST_2027_Development_Timeline.xlsx`](../planning/ARI_PST_2027_Development_Timeline.xlsx).

Method: each status comes from the code and from a test that was run, not from a plan document. Legal and regulatory items are marked "needs legal review". This document is not legal advice.

## 1. Status meanings

| Status | Meaning |
|---|---|
| Met | Built and tested in Phase 1. The evidence column names the code and the test. |
| Partly met | Built, but a part of the requirement is missing or not verified. The action column says what is missing. |
| Not met | Not built, and the requirement is Phase 1. |
| Out of Phase 1 | Planned for Phase 2 or 3, Phase 0 (a decision, not code), or blocked by a decision gate (for example `GATE-PROD-DATA`). A gate is not a failure. |

## 2. Summary

| Status | REQ (72) | SPEC (not in a REQ, 12) | Total (84) |
|---|---|---|---|
| Met | 49 | 5 | 54 |
| Partly met | 11 | 5 | 16 |
| Not met | 0 | 0 | 0 |
| Out of Phase 1 (phase or gate) | 12 | 2 | 14 |

- **Must-fix items found: 2. Fixed: 2** (section 4). Both broke a core flow. Each fix has a test that failed before the change and passes after it.
- No Phase 1 requirement is "Not met". The "Partly met" items do not break a core flow, a privacy rule or a hard rule in `CLAUDE.md`. They go to the roadmap: [`docs/ROADMAP-IMPLEMENTATION.md`](../ROADMAP-IMPLEMENTATION.md).
- Real data stays blocked by `GATE-PROD-DATA` (DPA, region, legal review, export round trip, migration path, pen-test).

Verification after the fixes (section 5): `pnpm arch`, typecheck, lint, all package tests, Playwright on the mock API, the full-stack end-to-end run and the 39-step flow run.

## 3. Requirements

Abbreviations: `api/` = `apps/api/test/`, `db/` = `db/tests/`, `web/` = `apps/web/src/`, `e2e/` = `apps/web/e2e/`, `ps/` = `apps/public-site/`. "WP" = work package in the roadmap.

### 3.1 Product scope and roles (spec §1 to §4)

| REQ | Requirement (short) | Spec § | Status | Evidence | Action |
|---|---|---|---|---|---|
| REQ-001 | One asset, two layers: public site and protected area | 1 | Met | `ps/` (Astro) and `apps/web` + `apps/api` (one host). Flow 3 to 36 (protected), Flow 37 to 39 (public, screenshots 56 to 58). | None |
| REQ-002 | Index only; tissue and identity stay in the centers | 1, 6.1 | Met | No identifier columns in `db/migrations/0002_core_tables.sql`; `packages/domain/src/identifier-guard.ts`; `db/audit.test.mjs` "no identifier-shaped values in any audit row"; Flow 15 (screenshot 19). | None |
| REQ-003 | Pilot with Shaare Zedek and Madgam | 1, 9 | Out of Phase 1 (gated) | Synthetic centers and content (`ps/src/content/centers/*/shaare-zedek.md`, `madgam.md`); seed profile `preview` with 3 synthetic centers. Real pilot data needs `GATE-PROD-DATA`. | WP P1-14 (load pilot data) |
| REQ-004 | One public face of the initiative | 3 | Met | Public pages: home, about, community, infrastructure, partners, news (`ps/src/pages/[locale]/*`); `ps/tests/build/site.test.ts`. | Content review: SPEC-01 |
| REQ-005 | Discovery without identifying data | 3, 6.3 | Met | `POST /search/aggregate`, `/search/facets`; `api/requests.test.ts` "external researcher gets a count of a big cell, never rows"; Flow 9 (screenshot 12). | None |
| REQ-006 | Governed, tracked access-request process | 3, 6.4 | Met | State machine `packages/domain/src/request-state.ts` and DB triggers (`0006_request_workflow.sql`); `db/workflow.test.mjs`; Flow 14 to 28. | None |
| REQ-007 | Entry by the national coordinator, not the treating doctor | 3, 11 | Met | `createSample` and import are `national_coordinator` only (`openapi.yaml` `x-roles`); `db/security.test.mjs` "clinician cannot write samples; coordinator can"; Flow 32, 33. | None |
| REQ-008 | Uniform fields and collection protocols | 3, 9 | Met | Enums in `packages/domain/src/sample.ts` and DB CHECKs; import template `GET /import-templates/{format}`. The protocols document is Phase 0 (REQ-061). | None |
| REQ-009 | Not a clinical system, not a RedCAP replacement | 3 | Met | No clinical record, no free text in the index (`0002_core_tables.sql`); clinician link-out only (`web/features/sample-index/center-link.ts`). | None |
| REQ-010 | Not a central physical biobank | 3 | Met | The index holds metadata and `contact_ref` (role) only; delivery is coordinated with the holding center (Flow 24 to 27). | None |
| REQ-011 | No analytics or AI layer in Phase 1 | 3, 9 | Met | No such module (module map in `apps/api/src/modules`). | Phase 3 (WP P3-04) |
| REQ-012 | Anonymous visitor: public area only | 4 | Met | `api/authz-matrix.test.ts` "every role x every endpoint"; `e2e/auth.spec.ts` "route guard: ... anonymous goes to login". | None |
| REQ-013 | Israeli researcher: aggregate view and requests | 4 | Met | `researcher_il` holds the cart and request operations (`x-roles`); Flow 7 to 17; `api/auth.test.ts` "register -> verify email -> pending -> approve -> login". | None |
| REQ-014 | International researcher: aggregate view only | 4 | Met | `e2e/researcher.spec.ts` "international researcher: aggregate only, no cart"; authz matrix. | None |
| REQ-015 | Clinician: full access of the own center (`GATE-CLINICIAN-ID`: coded record + link-out) | 4, 6.5 | Met | RLS by center (`0004_rls_and_grants.sql`); `api/idor-contract.test.ts` "clinician of center A cannot read ... center B"; Flow 29 to 31 (screenshots 46 to 48). | None |
| REQ-016 | National coordinator: cross-center, non-identified index | 4, 6.5 | Met | `db/security.test.mjs` "clinician sees only the own center; coordinator sees all"; Flow 32, 33. | None |
| REQ-017 | Committee: approve or reject; status view | 4 | Met (after fix F-1) | N-of-M votes in the DB (`db/workflow.test.mjs` "one vote per member per round"); Flow 21 to 23; committee queue `web/features/admin-governance/CommitteePage.tsx`. Fix F-1: the vote no longer fails 5 minutes after sign-in. A metrics view for the committee is part of REQ-066. | None |
| REQ-018 | System admin: permissions, logs, content | 4 | Met | Users, roles, audit, privacy settings pages; `e2e/admin.spec.ts`; `api/admin.test.ts`; content through Decap CMS (`ps/public/admin/config.yml`). Admin cannot read samples: Flow 36 (screenshot 55). | None |

### 3.2 Public site (spec §5)

| REQ | Requirement (short) | Spec § | Status | Evidence | Action |
|---|---|---|---|---|---|
| REQ-019 | The 10 public pages | 5 | Met | `ps/src/pages/[locale]/`: index, about, research, community, infrastructure, partners, news, patients, join + contact, login. `ps/tests/build/site.test.ts`. | Content gaps: SPEC-01, SPEC-02 |
| REQ-020 | Hebrew (full RTL) and English | 5 | Met | `packages/i18n` key parity (`scripts/lint-keys.mjs`); `e2e/auth.spec.ts` "he is the default: RTL login"; flows in both locales (screenshots 05 to 07, 15, 16, 44). | Hebrew copy is a machine draft: native review (WP P1-11) |
| REQ-021 | Mobile-friendly | 5 | Met | Flow 6, 13, 28, 39 at 390x844; `e2e/qa-fixes.spec.ts` "pages fit and targets are 44 px". | None |
| REQ-022 | Israeli accessibility standard and WCAG 2.1 AA | 5 | Partly met | axe: `ps/tests/a11y/axe.test.ts`, `e2e/auth.spec.ts` "axe clean"; design-system `a11y.test.tsx`; logical CSS test. Not done: screen-reader test with users, Lighthouse run, accessibility statement review. Standard edition `OPEN-A5-02` needs legal review. | WP P1-11, P1-12 |
| REQ-023 | Basic SEO | 5 | Met | Canonical and `hreflang` (`ps/src/layouts/BaseLayout.astro`), `@astrojs/sitemap`, `robots.txt.ts`, JSON-LD (`ps/src/lib/seo.ts`). | None |
| REQ-024 | Content managed by a non-technical team | 5 | Met | Decap CMS (`ps/public/admin/`), content in Git; `ps/tests/unit/cms-drift.test.ts`. | Editor trial with real staff (WP P1-11) |
| REQ-025 | Analytics with consent | 5 | Met | `ps/src/scripts/consent.ts`: the Umami script loads only after "accept"; notice page `legal/*/analytics.md`. | Needs legal review of the notice |
| REQ-026 | Privacy policy and terms | 5 | Met (needs legal review) | `ps/src/content/legal/{he,en}/privacy.md`, `terms.md`, `accessibility.md`. | Legal review (WP P1-01) |

### 3.3 Index, search and requests (spec §6)

| REQ | Requirement (short) | Spec § | Status | Evidence | Action |
|---|---|---|---|---|---|
| REQ-027 | Distributed index, searchable, points to the center contact | 6.1 | Met | `samples.contact_ref`, `centers.contact_role`; search and record pages; Flow 30 (screenshot 47). | None |
| REQ-028 | Sample record schema v1 | 6.2 | Met | Fields of contract pack §4 in `0002_core_tables.sql` and `packages/domain/src/sample.ts`; `api/flow.test.ts` "coordinator creates, reads, patches with ETag ..."; "rejects identifier-shaped values and unknown fields". | None |
| REQ-029 | Schema from Madgam base fields, aligned with RedCAP | 6.2 | Partly met | Draft v1 schema and vocabulary (`db/seeds/010_diagnosis_vocabulary.sql`, marked draft). Sign-off `GATE-SCHEMA` is not recorded in the repo (timeline G-01 says "owner reports done"). | Record the sign-off; WP P1-03 |
| REQ-030 | Free-text and "smart" search | 6.3 | Met | `search.expand_query` (synonyms, Hebrew prefixes, trigram) in `0008_search_retention_import.sql`; `GET /search/suggest`; `api/requests.test.ts` "facets and suggestions work". | None |
| REQ-031 | Filters: diagnosis, sample type, age, center, attached data, time point | 6.3 | Met | `web/features/search-discovery/filters.ts` (all six plus sex and availability); `filters.test.ts`; Flow 9, 10. | None |
| REQ-032 | External researcher sees counts only | 6.3 | Met | No grant on sample rows for external roles; `api/idor-contract.test.ts` "external roles can never read sample rows, even through the database". | None |
| REQ-033 | k-anonymity screen; small counts merged | 6.3, 11 | Met | `0007_privacy_engine.sql` (k ≥ 5, distinct donors, neighbour and complement rule, merge to parent / "other"); `db/privacy.test.mjs` incl. "attack simulation"; UI shows "Too few to show" (Flow 10, screenshots 13, 16). | Independent privacy check (WP P1-08) |
| REQ-034 | Full request path: cart to delivery | 6.4 | Met | Flow 11 to 28 (screenshots 14 to 45); `api/requests.test.ts` "cart to delivery with committee quorum ..."; `e2e/coordination.spec.ts`. | Withdraw and appeal have no UI yet (WP P1-16) |
| REQ-035 | Form fields: question, IRB/Helsinki, planned use, funding | 6.4 | Met | `web/features/access-requests/RequestFormPage.tsx`; Flow 16 (screenshots 20, 21); `e2e/qa-fixes.spec.ts` "QA-009". | None |
| REQ-036 | Every step documented and visible to the applicant | 6.4 | Met | 8-step tracker (`web/features/access-requests/tracker.ts`, `tracker.test.ts`); Flow 17, 23, 27 (screenshots 23, 33, 43). | None |
| REQ-037 | Three access levels | 6.5 | Met | `packages/domain/src/capabilities.ts` = OpenAPI `x-roles`; `api/authz-matrix.test.ts`. | None |
| REQ-038 | Two-step coding; no link key in the portal | 6.5, 11 | Met | `sample_code` is a random ULID; `donor_ref` random and never readable (`db/security.test.mjs` "donor_ref cannot be read by any runtime context"); import result map for the center's local mapping (`GET /import-jobs/{jobId}/result-map`). | None |
| REQ-039 | Identified clinical data stays in the center's RedCAP | 6.5, 7 | Met | No such data in the schema; link-out to the center system (`center-link.ts`, Flow 30). | None |

### 3.4 Privacy, security, regulation (spec §7)

| REQ | Requirement (short) | Spec § | Status | Evidence | Action |
|---|---|---|---|---|---|
| REQ-040 | Each record documents its ethics approval | 7 | Partly met | `samples.ethics_approval_id`, checked against the center (`trg_samples_ethics`); import warns `ETHICS_MISSING` / `ETHICS_UNKNOWN` (`packages/domain/src/import-rules.ts`). The field is optional, so a record can exist without it. | Decide "required" at `GATE-SCHEMA` (WP P1-03) |
| REQ-041 | Portal holds de-identified data only | 7 | Met | Same as REQ-002; `CLAUDE.md` hard rule; synthetic seed gate (`scripts/render-predeploy.mjs` refuses seed into non-synthetic DB). | None |
| REQ-042 | No direct identifiers at any step | 7 | Met | Identifier guard on every text input (API and SPA `web/shared/identifier-warning.ts`); import rejects the whole file (`api/import.test.ts` "rejects identifier-shaped cells, never echoes values"); Flow 15. | None |
| REQ-043 | Encryption in transit and at rest | 7 | Partly met | `__Host-` cookies `Secure`, HTTPS from the platform; TOTP secrets AES-256-GCM. At-rest encryption is the provider's and is UNVERIFIED for the target platform. | Verify on Google Cloud (WP P1-05) |
| REQ-044 | Two-factor authentication | 7 | Met | Password + TOTP or passkey (`api/auth.test.ts`); Flow 3 (screenshot 02); step-up ≤ 5 min for sensitive actions, now with a dialog (fix F-1). | None |
| REQ-045 | Role-based access control | 7 | Met | One capability table, RLS, `api/authz-matrix.test.ts`, `db/governance.test.mjs`. | None |
| REQ-046 | Full audit log: viewed, downloaded, approved | 7 | Met | `sample.view`, `export.download`, `request.vote` / `request.decide`, denials (`api/admin.test.ts` "records views and denials ..."); hash chain (`db/audit.test.mjs`); Flow 35 (screenshot 54). | None |
| REQ-047 | Retention and deletion policy | 7 | Met (needs legal review) | `db/retention.test.mjs`; purge job `apps/api/src/jobs/purge.ts`; values C-07. | Legal review of periods (WP P1-01) |
| REQ-048 | Backup and restore | 7 | Partly met | `db/roundtrip.test.mjs` "export -> import into an empty migrated DB -> same counts, same checksums"; runbook `RB-02`. No restore drill on a managed database; no role can take a full logical dump (KNOWN-ISSUES M-8). | WP P1-06 |
| REQ-049 | Compliance check: Israeli rules, HIPAA, GDPR | 7 | Out of Phase 1 (Phase 0, `GATE-COMPLIANCE`) | Needs legal review. Timeline G-03. | WP P1-01 |
| REQ-050 | DPA with the platform provider | 7, 8 | Out of Phase 1 (gated) | Timeline G-02: owner reports a Google Cloud DPA is signed; not verified in the repo. Needs legal review. | Confirm scope (WP P1-01) |
| REQ-051 | DTA and MTA per center | 7 | Met (recording); agreements need legal review | MTA/DTA per center with status and month; delivery needs a signed agreement (`0011_agreement_status_clinician_links.sql`; `db/workflow.test.mjs` "0011: agreement status ..."); Flow 26 (screenshot 39). Templates are legal work. | WP P1-01 |
| REQ-052 | Decision on storage region | 7 | Out of Phase 1 (`GATE-REGION`) | Demo in Frankfurt (Render). Timeline plans Tel Aviv (`me-west1`) on Google Cloud. Needs legal review. | WP P1-04 |

### 3.5 Platform and integrations (spec §8)

| REQ | Requirement (short) | Spec § | Status | Evidence | Action |
|---|---|---|---|---|---|
| REQ-053 | Public site separate from the protected area | 8, 11 | Met | Separate apps and deploys (`render.yaml`, `infra/render.free.yaml`); public site holds no sample data; CORS only for `POST /public/forms/*` (`api/integration.test.ts` "the rule does not reach any other route"). | None |
| REQ-054 | Protected-area entry conditions | 8 | Out of Phase 1 (`GATE-PROD-DATA`) | Built: managed DB, auth, RBAC, audit, export round trip (`db/roundtrip.test.mjs`). Open: DPA scope, region, migration path on the target platform, legal review, pen-test. | WP P1-01 to P1-09 |
| REQ-055 | RedCAP: field mapping and reference, no identifiers | 8 | Partly met | No identifiers; reference by link-out; mapping design in `plan/03-data-integration/06-integrations.md`; import template. The data-dictionary mapping tool is not built. | WP P1-13 (mapping sheet, G-05) |
| REQ-056 | Madgam: schema alignment and update process | 8 | Partly met | Update process: CSV/XLSX import with dry run (`api/import.test.ts`), staleness cron. Schema alignment sign-off is open (G-05). | WP P1-13 |
| REQ-057 | Digital pathology: object store and viewer | 8, 9 | Out of Phase 1 (Phase 2) | `ObjectStorePort` (`packages/domain/src/ports.ts`); `attached_data` flag `digital_pathology`. | WP P2-04 |
| REQ-058 | Genomics: availability flag only | 8 | Met | `attached_data` values `wes`, `wgs`, `rna_seq` only; no sequence data. | None |
| REQ-059 | Institutional SSO | 8, 9 | Out of Phase 1 (Phase 2) | `AuthPort` is the hook; no OIDC adapter. | WP P2-03 |
| REQ-060 | Partner API | 8, 9 | Out of Phase 1 (Phase 3) | Contract-first OpenAPI is the base. | WP P3-02 |

### 3.6 Phases, metrics, risks, owner requirements (spec §9 to §11, owner)

| REQ | Requirement (short) | Spec § | Status | Evidence | Action |
|---|---|---|---|---|---|
| REQ-061 | Phase 0: decisions, spec, schema v1, protocols document | 9 | Out of Phase 1 (Phase 0) | Spec and draft schema in the repo. The collection-protocols document is not in the repo (timeline G-01: owner reports done). | Add or link the signed documents (WP P1-03) |
| REQ-062 | Phase 1 scope (public site, protected area, index, search, request form, audit) | 9 | Met (synthetic); go-live gated | All parts work on the production build with synthetic data: Flow 1 to 39. Production stack not applied (KNOWN-ISSUES H-2); real data `GATE-PROD-DATA`. | WP P1-04, P1-10 |
| REQ-063 | Phase 1 exit: requests completed to actual delivery | 9 | Out of Phase 1 (gated) | Simulated end to end (Flow 24 to 28). The exit needs real requests in the pilot. | WP P1-15 |
| REQ-064 | Phase 2 scope and exit (≥ 3 centers feeding) | 9 | Out of Phase 1 (Phase 2) | Hooks: centers are data; ports. | Phase 2 |
| REQ-065 | Phase 3 scope and exit (clinical trial basis) | 9 | Out of Phase 1 (Phase 3) | None. | Phase 3 |
| REQ-066 | Success metrics instrumented | 10 | Partly met | `GET /metrics` (`apps/api/src/modules/admin-governance/service.ts` `metrics`): samples, centers feeding, researchers, searches in 30 days, coordinator-entered share, requests by status; `db/api-support.test.mjs` "metrics are role gated". Missing: field completeness, completion rate, request-to-delivery time, studies and publications, and a metrics page. | WP P1-17 |
| REQ-067 | Ongoing update mechanism and owner | 11, 12 | Met (mechanism); owner open | Staleness cron (`apps/api/src/jobs/staleness.ts`), freshness board, verify action (`e2e/staff.spec.ts` "freshness board ..."); `db/retention.test.mjs` "staleness: reminders per center ...". | Name the freshness owner (governance) |
| REQ-068 | Minimal entry screen; repeat value for the clinician | 11 | Partly met | Minimal entry form (`e2e/staff.spec.ts` "coordinator: minimal entry form, save and add another"; Flow 32). The clinician home shows only a search tile (`web/features/home/HomePage.tsx`): no "value" view. | WP P1-18 |
| REQ-069 | Git and auto-deploy delivery | owner | Partly met | Every change is a PR; `ci-gate`; demo Blueprint with manual deploy. Production auto-deploy is not applied (H-2); the target moves to Google Cloud (timeline C-01, C-02). | WP P1-04 |
| REQ-070 | Portability (Base44 later, TBD) | owner | Met | Hexagonal core; `pnpm arch` (dependency-cruiser) passes; `docs/migration/google-cloud.md`. | None |
| REQ-071 | Brand: warm, hopeful, dignified, scientific | owner | Met (sign-off open) | Navy and gold style (`docs/design/STYLE-GUIDE.md`, PR #9). Logo permission and fonts licence are open (KNOWN-ISSUES "Content and design"). | WP P1-11 |
| REQ-072 | Small-team operability, SLOs, tested restore, safe releases | owner | Partly met | Runbooks RB-01 to RB-08 (`docs/runbooks/`), `/livez` and `/readyz` (`api/integration.test.ts`), forward-only migrations. No alerts (L-4), no SLO dashboard, no restore drill. | WP P1-06 |

### 3.7 Spec statements that no REQ captures

| ID | Statement (short) | Spec § | Status | Evidence | Action |
|---|---|---|---|---|---|
| SPEC-01 | The public site presents the focus: pediatric brain tumors and neuroblastoma, later sarcomas | 2, 5 | Partly met | Research areas are "Tumor biology", "Biobanking", "Data sharing" (`ps/src/content/research-areas/`). The word "neuroblastoma" is on no public page. | Content: WP P1-11 |
| SPEC-02 | "Publications and news" includes achievements and calls for proposals | 5 | Partly met | News collection exists (`ps/src/content/news/`). No publications list or "calls" category. | WP P1-11 |
| SPEC-03 | Join and contact forms for researchers, centers and partners | 5 | Met | `POST /public/forms/{join,contact}`; `api/integration.test.ts` public-form tests. Delivery by e-mail needs SMTP (KNOWN-ISSUES H-1). | WP P1-07 |
| SPEC-04 | Clinician links a sample to the own patient and updates availability | 4 | Met (by design) | Link happens in the center's system (`GATE-CLINICIAN-ID`, link-out Flow 30). The clinician confirms or flags a record; the coordinator edits it (`flagSample`, `verifySample`; `e2e/staff.spec.ts` "clinician ... can verify a record"). | None |
| SPEC-05 | Committee and steering committee see a status picture | 4 | Partly met | Committee queue and vote tally (Flow 21, 22). No dashboard of request counts and times. | WP P1-17 |
| SPEC-06 | Example result: "12 FFPE samples in 4 centers" | 6.3 | Met | Count tile plus center facet with k-screen (Flow 9; `api/requests.test.ts` "facets and suggestions work"). | None |
| SPEC-07 | Contact for an inquiry is the researcher or coordinator at the center | 6.2 | Met (by design) | `contact_ref` is a role, not a personal address (contract pack §4). | None |
| SPEC-08 | Researchers register; national coordinator approves (owner answer) | 4, owner | Partly met | Register, verify, approve: `api/auth.test.ts`, `e2e/admin.spec.ts` "coordinator approves a pending registration". No SMTP on a deployed stack, so the verification e-mail does not arrive (H-1); no password reset (M-2). | WP P1-07, P1-16 |
| SPEC-09 | Public site on a fast, low-cost platform with self-managed content | 8 | Met | Astro static site and Decap CMS. | None |
| SPEC-10 | National coordinator position is funded and staffed | 11 | Out of Phase 1 (`GATE-BUDGET`) | Not software. Timeline "Team" sheet lists Study Coordinators 1 and 2. | Governance |
| SPEC-11 | Clear owner for each area (roles table) | 13 | Out of Phase 1 (`GATE-OPERATOR`) | Not software. RACI in `plan/04-product-workflow/06-governance.md` uses roles, not names. | Governance |
| SPEC-12 | A rollback and safe release path exists for the protected area | 8, owner | Partly met | `RB-01-bad-deploy.md`; forward-only migrations; `/readyz` migration level check. Rollback not rehearsed. | WP P1-10 |

## 4. Fixes made in this validation

A must-fix is a Phase 1 requirement that is not met or partly met in a way that breaks a core flow, a privacy or security rule, or a hard rule in `CLAUDE.md`, and that can be fixed safely now. Two items met this rule.

| ID | Requirement | Problem (before) | Change | Test (fails before, passes after) |
|---|---|---|---|---|
| F-1 | REQ-017, REQ-034, REQ-044 (also REQ-013 registration decisions, REQ-018 role grants and `k`) | The API answers `401 STEP_UP_REQUIRED` for a vote, a decision, a role grant, a `k` change or a registration decision when the second factor is older than 5 minutes. The API client treated every 401 as a lost session, so the SPA wiped the session and showed "Session ended". A committee member who read a request for more than 5 minutes could not vote without signing in again (review R-03, KNOWN-ISSUES M-1). | `packages/api-client/src/client.ts`: a `STEP_UP_REQUIRED` answer never fires `onUnauthorized`; the client keeps an unread copy of each unsafe call, asks `onStepUpRequired`, and sends the call once more after a successful step-up. `apps/web/src/shared/StepUpDialog.tsx` (new): dialog for the 6-digit code or a recovery code, calls `POST /auth/step-up`, updates the session. Mounted in `apps/web/src/routes/router.tsx`. `apps/web/src/lib/api.ts`: one shared dialog for parallel refusals. New i18n keys `auth.stepUp.title`, `.submit`, `.methods` in he and en. No API contract change. | `packages/api-client/test/client.test.ts`: "STEP_UP_REQUIRED: asks for step-up, retries the same call once, never fires onUnauthorized"; "STEP_UP_REQUIRED: a cancelled step-up returns the original problem and does not sign out". `apps/web/src/shared/StepUpDialog.test.tsx`: three tests (code accepted and retry allowed; cancel; wrong code keeps the dialog open). |
| F-2 | REQ-016, REQ-028, REQ-062 (go-live) | `app_core` had no `EXECUTE` on `search.norm()`, which the vocabulary indexes call. The pre-deploy step could not load the diagnosis vocabulary; only the synthetic seed loaded it. On a real-data deployment (no seed) the vocabulary stays empty, so no sample can be created or imported (every diagnosis code fails the vocabulary check) and the diagnosis filter is empty (review R-13, KNOWN-ISSUES L-1). | Forward-only migration `db/migrations/0012_vocabulary_norm_grant.sql` (kind: expand): as the owner `app_agg`, `GRANT EXECUTE ON FUNCTION search.norm(text) TO app_core`. No other change in reach. Comment in `scripts/render-predeploy.mjs` updated. | `db/tests/vocabulary.test.mjs` "app_core may execute search.norm(), which the vocabulary indexes call" (runs as `app_migrator` with `SET ROLE app_core`, the real pre-deploy path). |

Limit of F-1: the dialog offers the 6-digit code and recovery codes. A passkey-only account uses a recovery code, because the API has no session-based passkey challenge for step-up yet (KNOWN-ISSUES M-1, updated).

## 5. Verification after the fixes

| Command | Result |
|---|---|
| `pnpm arch` | Pass |
| `pnpm -r --if-present typecheck` | Pass |
| `pnpm -r --if-present lint` | Pass |
| `pnpm --filter @ari/api-client gen:check` | Pass (no contract change) |
| `pnpm -r --if-present test` | Pass: 489 tests (api-client 7, domain 36, i18n 5, synthetic-data 9, design-system 120, db 136, public-site 50, web 67, api 59) |
| `pnpm --filter @ari/web test:e2e` | Pass: 33 of 33 |
| `pnpm test:e2e:full` | Pass: 24 of 24 |
| `pnpm test:e2e:flows` | Pass: 39 of 39 steps, 0 product gaps, 58 screenshots refreshed |
| Migration 0012 on a database that holds data | Pass. Separate cluster (port 55442): migrations 0001 to 0011, then fixtures (3 centers, 3 samples, 19 vocabulary terms), then 0012. Row counts unchanged; `app_core` has `EXECUTE` on `search.norm()`; `db/tests/vocabulary.test.mjs` passes; the full db suite (136) passes on that port after the branch commits of PR #10. |

## 6. Items that are not must-fix (go to the roadmap)

These are real gaps. They do not break a core flow or a privacy rule, or they need a decision, an external party or more than a small change.

| Item | Source | Roadmap WP |
|---|---|---|
| Rate limit trusts the left-most `X-Forwarded-For` (R-04). Needs the proxy hop count of the target platform (UNVERIFIED). | REVIEW R-04 | P1-09 |
| One MFA challenge can create two sessions in a race (R-05); locked-account answer differs (R-07) | REVIEW R-05, R-07 | P1-09 |
| No SMTP, no object store on a deployed stack (invites, e-mail verification, multi-instance import) | KNOWN-ISSUES H-1 | P1-07 |
| Password reset, invite accept page, sample edit page, audit export page, withdraw and appeal UI | KNOWN-ISSUES M-2 | P1-16 |
| Metrics page and missing metrics | REQ-066 | P1-17 |
| Clinician "value" view | REQ-068 | P1-18 |
| Ethics approval required or optional | REQ-040 | P1-03 |
| Public content: neuroblastoma, publications, Hebrew review, logos | SPEC-01, SPEC-02 | P1-11 |
