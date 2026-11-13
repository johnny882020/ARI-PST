# 07 — Phase 1 "Definition of Fully Functional" (Owner Acceptance Checklist)

Use this list to accept the build. Test on staging with synthetic data first (sections A–I). Section J is the real-data gate.
Mark each line: Pass / Fail / N/A with date and tester role. A line passes only if the stated result is seen.

## A. Public site
- [ ] All 10 public pages exist and load in Hebrew and English (REQ-019, 020). Story: US-001.
- [ ] Hebrew pages are fully right-to-left. No broken layout (REQ-020). US-002.
- [ ] Pages work at 360 px width. No horizontal scroll (REQ-021). US-006.
- [ ] Automated accessibility check shows no critical or serious issue. A manual keyboard check passes (REQ-022).
- [ ] Privacy policy and terms exist in both languages (REQ-026). US-004.
- [ ] Analytics sends nothing before consent (REQ-025). US-004.
- [ ] A non-technical editor changes a page and a news item without a developer (REQ-024). US-005.
- [ ] Contact/join form delivers a message and is rate-limited. US-003.
- [ ] Public site shows no sample data. A protected URL redirects to login (REQ-053). US-001.

## B. Accounts, MFA, roles
- [ ] Coordinator invites a researcher. Researcher verifies email and registers (ASSUMPTION-03). US-010.
- [ ] Login needs password plus second factor. TOTP works. Passkey works (REQ-044). US-011, US-012.
- [ ] Lockout and rate limits work. Messages do not reveal accounts. US-014.
- [ ] All 7 roles exist. The role matrix test passes (REQ-045, 037). US-016.
- [ ] Clinician sees own center only. Other center returns not found (REQ-015). US-017.
- [ ] `system_admin` cannot read samples or vote. `committee_member` cannot edit the index. US-035, US-063.
- [ ] High-power role grants need a second admin. US-064.
- [ ] MFA reset needs a second admin. US-015.
- [ ] Sessions expire on idle and on logout. US-013.

## C. Index and schema
- [ ] Record has all v1 fields from the contract pack §4. Enums enforced (REQ-028).
- [ ] No free-text clinical field anywhere. No direct identifier can be entered (REQ-042). US-050, US-052.
- [ ] `sample_code` is opaque and not derived from patient data (REQ-038).
- [ ] Ethics approval ref is required per record (REQ-040). US-055.
- [ ] Genomics shows as availability flag only (REQ-058). US-057.
- [ ] Pilot index holds synthetic Shaare Zedek and Madgam style data sets (REQ-003).
- [ ] Field mapping to RedCAP and Madgam is viewable. Template matches schema (REQ-029, 055, 056). US-056.

## D. Search and privacy of counts
- [ ] Free-text search works in Hebrew and English with synonym tolerance (REQ-030). US-020, US-025.
- [ ] All 6 filters work and combine (REQ-031). US-021.
- [ ] External roles see counts only, no record ids (REQ-032). US-022.
- [ ] Counts below k are hidden and merged. No subtraction leak (REQ-033). US-023.
- [ ] k is configurable and changes are audited.
- [ ] International researcher sees counts only and no cart (REQ-014). US-024.
- [ ] Search p95 under 1 s on 50,000 synthetic records (NFR-001).

## E. Access-request flow (end to end)
- [ ] A researcher completes: search → cart → form → submit (REQ-034, 035). US-030, US-031.
- [ ] Coordinator pre-check with checklist works. US-033.
- [ ] Needs-more-info loop works both from pre-check and from committee. US-034.
- [ ] Committee votes with N-of-M and criteria from configuration (GATE-COMMITTEE). US-035, US-061.
- [ ] Partial approval works at item level. US-036.
- [ ] Center coordination works and is limited to own center. US-037.
- [ ] MTA/DTA are recorded per center and block delivery if missing (REQ-051). US-038.
- [ ] Delivery and close work. Request reaches `closed` with `delivered` (REQ-063). US-039.
- [ ] Withdraw, expiry, rejection, appeal each work from the state table. US-040, US-041, US-042.
- [ ] Applicant sees every step with date and actor role (REQ-036). US-032.
- [ ] Timers and reminders fire. SLA values are editable data. US-042.
- [ ] Property test passes: no illegal state, `closed` is final.
- [ ] One full journey was run by real staff on staging with synthetic data.

## F. Ingestion and freshness
- [ ] Coordinator creates a record on the minimal screen in under 2 minutes (REQ-068). US-050.
- [ ] CSV and XLSX import: dry-run then commit, with batch ID (GATE-INGEST). US-051.
- [ ] 500 rows import in one session (NFR-007).
- [ ] Identifier patterns reject the whole file. Values are never echoed. US-052.
- [ ] Stale list, weekly digest, confirm/flag actions work (REQ-067). US-053, US-054.
- [ ] Clinician dashboard shows repeat value without data entry (REQ-068).

## G. Audit, security, data protection
- [ ] Audit shows view, download/export, approve, login, role change, config change (REQ-046). US-070.
- [ ] Denied actions are logged. US-073.
- [ ] App cannot update or delete audit rows. US-072.
- [ ] Audit search and export work and are themselves audited. US-071.
- [ ] TLS everywhere. Storage encrypted at rest. A2 checklist signed (REQ-043).
- [ ] Retention job runs and is logged (REQ-047). US-080.
- [ ] Backup exists. Restore drill done within RTO 4 h and RPO 15 min (REQ-048). US-082.
- [ ] Full export and import round trip matches counts and checksums (REQ-054). US-081.
- [ ] No identifiers in logs, errors or notification emails (FR-015). Verified by scan.
- [ ] Pen-test done. No open high or critical findings.

## H. Delivery and operations
- [ ] All changes go through Git pull requests. No manual production change (REQ-069).
- [ ] Merge to `staging` deploys to staging. Merge to `main` deploys after CI passes. Protected area needs manual approval.
- [ ] Every PR has a preview with synthetic data only.
- [ ] Architecture test blocks a domain import of a platform library (REQ-070).
- [ ] Portability checks run in CI.
- [ ] SLO dashboards and alerts exist. Runbooks exist for the top incidents (REQ-072).
- [ ] A rollback was rehearsed.

## I. Brand and usability
- [ ] Look and feel match the brand brief: warm, hopeful, dignified, scientific (REQ-071). A5 sign-off.
- [ ] Light and dark themes work.
- [ ] Five test users (one per role group) finish their top journey without help. Journeys J1–J11 in `01-personas-journeys.md`.

## J. Metrics and governance
- [ ] All pilot metric events fire with allowed properties only (REQ-066). US-083.
- [ ] Metrics page shows M1–M7.
- [ ] Committee config, content owners and RACI named for real people (`06-governance.md`).
- [ ] Freshness owner named (REQ-067).

## K. Real-data go-live gate (GATE-PROD-DATA) — separate sign-off
- [ ] DPA signed with platform provider (REQ-050).
- [ ] Storage region decided and verified (REQ-052).
- [ ] Legal review of compliance done (REQ-049, GATE-COMPLIANCE).
- [ ] Export/import round trip proven (REQ-054).
- [ ] Migration path documented (REQ-054, 070).
- [ ] Pen-test passed.
- [ ] Managed DB, auth, RBAC, audit logs all live (REQ-054).
- [ ] Owner signs "real data allowed".

Acceptance rule: Phase 1 build is accepted when sections A–J pass on staging. Real data enters only after section K passes. Phase 1 exits (REQ-063) after requests complete the full path to actual delivery in the pilot.
