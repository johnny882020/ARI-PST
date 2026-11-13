# 00 — Contract Pack (binding for all agents)

Source of truth: `פורטל ARI-PST — מסמך תפיסה ואפיון` v1.0, Sept 2026 (called "the Doc"). Section numbers below are Doc sections.
Language rule: short sentences. One idea each. Define each acronym once.
Everything here is binding. If your design conflicts with this pack, the pack wins. Raise a conflict in `plan/requests/`.

## 1. Platform stance (binding)
- **Git is the source of truth.** Every change = commit + pull request. No manual production changes.
- **Auto-deploy to Render.** `main` → production (protected area: manual approval gate; public site: automatic). `staging` → staging. Every PR → preview with **synthetic data only**. Deploy only after CI passes (Render "After CI Checks Pass" auto-deploy option — verify name in docs). Infra in `render.yaml` Blueprint.
- **Portable to Base44 later (TBD, not decided).** Rules: standard stack only; hexagonal core (domain never imports DB/auth/storage/email/search libs); contracts first (OpenAPI + SQL schema); platform capability map; migration split by layer (public site → protected front end → back end/data last); data portability (export/import round trip); portability tests in CI; an architecture test fails the build if the domain imports a platform library.
- Lovable path: **out of scope** unless the owner reopens it.
- **No real data before entry conditions (Doc §8):** managed DB, auth, RBAC, audit logs, full export, DPA, storage-region control, migration path. Until all are met, every environment uses **synthetic data only**. Phase 1 is built "production-ready", but go-live with real index data is blocked by `GATE-PROD-DATA`.

## 2. Fixed technology baseline (all agents use this; deviations need an ADR)
| Area | Choice |
|---|---|
| Language | TypeScript (strict), Node.js LTS |
| Monorepo | pnpm workspaces + Turborepo-style task graph (plain pnpm scripts acceptable) |
| API | Fastify, REST, OpenAPI 3.1 contract-first, JSON |
| DB | PostgreSQL (managed, Render), SQL migrations (plain `.sql`, forward-only, expand/contract), Row-Level Security (RLS) |
| Search | PostgreSQL full-text + `pg_trgm`. No external search engine in Phase 1. |
| Auth | Own `AuthPort`. Phase-1 adapter: local accounts, Argon2id, WebAuthn passkeys + TOTP fallback, server-side sessions. OIDC adapter for institutional SSO in Phase 2. |
| Files | `ObjectStorePort` (S3-compatible API). Phase 1 uses it only for CSV import staging and exports. |
| Public site | Astro static site, he/en, content in Git (Markdown/JSON) edited via a Git-based CMS UI for non-technical staff (Decap CMS assumed — ADR) |
| Protected app | React + Vite SPA, talks only to the generated API client |
| Design system | `packages/design-system` (tokens + components), CSS logical properties, light/dark |
| Tests | Vitest, fast-check (property), Playwright (e2e, he+en), axe, k6, Spectral (OpenAPI lint), dependency-cruiser (architecture) |
| CI | GitHub Actions (host-neutral notes) |
| Hosting | Render: static site, web service (API), Postgres, cron jobs, private network. Region: see GATE-REGION. |

Repo layout (names are final):
```
apps/public-site   apps/web   apps/api
packages/domain  packages/contracts  packages/api-client  packages/design-system  packages/i18n  packages/synthetic-data
adapters/ (inside apps/api/src/adapters: postgres, auth-local, objectstore-s3, email-smtp, clock, audit-pg)
db/migrations  infra/render.yaml  infra/terraform  .github/workflows  plan/  docs/
```

## 3. Requirements (stable IDs). Priority: M/S/C/W = MoSCoW. Phase 0-3.
| ID | Requirement | Doc § | Pri | Ph |
|---|---|---|---|---|
| REQ-001 | One asset, two layers: public site + protected area | 1 | M | 1 |
| REQ-002 | Portal holds an index, not an identified clinical repository; tissue and identifying data stay in centers | 1,6.1 | M | 1 |
| REQ-003 | Pilot combines Shaare Zedek (שערי צדק) and "Madgam" (מדגם) | 1,9 | M | 1 |
| REQ-004 | Visibility: one public face (researchers, centers, infrastructure, partners) | 3 | M | 1 |
| REQ-005 | Discovery: researcher learns which samples/data exist without identifying info | 3,6.3 | M | 1 |
| REQ-006 | Governed, tracked access-request process | 3,6.4 | M | 1 |
| REQ-007 | Reduce physician load: entry is done by national research coordinator, not treating doctor | 3,11 | M | 1 |
| REQ-008 | Standardization: uniform fields and collection protocols | 3,9 | M | 1 |
| REQ-009 | NOT a clinical system; not a replacement for medical record or RedCAP | 3 | M | 1 |
| REQ-010 | NOT a central physical biobank | 3 | M | 1 |
| REQ-011 | NO analytics/AI layer in Phase 1 | 3,9 | W | 1 |
| REQ-012 | Anonymous visitor: public area only | 4 | M | 1 |
| REQ-013 | Registered Israeli academic researcher: aggregate view + submit requests | 4 | M | 1 |
| REQ-014 | International researcher/partner: aggregate view only | 4 | M | 1 |
| REQ-015 | Treating clinician/coordinator: full access incl. identification, own center only (see GATE-CLINICIAN-ID) | 4,6.5 | M | 1 |
| REQ-016 | National research coordinator: broad cross-center non-identified index; entry and upkeep | 4,6.5 | M | 1 |
| REQ-017 | Access committee / steering committee: approve/reject requests; dashboard | 4 | M | 1 |
| REQ-018 | System admin: permissions, logs, content | 4 | M | 1 |
| REQ-019 | Public pages: Home, About, Research areas, Community, Infrastructure, Global partners, News, Patients & families, Join/Contact, Login entry | 5 | M | 1 |
| REQ-020 | Bilingual Hebrew (full RTL) + English | 5 | M | 1 |
| REQ-021 | Mobile-friendly | 5 | M | 1 |
| REQ-022 | Accessibility: Israeli standard + WCAG 2.1 AA | 5 | M | 1 |
| REQ-023 | Basic SEO | 5 | S | 1 |
| REQ-024 | Content managed by non-technical team | 5 | M | 1 |
| REQ-025 | Analytics (with consent) | 5 | S | 1 |
| REQ-026 | Privacy policy and terms of use | 5 | M | 1 |
| REQ-027 | Distributed index: metadata layer, searchable, points to contact at the holding center | 6.1 | M | 1 |
| REQ-028 | Sample record schema (fields in §4 below, from Doc §6.2) | 6.2 | M | 1 |
| REQ-029 | Schema derived from Madgam base fields + clinically required fields; aligned with RedCAP definitions | 6.2 | M | 0-1 |
| REQ-030 | Free-text search and "smart" search | 6.3 | M | 1 |
| REQ-031 | Filters: diagnosis, sample type, age, center, available attached data, clinical time point | 6.3 | M | 1 |
| REQ-032 | External researcher sees aggregate counts only, never individual records | 6.3 | M | 1 |
| REQ-033 | k-anonymity screen: counts below threshold are not shown; merged into broader category | 6.3,11 | M | 1 |
| REQ-034 | Access-request flow: search → request cart → form → coordinator pre-check → committee decision → center coordination → MTA/DTA → delivery + status tracking | 6.4 | M | 1 |
| REQ-035 | Request form fields: research question, applicant IRB/Helsinki approval, planned use, funding sources | 6.4 | M | 1 |
| REQ-036 | Every request step is documented and visible to the applicant | 6.4 | M | 1 |
| REQ-037 | Three access levels (clinician-own-center / national coordinator / external) | 6.5 | M | 1 |
| REQ-038 | Two-step coding; link keys never stored in the portal | 6.5,11 | M | 1 |
| REQ-039 | Identified clinical data stays in the center's RedCAP, fully separated from the index | 6.5,7 | M | 1 |
| REQ-040 | Each record documents the Helsinki/ethics approval that applies to it | 7 | M | 1 |
| REQ-041 | Layer separation: portal holds de-identified data only | 7 | M | 1 |
| REQ-042 | No direct identifiers entered into the portal at any step | 7 | M | 1 |
| REQ-043 | Encryption in transit and at rest | 7 | M | 1 |
| REQ-044 | Two-factor authentication for the protected area | 7 | M | 1 |
| REQ-045 | Role-based access control | 7 | M | 1 |
| REQ-046 | Full audit log: who viewed, who downloaded, who approved | 7 | M | 1 |
| REQ-047 | Retention and deletion policy | 7 | M | 1 |
| REQ-048 | Backup and restore | 7 | M | 1 |
| REQ-049 | Compliance check: Israeli medical-information regulation, HIPAA/GDPR as applicable (needs legal review) | 7 | M | 0 |
| REQ-050 | DPA with the platform provider | 7,8 | M | 0 |
| REQ-051 | DTA and MTA agreements per center | 7 | M | 1 |
| REQ-052 | Decision on geographic storage region | 7 | M | 0 |
| REQ-053 | Separate public site from protected area | 8,11 | M | 1 |
| REQ-054 | Protected-area entry conditions: managed DB, auth, RBAC, audit logs, full export, DPA, region control, migration path | 8 | M | 1 |
| REQ-055 | Integration: RedCAP — field mapping and reference only, no identifiers | 8 | M | 1 |
| REQ-056 | Integration: Madgam — schema alignment and update process | 8 | M | 1 |
| REQ-057 | Integration: digital pathology scans — separate object storage + viewer | 8,9 | S | 2 |
| REQ-058 | Genomics: availability flag only in Phase 1 | 8 | M | 1 |
| REQ-059 | Institutional SSO | 8,9 | S | 2 |
| REQ-060 | Partner API for global partners | 8,9 | C | 3 |
| REQ-061 | Phase 0: decisions, spec, schema v1, unified collection-protocols document | 9 | M | 0 |
| REQ-062 | Phase 1 scope: live public site; protected area with login+permissions; index with Shaare Zedek + Madgam; search+filters; end-to-end request form; audit log | 9 | M | 1 |
| REQ-063 | Phase 1 exit: access requests that completed the full path through actual delivery | 9 | M | 1 |
| REQ-064 | Phase 2: Ramban/other centers, SSO, pathology scans, admin dashboard, full bilingual; exit: ≥3 centers feeding regularly | 9 | S | 2 |
| REQ-065 | Phase 3: sarcomas, partner API, analytics/AI layer; exit: basis for a clinical trial | 9 | C | 3 |
| REQ-066 | Success metrics instrumented: centers feeding; record count + field completeness; registered researchers + searches; requests + completion rate + request-to-delivery time; share of coordinator-entered records; studies/publications citing the index | 10 | M | 1 |
| REQ-067 | Ongoing update mechanism + owner for freshness (stale-data risk) | 11,12 | M | 1 |
| REQ-068 | Minimal entry screen; show repeat value to the clinician | 11 | M | 1 |
| REQ-069 | Git + Render auto-deploy delivery model | owner | M | 1 |
| REQ-070 | Portability to Base44 (later, TBD) | owner | M | 1 |
| REQ-071 | Pediatric-oncology-appropriate brand: warm, hopeful, dignified, scientific; Apple-style UI | owner | M | 1 |
| REQ-072 | Small-team operability, SLOs, tested restore, safe releases | owner | M | 1 |

Phase 1 scope per owner: **fully functional, all users, permissions, database, security layers.** Phase 2/3 items appear only as design hooks (ports, flags), not as built features.

## 4. Sample record v1 (Doc §6.2) — canonical field names
`sample_code` (coded global ID, opaque, ULID-style, never derived from patient data) · `source_center_id` · `diagnosis_code` (WHO CNS/pediatric tumor coding, ICD-O-3 morphology as reference; see A3) · `age_band_at_diagnosis` (enum bands) · `sex` · `sample_type` (enum: `ffpe`,`frozen`,`csf`,`plasma_or_liquid_biopsy`,`isolated_dna_rna`) · `availability` (`available`,`limited`,`depleted`) · `quantity_class` · `clinical_timepoint` (`diagnosis`,`during_treatment`,`relapse`) · `collection_month` (`YYYY-MM`) · `attached_data` (set: `wes`,`wgs`,`rna_seq`,`mri`,`digital_pathology`,`redcap_clinical`) · `consent_status` · `ethics_approval_ref` (opaque approval ID only) · `contact_ref` (center contact role, not a personal address) · `created_at`,`updated_at`,`last_verified_at`.
Never in the portal: names, ID numbers, DOB, addresses, phones, emails of patients, MRN, link keys, free-text clinical notes, exact dates.

## 5. Roles (final names, used in code and docs)
`anonymous` · `researcher_il` · `researcher_intl` · `center_clinician` (scoped to one `center_id`) · `national_coordinator` · `committee_member` · `system_admin`.
Role mapping to Doc §4: visitor, Israeli researcher, international researcher, treating clinician/coordinator, national research coordinator, access/steering committee, system admin.
Separation of duties: `system_admin` cannot approve requests and cannot read sample data. `committee_member` cannot edit the index.

## 6. Module map (names are final)
`public-site` · `identity-access` · `sample-index` · `search-discovery` · `access-requests` · `audit-log` · `center-ingestion` · `admin-governance` · `notifications` · `observability`.

## 7. Decision gates (do not decide; use the default until closed)
| ID | Question (Doc §12) | Default every agent uses |
|---|---|---|
| GATE-PLATFORM | Base44 vs Lovable | CLOSED by owner: Git+Render now; Base44 later TBD; Lovable out |
| GATE-OPERATOR | Who operates/owns the portal (Tech4Cancer, Shaare Zedek foundation, separate entity) | Assume Tech4Cancer operates; legal owner TBD. Contracts are not drafted by us. |
| GATE-BUDGET | Available budget | Unknown. Plan qualitative cost drivers + a lean option. |
| GATE-GENOMICS | Full sequences or aggregation only | Availability flag only (Doc §8 Phase 1) |
| GATE-PATHOLOGY | Will all centers upload digital pathology scans | Phase 2; ports only |
| GATE-INGEST | Ongoing ingestion/update mechanism | Coordinator entry screen + CSV/XLSX bulk import + staleness tracking |
| GATE-COMMITTEE | Committee composition and approval criteria | Configurable roles + decision form; criteria are data, not code |
| GATE-COMPLIANCE | Does the chosen platform meet HIPAA and Israeli medical-information rules | Treat as NOT confirmed → synthetic data only |
| GATE-K | k-anonymity threshold ("to be set") | k = 5 default, configurable per field set; ADR in A2 |
| GATE-REGION | Storage region (Doc §7) | Render EU region (Frankfurt) assumed; verify list; Israel region UNVERIFIED |
| GATE-CLINICIAN-ID | Doc §4/6.5 says clinician has "full access incl. identification" but §6.5/7 say the portal holds no identifiers | Clinician sees the full coded record of own center + a reference to the center's local system. Identity resolution happens in the center's own system, never in the portal. |
| GATE-PROD-DATA | Go-live with real index data | Blocked until DPA, region control, export/import round trip, migration path, legal review, pen-test are all done |
| GATE-SCHEMA | Schema v1 sign-off by clinical leads (Phase 0) | Use the §4 field list as draft v1 |

## 7b. Assumptions to use everywhere
- ASSUMPTION-01: `age_band_at_diagnosis` bands: 0–<1, 1–<3, 3–<6, 6–<10, 10–<15, 15–<18 (years). To be confirmed clinically.
- ASSUMPTION-02: Doc names "Ramban/Rambam" for Phase 2 center; Hebrew term רמב"ם.
- ASSUMPTION-03: Researcher registration is by invitation/approval by `national_coordinator`; email verified.
- ASSUMPTION-04: Committee decisions need N-of-M votes; N and M are configuration.
- ASSUMPTION-05: SLO targets: public site 99.9%, protected area 99.5% monthly; RPO 15 min, RTO 4 h for protected DB (to verify vs Render plan limits).
- ASSUMPTION-06: Team size 3–6 engineers plus clinical/ops leads.

## 8. Cross-cutting rules
- **IDs:** requirements `REQ-###`; ADR `ADR-###`; assumption `ASSUMPTION-##`; gate `GATE-NAME`; open question `OPEN-###`; risk `RISK-##`; runbook `RB-##`; user story `US-###`; test case `TC-###`.
- **Entity IDs:** ULID strings with prefix, e.g. `smp_01H...`, `req_...`, `usr_...`, `ctr_...`.
- **Dates:** ISO 8601 UTC in APIs (`2026-09-01T10:00:00Z`). Sample collection date is `YYYY-MM` only.
- **i18n keys:** `area.screen.element` (e.g. `search.filters.diagnosis.label`). Locales `he`, `en`. Hebrew is the default locale. Hebrew terms next to English in docs where user-facing.
- **Errors:** RFC 9457 Problem Details (`application/problem+json`) with `type`, `title`, `status`, `detail`, `code`, `traceId`. No identifiers in errors.
- **API style:** REST, `/api/v1/...`, cursor pagination, idempotency keys on POST that create requests, OpenAPI 3.1 is the contract.
- **Logging:** structured JSON, no identifiers, no free text from users.
- **Naming:** files kebab-case, TS types PascalCase, DB snake_case, API JSON camelCase.
- **Names:** product "ARI-PST Portal"; brand line "ARI-PST × Tech4Cancer".
- **Mermaid:** every diagram must be valid Mermaid. Keep node IDs simple ASCII; put Hebrew only inside quoted labels.
- **Legal:** never give legal advice. Mark "needs legal review".
- **Facts from the web:** cite source + date, or mark `UNVERIFIED`.
- **Synthetic data only.** Clearly fake names like `Synthetic Center A`. No realistic personal data anywhere.

## 9. File ownership (each agent writes ONLY its folder; cross-agent needs go in `plan/requests/<from>-to-<to>.md`)
| Agent | Owns |
|---|---|
| A1 Architect | `plan/01-architecture/**` |
| A2 Security & Privacy | `plan/02-security-privacy/**` |
| A3 Data & Integration | `plan/03-data-integration/**` |
| A4 Product & Workflow | `plan/04-product-workflow/**` |
| A5 Design & Brand | `plan/05-design-brand/**` |
| A6 Frontend & Public Site | `plan/06-frontend/**` |
| A7 DevOps / CI-CD | `plan/07-devops-cicd/**` |
| A8 V&V | `plan/08-vnv/**` |
| A9 SRE | `plan/09-sre/**` |
| R1, R2 | `plan/10-review/**` |
| Orchestrator | `plan/00-*`, `plan/README.md`, `MASTER-PLAN.md`, `ROADMAP.md`, `decision-register.md`, `traceability-matrix.csv`, `AGENT-RUNBOOK.md`, all code |
Wave 1 agents write plan files only. They do not write application code, except small illustrative snippets inside their plan files.

## 10. Quality bars (each needs measurable acceptance criteria)
User friendly · Reliable · Highly secure and private · Apple-style design · Strong brand · Modular.

## 11. Owner answers (2026-11-13) — confirm the defaults above
- GATE-CLINICIAN-ID: owner chose **coded record + link-out**. Portal never stores identity.
- GATE-K: owner chose **k = 5** (configurable).
- GATE-REGION: owner chose **Frankfurt (EU)** for now. Still needs legal review before real data.
- ASSUMPTION-03 confirmed: researchers **self-register, then national_coordinator approves**.
- Phase 1 = fully functional (all roles, permissions, DB, security layers). Real data stays blocked by GATE-PROD-DATA.
- Render account: owner's own. Deploy only after the owner links the repo and gives the API key through a secure form.
