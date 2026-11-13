# 03 — Requirement Catalog

Every REQ-001..REQ-072 from the contract pack appears once as a primary row in section 3.
MoSCoW: M must, S should, C could, W will not (now). Phase: 0–3.
"Stories" lists Phase 1 stories in `04-user-stories-phase1.md`. "—" means no story (Phase 0, policy, or future hook).

## 1. Epics

| Epic | Name | Module(s) | Goal |
|---|---|---|---|
| E01 | Public site | `public-site` | One public face, bilingual, accessible, editable by staff. |
| E02 | Identity and access | `identity-access` | Accounts, MFA, roles, center scope. |
| E03 | Sample index and schema | `sample-index` | Coded, de-identified metadata index with schema v1. |
| E04 | Search and discovery | `search-discovery` | Search, filters, aggregate counts, k-anonymity. |
| E05 | Access requests | `access-requests` | Governed end-to-end request flow. |
| E06 | Ingestion and freshness | `center-ingestion` | Low-effort entry, bulk import, staleness loop. |
| E07 | Admin and governance | `admin-governance` | Committee config, dashboards, user admin. |
| E08 | Audit, security, privacy | `audit-log`, `identity-access` | Audit, encryption, retention, compliance. |
| E09 | Platform and delivery | `observability`, infra | Git + Render delivery, portability, operability. |
| E10 | Brand and UX | design system | Brand, Apple-style UI, usability. |
| E11 | Metrics and notifications | `observability`, `notifications` | Pilot metrics, consented analytics, messages. |
| E12 | Scope, phases, boundaries | all | Phase scope, non-goals, future hooks. |

## 2. MoSCoW summary (Phase 1)

| Class | Meaning here |
|---|---|
| M | Needed for acceptance in `07-phase1-acceptance-checklist.md`. |
| S | Built in Phase 1 if capacity allows. Cut first (SEO depth, analytics). |
| C | Hook or later. |
| W | Not in Phase 1 (REQ-011). |

## 3. Full catalog

| REQ | Epic | Requirement (short) | MoSCoW | Phase | Stories / notes |
|---|---|---|---|---|---|
| REQ-001 | E01 | Two layers: public site + protected area | M | 1 | US-001, US-011 |
| REQ-002 | E03 | Index only, no identified clinical repository | M | 1 | US-052, US-055 |
| REQ-003 | E12 | Pilot: Shaare Zedek + Madgam | M | 1 | US-051 (pilot data sets) |
| REQ-004 | E01 | One public face | M | 1 | US-001 |
| REQ-005 | E04 | Discover what exists without identifiers | M | 1 | US-020, US-022 |
| REQ-006 | E05 | Governed, tracked request process | M | 1 | US-030..US-042 |
| REQ-007 | E06 | Coordinator does entry, not treating doctor | M | 1 | US-050, US-051, US-054 |
| REQ-008 | E03 | Uniform fields and protocols | M | 1 | US-051 (template), US-050 |
| REQ-009 | E12 | Not a clinical system | M | 1 | Constraint. Checked by US-052 (no clinical notes). |
| REQ-010 | E12 | Not a central physical biobank | M | 1 | Constraint. Item delivery is done by centers (US-037). |
| REQ-011 | E12 | No analytics/AI layer in Phase 1 | W | 1 | Constraint. No story. Hook only. |
| REQ-012 | E01 | Anonymous: public area only | M | 1 | US-001, US-016 |
| REQ-013 | E02 | `researcher_il`: aggregate + requests | M | 1 | US-010, US-022, US-030 |
| REQ-014 | E02 | `researcher_intl`: aggregate only | M | 1 | US-024 |
| REQ-015 | E02 | Clinician: own center, coded record | M | 1 | US-017, US-026 (GATE-CLINICIAN-ID) |
| REQ-016 | E02 | Coordinator: cross-center non-identified index | M | 1 | US-027, US-050, US-051 |
| REQ-017 | E07 | Committee approves/rejects; dashboard | M | 1 | US-035, US-062 |
| REQ-018 | E07 | Admin: permissions, logs, content | M | 1 | US-060, US-064, US-070 |
| REQ-019 | E01 | Public pages list | M | 1 | US-001, US-003 |
| REQ-020 | E01 | Hebrew RTL + English | M | 1 | US-002 |
| REQ-021 | E01 | Mobile-friendly | M | 1 | US-006 |
| REQ-022 | E01 | Israeli standard + WCAG 2.1 AA | M | 1 | US-006 |
| REQ-023 | E01 | Basic SEO | S | 1 | US-006 |
| REQ-024 | E01 | Non-technical content editing | M | 1 | US-005 |
| REQ-025 | E11 | Analytics with consent | S | 1 | US-004, US-083 |
| REQ-026 | E01 | Privacy policy and terms | M | 1 | US-004 |
| REQ-027 | E03 | Distributed index, contact at holding center | M | 1 | US-026, US-037 |
| REQ-028 | E03 | Sample record schema v1 | M | 1 | US-050, US-051 |
| REQ-029 | E03 | Schema from Madgam + clinical fields; RedCAP aligned | M | 0-1 | US-056; Phase 0 output |
| REQ-030 | E04 | Free-text and "smart" search | M | 1 | US-020, US-025 |
| REQ-031 | E04 | Filters (6 facets) | M | 1 | US-021 |
| REQ-032 | E04 | External sees aggregate counts only | M | 1 | US-022, US-024 |
| REQ-033 | E04 | k-anonymity suppression and merge | M | 1 | US-023 |
| REQ-034 | E05 | Full request flow | M | 1 | US-030..US-041 |
| REQ-035 | E05 | Request form fields | M | 1 | US-031 |
| REQ-036 | E05 | Every step documented, visible to applicant | M | 1 | US-032 |
| REQ-037 | E02 | Three access levels | M | 1 | US-016, US-017, US-024 |
| REQ-038 | E03 | Two-step coding; no link keys in portal | M | 1 | US-052 |
| REQ-039 | E03 | Identified data stays in center RedCAP | M | 1 | US-026, US-056 |
| REQ-040 | E03 | Ethics approval documented per record | M | 1 | US-055 |
| REQ-041 | E08 | De-identified only in portal | M | 1 | US-052 |
| REQ-042 | E08 | No direct identifiers at any step | M | 1 | US-052, US-031 |
| REQ-043 | E08 | Encryption in transit and at rest | M | 1 | US-080 (verified by A2/A8 tests) |
| REQ-044 | E02 | Two-factor authentication | M | 1 | US-011, US-012 |
| REQ-045 | E02 | RBAC | M | 1 | US-016, US-060 |
| REQ-046 | E08 | Full audit log | M | 1 | US-070..US-073 |
| REQ-047 | E08 | Retention and deletion policy | M | 1 | US-080 |
| REQ-048 | E08 | Backup and restore | M | 1 | US-082 |
| REQ-049 | E08 | Compliance check (legal review) | M | 0 | — (Phase 0 task; needs legal review) |
| REQ-050 | E08 | DPA with platform provider | M | 0 | — (gate: GATE-PROD-DATA) |
| REQ-051 | E05 | DTA and MTA per center | M | 1 | US-038 |
| REQ-052 | E08 | Storage region decision | M | 0 | — (GATE-REGION) |
| REQ-053 | E09 | Separate public site from protected area | M | 1 | US-001, US-016 |
| REQ-054 | E08 | Protected-area entry conditions | M | 1 | Checklist 07 section G; US-081, US-082 |
| REQ-055 | E06 | RedCAP: mapping and reference only | M | 1 | US-056 |
| REQ-056 | E06 | Madgam: schema alignment and update | M | 1 | US-051, US-056 |
| REQ-057 | E12 | Pathology scans: object storage + viewer | S | 2 | Hook only: `digital_pathology` flag (US-057) |
| REQ-058 | E03 | Genomics: availability flag only | M | 1 | US-057 |
| REQ-059 | E12 | Institutional SSO | S | 2 | Hook only: `AuthPort` OIDC adapter slot |
| REQ-060 | E12 | Partner API | C | 3 | Hook only |
| REQ-061 | E12 | Phase 0 outputs | M | 0 | Roadmap 05 |
| REQ-062 | E12 | Phase 1 scope | M | 1 | Checklist 07 |
| REQ-063 | E12 | Phase 1 exit: requests through delivery | M | 1 | US-039; metrics M5 |
| REQ-064 | E12 | Phase 2 scope and exit | S | 2 | Roadmap 05. Hooks only in Phase 1 |
| REQ-065 | E12 | Phase 3 scope and exit | C | 3 | Roadmap 05. Hooks only |
| REQ-066 | E11 | Success metrics instrumented | M | 1 | US-083 |
| REQ-067 | E06 | Freshness mechanism + owner | M | 1 | US-053, US-054; loop in 06 |
| REQ-068 | E06 | Minimal entry screen; repeat value to clinician | M | 1 | US-050, US-054 |
| REQ-069 | E09 | Git + Render auto-deploy | M | 1 | Owned by A7. Product view: checklist 07 H |
| REQ-070 | E09 | Portability to Base44 (TBD) | M | 1 | Owned by A1/A7. Checklist 07 H |
| REQ-071 | E10 | Brand: warm, hopeful, dignified, scientific | M | 1 | Owned by A5. Checklist 07 I |
| REQ-072 | E09 | Small-team operability, SLOs, restore, safe releases | M | 1 | US-082; owned by A9. Checklist 07 H |

## 4. Derived functional requirements (new IDs)

These split pack REQs into testable pieces. They use `FR-` IDs and trace to a REQ. They do not change the pack.

| FR | Statement | Traces | Pri | Ph |
|---|---|---|---|---|
| FR-001 | Request state machine follows `02-access-request-state-machine.md`; states come from `REQUEST_STATES`. | REQ-034, 036 | M | 1 |
| FR-002 | Workflow timers and SLAs are data in `workflow_config`. | REQ-034, GATE-COMMITTEE | M | 1 |
| FR-003 | Committee criteria and N-of-M are data. | REQ-017, ASSUMPTION-04 | M | 1 |
| FR-004 | Partial approval is item-level. | REQ-034 | M | 1 |
| FR-005 | Bulk import has a mandatory dry-run and batch ID. | REQ-016, 028, 067 | M | 1 |
| FR-006 | Import and entry reject suspected identifiers (pattern checks), whole file on hit. | REQ-042 | M | 1 |
| FR-007 | Every record has `last_verified_at`. A record older than `stale_after_days` appears on the stale list. | REQ-067 | M | 1 |
| FR-008 | Clinician actions are enum-only: `confirm_record`, `flag_record`. | REQ-068, 042 | M | 1 |
| FR-009 | k-anonymity applies to every count shown to `researcher_il`, `researcher_intl`, `anonymous`. Includes totals that allow subtraction attacks. | REQ-033 | M | 1 |
| FR-010 | Pilot metrics are emitted as events with no identifiers. | REQ-066 | M | 1 |
| FR-011 | Four-eyes approval for grants of `system_admin`, `committee_member`, `national_coordinator` roles. | REQ-045, 018 | M | 1 |
| FR-012 | Public contact form and join form store no sample data and are rate-limited. | REQ-019 | M | 1 |
| FR-013 | Each request item keeps `sample_code` or saved filter, plus `center_id` and `item_state`. | REQ-034 | M | 1 |
| FR-014 | Applicant timeline shows state, date, actor role, structured message. | REQ-036 | M | 1 |
| FR-015 | Notification emails carry no sample data and no request content. | REQ-042 | M | 1 |
| FR-016 | Clone-from-expired/rejected request into a new cart. | REQ-006 | S | 1 |
| FR-017 | Digest notifications for clinicians (weekly). | REQ-068 | S | 1 |

## 5. Non-functional requirements (product view)

Measurable targets. A2, A8, A9 own detail.

| NFR | Target | Traces |
|---|---|---|
| NFR-001 | Search results in under 1 s at p95 for 50,000 synthetic records. | REQ-030, 031 |
| NFR-002 | Public pages: LCP under 2.5 s on mobile profile. | REQ-021 |
| NFR-003 | Zero critical or serious axe violations on all pages, he and en. | REQ-022 |
| NFR-004 | Protected area 99.5% monthly. Public site 99.9% monthly. | REQ-072, ASSUMPTION-05 |
| NFR-005 | RPO 15 min, RTO 4 h. Restore tested. | REQ-048, 072 |
| NFR-006 | Clinician weekly effort target under 5 minutes. | REQ-068 |
| NFR-007 | A coordinator imports 500 rows in one session. | REQ-016 |

## 6. Cut line if capacity is short

Cut in this order. M items never cut.
1. REQ-025 analytics depth (keep metric events).
2. REQ-023 SEO depth (keep titles, meta, sitemap).
3. FR-016 clone request.
4. FR-017 digest notifications.
