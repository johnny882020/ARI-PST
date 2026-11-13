# QA scripts

Run everything: `node docs/qa/scripts/run-all.mjs` (from the repo root). Results go to `docs/qa/results/*.json`, screenshots to `docs/qa/screenshots/<area>/`.

| Script | What it does | Needs |
|---|---|---|
| `01-gallery.mjs` | Builds the design-system gallery, serves it on :4801, runs he/en x light/dark x desktop/mobile: axe, contrast, target size, overflow, keyboard, overlays, long Hebrew strings, reduced motion | nothing |
| `02-public-site.mjs` | Builds `apps/public-site`, serves `dist` (:4811) and `dist-analytics` (:4812), audits all 43 pages x 2 variants, consent, forms (mocked endpoint), language switch, links | nothing |
| `03-web-sweep.mjs` | Every route per role (6 roles), he/light/desktop and en/dark/mobile, role guards, anonymous redirects | mock server on :3010 |
| `03b-web-flows.mjs` | Functional flows: search suppression, cart, request wizard, tracker, registrations, CSV dry run, committee view, admin pages, session timeout (about 2 minutes), login/MFA/register errors | mock server on :3010 |
| `05-report-stats.mjs` | Prints the pass/fail counts used in REPORT.md | the JSON results |

Mock server: `cd apps/web && npx vite build && PORT=3010 SERVE_DIST=1 node mock-server/server.mjs &`. Use `WEB_URL=http://localhost:8080` to point stages 3 and 3b at another origin (use `localhost`, not `127.0.0.1`, because of the `__Host-` cookies). `SKIP_WEB=1` skips stage 3.

Helpers: `lib.mjs` (browser, axe, contrast and target audits, static server), `web-lib.mjs` (login, routes per role, TOTP).

## Full stack (manual, stage 4)
```
PGPORT=55434 PGDATA=/tmp/qa-pg DBNAME=ari_pst_qa bash apps/api/scripts/test-db.sh
cd apps/api && DB_RUNTIME_URL=postgres://app_runtime@127.0.0.1:55434/ari_pst_qa DB_ADMIN_URL=postgres://postgres@127.0.0.1:55434/ari_pst_qa node_modules/.bin/tsx ../../docs/qa/scripts/seed-fullstack.mts   # writes /tmp/qa-seed.json
psql -h 127.0.0.1 -p 55434 -U app_readonly_bg -d ari_pst_qa -c "select agg.refresh_snapshot()"
DATABASE_URL=postgres://app_runtime@127.0.0.1:55434/ari_pst_qa PORT=8080 PUBLIC_ORIGIN=http://localhost:8080 WEB_DIST_DIR=$PWD/../web/dist node_modules/.bin/tsx src/server.ts
```
Sign in at http://localhost:8080 with the users in `/tmp/qa-seed.json` (password `correct-horse-battery-1`, TOTP from the stored secret; `loginReal` in `web-lib.mjs` does this). The seed reuses the API test harness and creates synthetic data only. A TOTP code can be used once per 30 seconds.
