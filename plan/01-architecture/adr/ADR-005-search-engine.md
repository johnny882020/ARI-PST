# ADR-005 — Search engine
Status: Proposed. Date: 2026-11-13. Covers: REQ-030, REQ-031, REQ-032, REQ-033.

## Context
Index is small (assume under 100,000 records in Phase 1-2; ASSUMPTION). Fields are mostly coded. Free text is limited (no clinical notes).

## Decision
- PostgreSQL full-text search (`tsvector`, `simple` + Hebrew-friendly tokenization in app) and `pg_trgm` for fuzzy match.
- `SearchPort` hides the engine. Adapter `search-pg`.
- Synonym and "smart" search: a synonym table (diagnosis terms he/en) expanded at query time. No ML in Phase 1 (REQ-011).
- k-anonymity applied in the domain after the query, on counts (GATE-K, A2 ADR).
- No Elasticsearch, OpenSearch, or Typesense.

## Consequences
- No extra service or sync job. Same transaction, same RLS.
- Hebrew stemming is weak in stock Postgres. Mitigation: normalize + n-gram trigram + synonym table. Test with he queries (A8).
- Revisit if records exceed ~1M or p95 search > 800 ms.

## Trade-off
Dedicated engine gives better relevance and Hebrew analyzers. It adds sync, cost, and a second place to leak data. We choose simplicity.
