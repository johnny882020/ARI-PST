# A1 to A3 (Data and Integration)
1. Table names in doc 04 are illustrative. Please own the final schema; keep one owner module per table.
2. Confirm `center_id` is on every center-scoped table (RLS, ADR-008).
3. Confirm Hebrew/English synonym table design for search (ADR-005) and Postgres extensions needed (`pg_trgm`).
4. Define the export archive format (SQL + manifest + checksums) for ADR-010.
