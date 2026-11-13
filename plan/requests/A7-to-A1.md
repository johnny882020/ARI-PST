# A7 to A1

- Need /healthz (200 only if DB ok and migration level ok; JSON {status,version=git SHA}) and /livez.
- Need pnpm scripts: lint, typecheck, test:unit, test:portability, test:contract, test:rls, test:synthetic-guard, db:migrate, db:seed-synthetic, migrate:deploy, lint:migrations, export:full, import:full, verify:roundtrip, check:capability-map, job:staleness-check, job:audit-chain-verify, start:internal.
- Need packages named @ari/api, @ari/web, @ari/public-site.
- API must handle SIGTERM within 60 s and refuse boot if DATA_CLASSIFICATION is not synthetic outside prod.
