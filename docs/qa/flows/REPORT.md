# End-to-end flows on the production build (E2E-2)

Date: 2026-11-14. Data: synthetic only (`SEED_SYNTHETIC=true`, profile `preview`: 600 samples, 3 centers).

## 1. Summary

- 39 steps ran against the real API and the built SPA. 39 pass. 0 product gaps. 0 fail.
- The full request life cycle works **in the UI** from search to "Closed – delivered": search, cart, request form, pre-check, committee votes, sample links, center answer, MTA/DTA, delivery.
- Flow f uses no `[api]` step. The only `[api]` step left is the negative check in flow i (the API also refuses sample data to the admin).
- 58 screenshots are in [`screenshots/`](screenshots/). Raw results are in [`results.json`](results.json).
- All sanity checks pass (section 4).
- Section 5 lists the issues of the first run and their fixes.

## 2. Environment

| Item | Value |
|---|---|
| Database | PostgreSQL 16, fresh cluster on port 55450. One `NOSUPERUSER` owner, like Render (`scripts/sim-render-db.sh`). |
| Pre-deploy | `scripts/render-predeploy.mjs`: bootstrap, migrate (level 0011), synthetic seed. |
| API | `node apps/api/dist/server.js` on port 18100. `NODE_ENV=production`, `RENDER_EXTERNAL_URL=http://localhost:18100`, `DATA_CLASSIFICATION=synthetic`, `DEMO_MODE=true`, `WEB_DIST_DIR=apps/web/dist`. |
| Public site | `apps/public-site/dist`, static server on port 18101. |
| Browser | Playwright Chromium (pre-installed). Desktop 1280x800, mobile 390x844. Device scale factor 2. |
| Sign-in | Password + TOTP. The TOTP secret uses the same derivation as `scripts/seed-credentials.mjs`. |

## 3. How to reproduce

```
pnpm install --frozen-lockfile
pnpm -r build                 # once; the script rebuilds apps/web and apps/public-site itself
pnpm test:e2e:flows           # = node scripts/e2e-flows.mjs
```

- The script rebuilds `apps/api`, `apps/web` and `apps/public-site` first. Add `--no-build` to skip this.
- `apps/web` is built with a synthetic `VITE_CENTER_SYSTEM_URL_TEMPLATE` (host `center-system.example.invalid`), so the clinician link-out renders.
- It starts the database, the API and the public site. It stops all of them at the end.
- It deletes old screenshots and writes new ones. It writes `results.json`.
- Exit code 0 means no failed step. A product gap does not fail the run.
- `node scripts/e2e-flows.mjs --serve` only starts the stack, for manual checks.
- Selectors use roles, labels and text. They do not use colours or class names, so a new visual theme does not break them.

Each step also checks:
- no console errors, no page errors, no failed network requests, no unexpected HTTP status 400 or higher;
- no national-ID-like number, phone number or e-mail address in the main content.

Expected errors are declared per step (for example the 404 for another center's record).

## 4. Sanity results

| Command | Result |
|---|---|
| `pnpm arch` | OK, no dependency violations (105 modules, 181 dependencies) |
| `pnpm -r --if-present typecheck` | OK |
| `pnpm -r --if-present lint` | OK |
| `pnpm --filter @ari/api-client gen:check` | OK |
| `pnpm -r --if-present test` | **478 passed, 0 failed** |
| - packages/api-client | 5 passed (1 file) |
| - packages/design-system | 120 passed (3 files) |
| - packages/domain | 36 passed (2 files) |
| - packages/i18n | 5 passed (1 file) |
| - packages/synthetic-data | 9 passed (1 file) |
| - db (RLS, privacy, migrations; real roles) | 135 passed (10 files) |
| - apps/api (integration, authz matrix, IDOR) | 54 passed (9 files) |
| - apps/web (unit and component) | 64 passed (17 files) |
| - apps/public-site | 50 passed (5 files) |
| `pnpm --filter @ari/web test:e2e` (Playwright on the mock API) | **33 passed, 0 failed** |
| `pnpm test:e2e:full` (real API + simulated Render DB) | **24 passed, 0 failed** |
| `pnpm test:e2e:flows` (this report) | **39 passed, 0 gaps, 0 failed** |

## 5. Issues found in the first run, and their fixes

| # | Issue (first run) | Fix | Check |
|---|---|---|---|
| 1 | **Gap:** no UI for center coordination, MTA/DTA and delivery. "Mark coordination done" sent no `centerId` and failed. The clinician could not open `/requests`. | New screen `/requests/:id/coordination` (coordinator and clinician). The coordinator links samples per item, starts coordination, answers per center (with `centerId`), records the MTA/DTA (type, reference, status, month signed) and moves to delivery. The clinician opens requests that involve the own center (row-level security), sees the own linked samples, accepts or declines, and marks delivery. The coordinator cannot mark delivery. New API `GET /requests/{id}/resolved-samples` and `GET /requests/{id}/agreements`; migration `0011` (agreement status and month; delivery needs a signed agreement; clinician reads own links only). | Flow f, steps 24 to 28 ([34](screenshots/34-f-delivery-coordination-link-samples-he.png) to [45](screenshots/45-f-delivery-mobile-tracker-closed-he.png)) |
| 2 | The link-out to the center system was text only. | Configurable link: build-time template `VITE_CENTER_SYSTEM_URL_TEMPLATE` (`https` only, `{sampleCode}`, `{centerCode}`), new tab, `rel=noopener noreferrer`. Safe default: no template gives a labelled reference with the code to look up. | Step 30 ([47](screenshots/47-g-clinician-sample-detail-he.png)) |
| 3 | Another center's record showed "Something went wrong". | The record page shows "Not available" (title and heading) for 404 and 403. | Step 31 ([48](screenshots/48-g-clinician-other-center-hidden-he.png)) |
| 4 | Import said "ethics reference missing" for a reference that was present. Root cause: a present but **unregistered** reference used the same rule code as an empty one. | New rule `ETHICS_UNKNOWN` ("ethics reference not registered for this center"). A registered active reference gives no warning. Domain unit test added. | Step 33: the row with a registered reference is accepted, only the unregistered one warns ([52](screenshots/52-h-ingest-import-dry-run-report-he.png)) |
| 5 | The cart showed the raw token `10_plus`. | Band wording: "10 or more" / "10 או יותר" (`lt10` stays "Too few to show"). | Step 14 ([18](screenshots/18-c-request-cart-he.png)) |
| 6 | The request has one extra item (seed data). | Not a bug. No change. | |

## 6. Results per step

Screenshot names: `NN-<flow>-<step>-<locale>.png`. "[api]" marks a step that also calls the API directly (here only the negative admin check in flow i).

| # | Flow | Step | Result | Detail | Screenshots |
|---|---|---|---|---|---|
| 1 | setup | build apps/api, apps/web and apps/public-site | Pass | apps/api, apps/web and apps/public-site rebuilt |  |
| 2 | setup | start Render-like DB, predeploy with synthetic seed, API (production build), public site | Pass | readyz ok, version flows-local-sha, migration 0011; seed: {"job":"predeploy","step":"seed","msg":"ok"} |  |
| 3 | a-signin | researcher_il signs in with password + TOTP (he), lands on role home | Pass |  | [01](screenshots/01-a-signin-login-he.png) [02](screenshots/02-a-signin-mfa-he.png) [03](screenshots/03-a-signin-home-he.png) |
| 4 | a-signin | researcher_il signs out (he) | Pass |  | [04](screenshots/04-a-signin-signed-out-he.png) |
| 5 | a-signin | researcher_il (second user) signs in and out in English | Pass |  | [05](screenshots/05-a-signin-login-en.png) [06](screenshots/06-a-signin-mfa-en.png) [07](screenshots/07-a-signin-home-en.png) |
| 6 | a-signin | mobile 390x844: sign-in and MFA screens (he) | Pass |  | [08](screenshots/08-a-signin-mobile-login-he.png) [09](screenshots/09-a-signin-mobile-mfa-he.png) [10](screenshots/10-a-signin-mobile-home-he.png) |
| 7 | b-search | researcher_il signs in again and opens Search from the navigation | Pass |  | [11](screenshots/11-b-search-start-he.png) |
| 8 | b-search | plan: pick a diagnosis, sample type and age band that exist in the synthetic seed | Pass | diagnosis mb_shh + FFPE = 26; adding age band 0_lt1 is suppressed |  |
| 9 | b-search | filter diagnosis + sample type FFPE: count tile shows a number | Pass | tile 26 | [12](screenshots/12-b-search-filtered-count-he.png) |
| 10 | b-search | add an age band: tile shows "Too few to show", no number, add-to-cart disabled | Pass |  | [13](screenshots/13-b-search-suppressed-too-few-he.png) |
| 11 | b-search | clear the age band again, add the search to the request cart | Pass |  | [14](screenshots/14-b-search-added-to-cart-he.png) |
| 12 | b-search | English: same search shows the count and the suppressed tile | Pass |  | [15](screenshots/15-b-search-filtered-count-en.png) [16](screenshots/16-b-search-suppressed-too-few-en.png) |
| 13 | b-search | mobile 390x844: search with filters (he) | Pass |  | [17](screenshots/17-b-search-mobile-filtered-count-he.png) |
| 14 | c-request | open the cart and start a request | Pass | req_01M7D879AP0C6B1STWTMQ2AK4J | [18](screenshots/18-c-request-cart-he.png) |
| 15 | c-request | identifier guard: an ID-number-like string is refused and nothing is sent | Pass | שדה אחד דורש תשומת לב שאלת המחקר | [19](screenshots/19-c-request-identifier-refused-he.png) |
| 16 | c-request | fill research question, IRB/Helsinki reference (bad format refused, then valid), planned use, funding | Pass |  | [20](screenshots/20-c-request-ethics-ref-format-he.png) [21](screenshots/21-c-request-review-he.png) |
| 17 | c-request | submit; confirmation; the tracker shows 8 steps | Pass | status precheck, current step "3 בדיקה מקדימה השלב הנוכחי רכז/ת בודק/ת שהבקשה שלמה." | [22](screenshots/22-c-request-sent-he.png) [23](screenshots/23-c-request-tracker-submitted-he.png) |
| 18 | d-precheck | national_coordinator signs in; home shows the pre-check queue | Pass |  | [24](screenshots/24-d-precheck-home-he.png) |
| 19 | d-precheck | open the request from the requests list and the pre-check page | Pass |  | [25](screenshots/25-d-precheck-request-detail-he.png) |
| 20 | d-precheck | tick the checklist, choose "Send to the committee", save | Pass |  | [26](screenshots/26-d-precheck-precheck-form-he.png) [27](screenshots/27-d-precheck-forwarded-he.png) |
| 21 | e-committee | committee member A (he) opens the queue and votes approve | Pass | tally "0 מתוך 2 אישורים נדרשים (3 חברים) דחייה: 0. נמנעים: 0." -> "1 מתוך 2 אישורים נדרשים (3 חברים) דחייה: 0. נמנעים: 0." | [28](screenshots/28-e-committee-vote1-before-he.png) [29](screenshots/29-e-committee-vote1-after-he.png) |
| 22 | e-committee | committee member B (en) votes approve; quorum reached; records approval | Pass | 2 of 2 approvals needed (3 members) Reject: 0. Abstain: 0. | [30](screenshots/30-e-committee-vote2-before-en.png) [31](screenshots/31-e-committee-vote2-after-en.png) [32](screenshots/32-e-committee-queue-after-en.png) |
| 23 | e-committee | researcher tracker shows "Approved", committee step done | Pass |  | [33](screenshots/33-e-committee-tracker-approved-he.png) |
| 24 | f-delivery | coordinator opens center coordination from the approved request and links samples of one center | Pass | 2 samples of מרכז סינתטי א linked | [34](screenshots/34-f-delivery-coordination-link-samples-he.png) [35](screenshots/35-f-delivery-coordination-started-he.png) [36](screenshots/36-f-delivery-tracker-coordination-he.png) |
| 25 | f-delivery | clinician opens the request from the list, sees own linked samples, accepts for the center | Pass |  | [37](screenshots/37-f-delivery-clinician-accept-he.png) [38](screenshots/38-f-delivery-tracker-agreements-he.png) |
| 26 | f-delivery | coordinator records the MTA (status, reference, signed month) and moves to delivery | Pass |  | [39](screenshots/39-f-delivery-agreement-form-he.png) [40](screenshots/40-f-delivery-coordination-delivery-he.png) [41](screenshots/41-f-delivery-tracker-delivery-he.png) |
| 27 | f-delivery | clinician marks delivered; request closes as delivered; researcher tracker shows "Closed – delivered" | Pass | 8 steps; last step "סגורה הושלם הבקשה הושלמה."; closeReason delivered | [42](screenshots/42-f-delivery-clinician-delivered-he.png) [43](screenshots/43-f-delivery-tracker-closed-he.png) [44](screenshots/44-f-delivery-tracker-closed-en.png) |
| 28 | f-delivery | mobile 390x844: researcher tracker at "Closed" (he) | Pass |  | [45](screenshots/45-f-delivery-mobile-tracker-closed-he.png) |
| 29 | g-clinician | clinician lands on samples: own center only, coded records | Pass | 10 rows, all "מרכז סינתטי א" | [46](screenshots/46-g-clinician-samples-own-center-he.png) |
| 30 | g-clinician | clinician opens a record: coded id, month-only date, no identity, pointer to the center system | Pass | link-out: https://center-system.example.invalid/lookup?code=<coded id>&center=synth_a | [47](screenshots/47-g-clinician-sample-detail-he.png) |
| 31 | g-clinician | another center's record is not visible to the clinician (404) | Pass | לא זמין / חזרה | [48](screenshots/48-g-clinician-other-center-hidden-he.png) |
| 32 | h-ingest | coordinator adds one coded record through the form | Pass | smp_01M7D894F873B606YN3B9AQ8FY | [49](screenshots/49-h-ingest-sample-entry-he.png) [50](screenshots/50-h-ingest-sample-created-he.png) |
| 33 | h-ingest | CSV import dry-run: good and bad rows, rejection report | Pass | total 5, accepted 1, warnings 1, rejected 3 (dry run, not committed) | [51](screenshots/51-h-ingest-import-upload-he.png) [52](screenshots/52-h-ingest-import-dry-run-report-he.png) |
| 34 | i-admin | system_admin signs in; home says the role sees no sample data | Pass |  | [53](screenshots/53-i-admin-home-he.png) |
| 35 | i-admin | audit log lists the events of this flow; chain verification says intact | Pass | 50 rows read; flow actions seen: request.deliver, request.state_changed, request.vote | [54](screenshots/54-i-admin-audit-verified-he.png) |
| 36 | i-admin | admin cannot open sample data (UI 403 page, and API 403) *(uses [api])* | Pass |  | [55](screenshots/55-i-admin-samples-forbidden-he.png) |
| 37 | j-public | public site home (he) | Pass |  | [56](screenshots/56-j-public-home-he.png) |
| 38 | j-public | public site home (en) | Pass |  | [57](screenshots/57-j-public-home-en.png) |
| 39 | j-public | public site home (he, mobile) | Pass |  | [58](screenshots/58-j-public-mobile-home-he.png) |

## 7. Key screenshots

### a. Sign in (password, then TOTP)
![Login](screenshots/01-a-signin-login-he.png)
![MFA](screenshots/02-a-signin-mfa-he.png)
![Researcher home](screenshots/03-a-signin-home-he.png)

### b. Search with a count, and a suppressed "Too few to show" tile
![Count](screenshots/12-b-search-filtered-count-he.png)
![Too few to show](screenshots/13-b-search-suppressed-too-few-he.png)
![Too few to show, English](screenshots/16-b-search-suppressed-too-few-en.png)
![Mobile search](screenshots/17-b-search-mobile-filtered-count-he.png)

### c. Request form: identifier guard, ethics reference format, tracker
![Identifier refused](screenshots/19-c-request-identifier-refused-he.png)
![Ethics reference format](screenshots/20-c-request-ethics-ref-format-he.png)
![Tracker after submit](screenshots/23-c-request-tracker-submitted-he.png)

### d. Pre-check
![Pre-check form](screenshots/26-d-precheck-precheck-form-he.png)

### e. Committee votes (2 of 3)
![Vote 1](screenshots/29-e-committee-vote1-after-he.png)
![Vote 2](screenshots/31-e-committee-vote2-after-en.png)

### f. Coordination, MTA/DTA and delivery in the UI, then the closed tracker
![Link samples](screenshots/34-f-delivery-coordination-link-samples-he.png)
![Clinician accepts](screenshots/37-f-delivery-clinician-accept-he.png)
![MTA form](screenshots/39-f-delivery-agreement-form-he.png)
![Clinician marks delivered](screenshots/42-f-delivery-clinician-delivered-he.png)
![Closed, delivered](screenshots/43-f-delivery-tracker-closed-he.png)
![Closed, English](screenshots/44-f-delivery-tracker-closed-en.png)
![Closed, mobile](screenshots/45-f-delivery-mobile-tracker-closed-he.png)

### g. Clinician: own center only
![Own center](screenshots/46-g-clinician-samples-own-center-he.png)
![Coded record](screenshots/47-g-clinician-sample-detail-he.png)
![Other center hidden](screenshots/48-g-clinician-other-center-hidden-he.png)

### h. Import dry run with rejection report
![Dry run report](screenshots/52-h-ingest-import-dry-run-report-he.png)

### i. Admin: audit log verified, no sample data
![Audit verified](screenshots/54-i-admin-audit-verified-he.png)
![Samples forbidden](screenshots/55-i-admin-samples-forbidden-he.png)

### j. Public site
![Public he](screenshots/56-j-public-home-he.png)
![Public en](screenshots/57-j-public-home-en.png)
