# 03 Data and Integration (A3)

| # | File | Content |
|---|---|---|
| 1 | `01-sample-schema-v1.md` | Field table, privacy classes, rules |
| 2 | `02-diagnosis-coding.md` | WHO CNS5 strategy, ICD-O-3 as reference, enums |
| 3 | `03-data-model.md` | ERD, access matrix, RLS, migrations |
| 4 | `04-search-design.md` | FTS, trigram, facets, smart search, k-anonymity |
| 5 | `05-ingestion.md` | Entry screen, bulk import, staleness, ethics link, clinician value |
| 6 | `06-integrations.md` | RedCAP, Madgam, pathology, genomics, SSO, partner API |
| 7 | `07-api-conventions.md` | Versioning, RFC 9457 errors |
| 8 | `08-retention-export-backup.md` | Retention, backup, export format |
| 9 | `09-synthetic-data-spec.md` | Generator spec |
| - | `sql/001..004`, `sql/seed`, `sql/tests` | Tested DDL, RLS, functions |
| - | `openapi/openapi.yaml` | OpenAPI 3.1 contract (core resources) |
| - | `yaml/*.yaml` | Import columns, error codes, generator profiles |

Validation done: all SQL applied on PostgreSQL 16.15 from an empty database; test script passes. YAML parsed with PyYAML. OpenAPI: refs resolved, schemas checked with a JSON Schema 2020-12 validator. Spectral not run.
Synthetic data only.
