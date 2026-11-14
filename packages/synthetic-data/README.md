# @ari/synthetic-data

Deterministic generator for synthetic portal data: centers, donors, samples, requests and import files. Use it for every test, fixture, seed and demo. Never add real or realistic personal data.

## Scripts

| Command | What it does |
|---|---|
| `pnpm --filter @ari/synthetic-data test` | Unit tests |
| `pnpm --filter @ari/synthetic-data typecheck` | TypeScript check |

## Exports

| Export | Content |
|---|---|
| `generate` | Builds a dataset from a seed and options. The same seed gives the same data |
| `toSql`, `toSqlStatements`, `toNdjson` | Output as SQL or NDJSON |
| `makeImportFile` | A CSV import file, with optional faulty rows for tests |
| `mulberry32`, `makeId`, `hex32` | Seeded random helpers |

Users: `db/seed.mjs` (local and CI) and the API job `seed-synthetic` (Render).
