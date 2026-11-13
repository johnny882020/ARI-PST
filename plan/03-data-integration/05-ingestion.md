# 05 Ingestion for the national coordinator

Covers REQ-007, REQ-016, REQ-040, REQ-066, REQ-067, REQ-068, GATE-INGEST. Module: `center-ingestion`. Tables: `samples`, `import_jobs`, `import_job_rows`, `ethics_approvals`, `staleness_*`. Template: `yaml/import-columns.yaml`.

## Who enters data
Only `national_coordinator` writes sample rows (REQ-007). A `center_clinician` reads. A clinician can ask the coordinator to verify or fix a record (a request ticket, Phase 1: email from the center mailbox; a "flag record" button is a Should for A4).

## 1. Minimal entry screen (one sample)
Goal: under 60 seconds per record. Nine required fields, all pick-lists except month.

| # | Field | Control | Default / help |
|---|---|---|---|
| 1 | Center | select | last used |
| 2 | Diagnosis | search-as-you-type tree (uses `/search/suggest` and `/diagnoses`) | shows he + en label |
| 3 | Age band | 6 buttons | |
| 4 | Sex | 3 buttons | |
| 5 | Sample type | 5 buttons | last used |
| 6 | Availability | 3 buttons | `available` |
| 7 | Clinical time point | 3 buttons | `diagnosis` |
| 8 | Collection month | month picker (no day) | |
| 9 | Ethics approval | select from the center's approvals | last used; warning if empty |
Optional (collapsed): quantity class, attached data checkboxes, consent status.
Behaviour:
- "Save and add another" keeps fields 1, 5, 7, 9. Fast repeat entry.
- Server validates with the same rules as import. Errors name the field and rule only.
- A banner states: "Do not enter names, ID numbers, dates of birth or notes." There is no free-text field, so there is nothing to leak.
- On save, the new `sampleCode` is shown with a copy button. The coordinator writes it in the center's local system (the portal never stores the link key, REQ-038).
- Accessibility and he/en are A5/A6 duties.

## 2. Bulk import (CSV and XLSX)
Flow (also in OpenAPI `/import-jobs`):
1. `GET /import-templates/{csv|xlsx}`. XLSX has a data dictionary sheet and he display headers.
2. `POST /import-jobs` (file). The server stores the file in `ObjectStorePort` staging (private, encrypted, key `imports/<jobId>/source`), computes SHA-256, creates the job with `mode=dry_run`, returns 202.
3. Worker validates (status `validating` then `validated` or `rejected`). **Nothing is written to `samples` in a dry run.**
4. Coordinator reads counters and the row list (`GET .../rows?outcome=rejected`) or downloads the CSV rejection report.
5. `POST .../commit` with the same SHA-256 creates a child job. The commit re-validates against current data (data may have changed), then writes in **one transaction per 500 rows**. A failed batch rolls back only that batch. The job reports which batches committed. The same file can be re-run safely (updates are idempotent by `sample_code`; creates are not repeated: the worker looks up earlier committed rows with the same file hash and row number).
6. Audit events: `import.upload`, `import.validate`, `import.commit`, `import.report_download`, and one `sample.create` or `sample.update` per row (batched details, ids only).

Validation stages (stop at first failing stage per scope):
| Stage | Scope | Rules |
|---|---|---|
| S0 file | file | size, format, MIME sniff, zip-bomb guard, XLSX: no formulas, macros, external links, one sheet read |
| S1 header | file | exact known columns, no unknown, required present (rule UNKNOWN_COLUMN, REQUIRED) |
| S2 cell guards | row | identifier guards G1..G6 on every cell (IDENTIFIER_SUSPECTED) |
| S3 type and vocab | row | enums, patterns, diagnosis map (VOCAB, FORMAT, RANGE) |
| S4 relations | row | center exists and allowed, ethics approval belongs to center and is active (CENTER_MISMATCH, ETHICS_MISSING, ETHICS_EXPIRED, NOT_FOUND) |
| S5 duplicates | file | repeated rows (DUPLICATE_ROW), conflicting updates to the same `sample_code` (rejected) |

**Rejection report.** CSV with columns `row_no, outcome, field, rule, severity`. It has no cell values. The coordinator opens the original file at that row. Reason: a rejected cell may hold an accidental identifier, and the portal must not echo or store it (REQ-042). `import_job_rows.issues` stores the same data. Report and staging file are deleted at `expires_at` (30 days default; the source file is deleted 7 days after commit, ASSUMPTION-A3-06).

**Create mapping file.** After commit, `GET .../result-map` (CSV `row_no,sample_code`) lets the coordinator write codes back to the center's local list. It is the only place where a row number meets a code. It is kept 30 days then purged. It holds no patient data. (OpenAPI: `/import-jobs/{jobId}/result-map`.)

Limits: 10 MB, 20000 rows, 3 concurrent jobs per user. XLSX read with a streaming parser, no formula evaluation. Worker runs as a separate process with the `portal_coordinator` DB role and the importing user's `app.user_id`.

Strict mode: a flag that turns warnings into errors. Used for the first import from a new center.

## 3. Updates and staleness (REQ-067)
- Updating a record sets `updated_at` and `last_verified_at`.
- **Verify without change:** `POST /samples/{id}/verify`, or an import row with `verified=true` and no field change. Sets `last_verified_at` only.
- **SLA:** table `staleness_policies`. Default 180 days with a 30-day warning (ASSUMPTION-A3-07, owner sets it). Per-center override allowed.
- View `v_sample_staleness`: `fresh` / `due_soon` / `stale`.
- **Weekly job** (Render cron, Monday 06:00 UTC): for each center with due or stale rows, insert `staleness_reminders` and send a notification (A1 `notifications` module) to the center mailbox and to the coordinator. No sample ids in the email, counts only.
- **Escalation:** `stale` rows older than SLA + 90 days are hidden from default search ordering only (still counted) and listed on the coordinator dashboard. They are not deleted automatically. (Decision for A4: hide from aggregates after SLA+180? OPEN-A3-03.)
- **Owner:** national coordinator is the accountable owner of freshness (REQ-067). Admin dashboard (Phase 2) shows `v_center_summary`.
- Metrics (REQ-066): `v_center_summary` and `v_center_completeness` feed centers-feeding, record counts, field completeness, coordinator-entered share (`source_system`).

## 4. Per-record ethics-approval link (REQ-040)
- Table `ethics_approvals`: one row per approval reference per center. Opaque `approval_ref` only (no document, no text).
- Each sample points to one approval (`ethics_approval_id`). Same-center rule is a DB trigger.
- Missing link is a warning on entry and import, and a count in `v_center_summary.missing_ethics_link`.
- Approval expiry: nightly job sets `status=expired` where `valid_to < today`. Samples under an expired approval show a flag to the coordinator. They stay searchable but the request pre-check step must resolve it (A4 rule).
- If one sample falls under several approvals: Phase 1 stores the primary one. A join table `sample_ethics_approvals` is an expand step if needed. OPEN-A3-04 (clinical/legal).
- Needs legal review: how approval validity relates to use of existing samples.

## 5. Repeat value for clinicians (REQ-068)
Principle: the clinician gives nothing and gets something. Screen "My center" (center_clinician, own center, from `v_center_summary`, `v_center_completeness`, `center_request_activity()`):
- Count of the center's samples by diagnosis, type, availability. A clinician sees all of own rows (not k-limited).
- Freshness: how many records are due or stale, last update date.
- Completeness bars per optional field.
- Activity: how many requests touched the center's samples, how many delivered (counts only, no applicant names).
- Gap view: "what is missing" — samples with no ethics link, no quantity class, no attached-data flags.
- Export own center list as CSV (audited `export.download`, coded fields only). Helps the clinician cross-check with the local RedCAP using the codes the coordinator wrote there.
- Cross-center context: the clinician can see k-anonymous national totals (same functions as external researchers) to see where their samples fit. Never other centers' rows.
Test: A8 checks a clinician cannot read another center's row (RLS) and sees no applicant identity.

## Edge cases
| Case | Rule |
|---|---|
| Coordinator enters a sample for the wrong center | Update of `source_center_id` is blocked. Retire and re-create (audited) |
| Same file uploaded twice | Same SHA-256 and same parent: commit is idempotent (updates). Creates: result map reused by looking up earlier committed rows with the same `file_sha256` and `row_no` in `import_job_rows` (action `create`, `sample_id` set) |
| Partial failure | Per-batch transaction. Job status `failed` with counters. Re-run picks up remaining rows because created rows now carry codes in the result map |
| Hebrew in cells | Allowed only in `diagnosis_source_value`. All other columns are ASCII codes |
| XLSX numeric month (date serial) | Rejected FORMAT. Month must be text `YYYY-MM` |
