# 01 Sample record schema v1

Status: draft v1 for GATE-SCHEMA. Covers REQ-028, REQ-029, REQ-040, REQ-041, REQ-042.
Source: contract pack section 4 (Doc section 6.2). DB: `sql/001_core.sql`. API: `openapi/openapi.yaml`.

## Privacy classes
| Class | Meaning | Who may see |
|---|---|---|
| P0 | Public vocabulary or reference data | Everyone |
| P1 | Index attribute. Not identifying alone. Coded. | clinician (own center), coordinator. Others only inside k-anonymous counts |
| P2 | Operational metadata | Coordinator, clinician (own center), admin for audit |
| P3 | Link or secret | Never stored in the portal |

## Fields
Source systems: `ENTRY` = coordinator entry screen. `IMPORT` = CSV/XLSX. `MADGAM` = Madgam base data via coordinator import. `REDCAP` = reference taken from the center's RedCAP definition (no values copied beyond the listed code). `SYS` = set by the system.

| Field (API / DB) | Type | Controlled vocabulary | Null | Class | Source | Validation rule |
|---|---|---|---|---|---|---|
| `sampleCode` / `samples.id` | text `smp_` + ULID | none | no | P1 | SYS | Regex `^smp_[0-9A-HJKMNP-TV-Z]{26}$`. Server generated. Never derived from patient data. Import cannot set it on create |
| `sourceCenterId` / `source_center_id` | text `ctr_`+ULID, FK | table `centers` | no | P0 | ENTRY, IMPORT | Must exist and be active. Coordinator may use any center. Import file with a center column must match the job center |
| `diagnosisCode` / `diagnosis_code` | text, FK | table `diagnosis_terms` (see 02) | no | P1 | ENTRY, IMPORT, MADGAM, REDCAP | Must be a selectable term. Any level allowed. Level `type` preferred. Unknown or retired code is rejected |
| `ageBandAtDiagnosis` / `age_band_at_diagnosis` | enum | `0_lt1` `1_lt3` `3_lt6` `6_lt10` `10_lt15` `15_lt18` (ASSUMPTION-01) | no | P1 | ENTRY, IMPORT | Exact age is never accepted. The importer rejects a numeric age column (rule UNKNOWN_COLUMN) |
| `sex` | enum | `female` `male` `other_or_unknown` | no | P1 | ENTRY, IMPORT | Enum only |
| `sampleType` / `sample_type` | enum | `ffpe` `frozen` `csf` `plasma_or_liquid_biopsy` `isolated_dna_rna` | no | P1 | ENTRY, IMPORT | Enum only. One row per physical sample type |
| `availability` | enum | `available` `limited` `depleted` | no | P1 | ENTRY, IMPORT | `depleted` rows stay in the index but are excluded from request cart counts by default |
| `quantityClass` / `quantity_class` | enum | `small` `medium` `large` (ASSUMPTION-A3-03, per type thresholds in protocol doc) | yes | P1 | ENTRY, IMPORT | Enum only |
| `clinicalTimepoint` / `clinical_timepoint` | enum | `diagnosis` `during_treatment` `relapse` | no | P1 | ENTRY, IMPORT | Enum only |
| `collectionMonth` / `collection_month` | text `YYYY-MM` | none | no | P1 | ENTRY, IMPORT | Regex `^(19[89][0-9]\|20[0-9]{2})-(0[1-9]\|1[0-2])$`. Not in the future. A full date (with day) is rejected as IDENTIFIER_SUSPECTED |
| `attachedData` / `attached_data[]` + table `sample_attached_data` | set of enum | `wes` `wgs` `rna_seq` `mri` `digital_pathology` `redcap_clinical` | no (may be empty) | P1 | ENTRY, IMPORT, REDCAP | Flags only. `wgs` has no portal-held pointer except `external_repo_pointer` (GATE-GENOMICS). Pathology pointer only when Phase 2 port is on |
| `consentStatus` / `consent_status` | enum | `consent_obtained` `broad_consent` `waiver_by_committee` `restricted` `unknown` (ASSUMPTION-A3-04) | no (default `unknown`) | P1 | ENTRY, IMPORT | Enum only. `restricted` blocks cart add until coordinator review |
| `ethicsApprovalRef` / `ethics_approval_id` -> `ethics_approvals.approval_ref` | opaque text 3..64 | none | yes (warning when null) | P2 | ENTRY, IMPORT | Pattern `^[A-Za-z0-9._/-]{3,64}$`. Approval must belong to the same center and be `active`. Opaque ID only. No file, no text (REQ-040) |
| `contactRef` / `contact_ref` | text | center contact role label | no | P0 | SYS (from center) | Default = `centers.contact_role`. Never a person name, phone or email |
| `createdAt` / `created_at` | timestamptz | none | no | P2 | SYS | UTC |
| `updatedAt` / `updated_at` | timestamptz | none | no | P2 | SYS | Trigger on update |
| `lastVerifiedAt` / `last_verified_at` | timestamptz | none | no | P2 | SYS | Set on create, on any edit by coordinator, or on explicit verify action. Drives staleness |
| `sourceSystem` / `source_system` | enum text | `portal_entry` `csv_import` `madgam` `redcap_ref` | no | P2 | SYS | Provenance of last write |
| `isSynthetic` / `is_synthetic` | boolean | none | no | P2 | SYS | `true` in all environments until GATE-PROD-DATA closes. CI check blocks a `false` row in non-prod |

Not in the schema, by rule (REQ-042): name, ID number, date of birth, address, phone, email, MRN, link key, free-text clinical note, exact date. The importer and API reject unknown columns.

## Cross-field rules
1. `ethics_approval.center_id` = `sample.source_center_id` (DB trigger).
2. `deleted_at` set means `availability` is not `available` (DB check).
3. If `attached_data` contains `redcap_clinical`, the center must have `local_system_ref` set.
4. `collection_month` must not precede 1980-01 and must not be in the future (app rule, test TC by A8).
5. Duplicate guard: two rows with identical (center, diagnosis, age band, sex, type, timepoint, month) are allowed (different physical samples) but the importer warns when a file has more than 3 identical rows (rule DUPLICATE_ROW).

## Controlled vocabulary governance
- Enums that rarely change are PostgreSQL enums. Adding a value is an expand step.
- Diagnosis terms are data (table). Changes go through a coordinator-owned vocabulary import and a Git-reviewed seed file.
- Every vocabulary change is audited (`vocab.update`).
- Label sets live in `packages/i18n` under `search.filters.<facet>.<value>` keys with he and en.

## ASSUMPTIONs introduced here
- ASSUMPTION-A3-01: Samples are the unit of record (one row per physical sample or aliquot class), not patients. No patient table exists in the portal.
- ASSUMPTION-A3-02: `sex` vocabulary is coarse on purpose. Finer values raise re-identification risk.
- ASSUMPTION-A3-03: `quantity_class` thresholds are defined per sample type in the collection-protocols document (Phase 0).
- ASSUMPTION-A3-04: `consent_status` vocabulary is a placeholder until legal and the ethics lead define it. Needs legal review.
