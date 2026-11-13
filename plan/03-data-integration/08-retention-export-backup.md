# 08 Retention, deletion, backup scope, export format

Covers REQ-047, REQ-048, REQ-054 (full export), REQ-070 (portability). All periods are **proposals**. Legal sets them. Needs legal review (REQ-049). Values live in config, not code.

## Retention and deletion (proposal)
| Data | Retention | Deletion method | Note |
|---|---|---|---|
| Sample rows | While the center keeps the physical sample. Then 24 months after `deleted_at` | Soft delete (`deleted_at`) at once. Purge job hard-deletes after the grace period | Grace lets the coordinator undo |
| Attached-data flags | With sample | Cascade | |
| Ethics approvals | While any sample links, then 24 months | Purge when no link | |
| Request records (form, items, steps, decisions, votes) | Structured record 7 years after `closed`; **free text wiped at 24 months** (C-07; research-governance norm, UNVERIFIED, legal to set) | Purge job. Free text fields wiped first | Needed to show who approved what |
| Resolved request samples | Same as request | Cascade | |
| Import staging files | Source 7 days after commit. Report and result map 30 days | Object-store lifecycle rule + job | `expires_at` |
| Import job rows | 12 months | Purge | No cell values inside |
| Audit events | 7 years (proposal, A2 confirms) | Never edited. Partition by year. Whole partitions archived to write-once storage, then dropped after the term | Hash chain anchors survive the archive |
| Users | While active. 12 months after `closed`, then anonymise (`email` -> hash, `display_name` -> `Deleted user`) | Purge job | Audit rows keep the `usr_` id only |
| Sessions, login attempts | 30 days / 90 days | A2 | |
| Idempotency keys | 24 hours | Purge | |
| Backups | 35 days (C-07; ASSUMPTION-A3-09, check Render plan) | Provider rotation | See below |

Right-to-erasure style requests concern **users** (staff, researchers). The index holds no data subject identifiers, so there is nothing to erase per patient. If a center withdraws a sample, the coordinator retires it. Needs legal review on GDPR/Israeli law applicability to coded data.
Deletion events are audited (`retention.purge` with counts). Deletion from backups happens by rotation; the policy text must say so.

## Backup scope
Include: the whole PostgreSQL database (all schemas), the object-store buckets `exports/` and `imports/` (staging is short-lived, so optional), configuration (`infra/`, Git), secrets inventory (names only, not values).
Exclude: values of secrets (kept in the secret store), build caches.
Targets (ASSUMPTION-05, verify vs Render plan): RPO 15 min (point-in-time recovery with WAL), RTO 4 h. Daily logical dump (pg_dump, custom format) to a separate bucket in the same region, encrypted, 35 days. A **restore test** runs monthly on staging with synthetic data, and the result is recorded (REQ-072, A9 owns the runbook). Backups are encrypted at rest. Backup region = storage region (GATE-REGION). Render managed backup features: UNVERIFIED, A7/A9 confirm.

## Export format (non-proprietary, documented)
Goal: full export and re-import without the platform (REQ-054, REQ-070). Three parts in one archive `ari-pst-export-<YYYYMMDDTHHMMSSZ>.tar.zst` (tar + zstd are open formats; `.tar.gz` also allowed):

1. **NDJSON** (RFC 8259 per line, UTF-8, `\n`): one file per table, `data/<schema>.<table>.ndjson`. Row = JSON object with column names as keys. Timestamps ISO 8601 UTC. `bytea` as hex string. Arrays as JSON arrays. Enums as strings. Order by primary key.
2. **SQL dump**: `sql/schema.sql` (DDL, from `pg_dump --schema-only`) and `sql/data.sql` (`pg_dump --data-only --inserts --no-owner`). Plain text.
3. **Manifest** `manifest.json` with checksums.
Plus `docs/data-dictionary.md` generated from the schema and `openapi.yaml` of the export-time contract.

Manifest example (synthetic values):
```json
{
  "format": "ari-pst-export",
  "formatVersion": "1.0",
  "createdAt": "2026-11-13T10:00:00Z",
  "schemaVersion": "0005",
  "appVersion": "0.1.0",
  "isSynthetic": true,
  "scope": "full",
  "tables": [
    { "name": "portal.samples", "file": "data/portal.samples.ndjson", "rows": 1200,
      "sha256": "0000000000000000000000000000000000000000000000000000000000000000" }
  ],
  "sql": [
    { "file": "sql/schema.sql", "sha256": "0000000000000000000000000000000000000000000000000000000000000000" },
    { "file": "sql/data.sql",   "sha256": "0000000000000000000000000000000000000000000000000000000000000000" }
  ],
  "auditChain": { "lastSeq": 5421, "lastHash": "00" },
  "excluded": ["authn.*"]
}
```
Rules:
- `sha256` of each file. The manifest itself is signed (detached signature `manifest.json.sig`, key held by ops, A2 defines) so tampering is detected.
- **Excluded from full export:** `authn.*` (password hashes, passkeys, TOTP secrets, sessions). Users re-enroll after a restore elsewhere. A separate **encrypted** `authn` export is an ops-only option for same-system restore.
- Scope variants: `full` (admin + ops), `center` (one center, for that center's clinician: samples, flags, approvals only), `audit` (audit slice with chain proof).
- Who may export: `full` and `audit` by `system_admin` **with** dual control (second admin approves). Note `system_admin` cannot read sample data in-app, but a full export contains samples. So the full export is produced by an automated job, written to a bucket only ops can read, encrypted with a key not held by admin alone. A2 must confirm this does not break separation of duties (OPEN-A3-07).
- Every export is audited (`export.create`, `export.download`) with manifest hash.
- **Round trip test** (CI, nightly on synthetic data): export -> create empty DB -> import with `scripts/import-export.ts` -> compare row counts and per-table checksums -> verify audit chain. This is a prerequisite of GATE-PROD-DATA.
- Import order: schema.sql -> data NDJSON in FK order -> verify manifest counts -> `audit.verify_chain()`.
