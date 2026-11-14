# QA-1 bug list

Severity: **High** blocks a user flow or breaks a stated requirement; **Medium** accessibility or layout defect on a supported viewport; **Low** polish or needs-decision.
Screenshot paths are relative to the repo root. Owner is the folder that should fix it. All numbers come from `docs/qa/results/*.json`.

| ID | Sev | Owner | Title |
|---|---|---|---|
| QA-001 | High | apps/api (B2), maybe db (B1) | Add to cart returns 404 on the live API |
| QA-002 | High | apps/api (B2) / infra | Nothing calls `agg.refresh_snapshot()`, so search shows no counts |
| QA-003 | High | apps/web (B6) | No screen to verify e-mail and set the first password |
| QA-004 | Medium | packages/design-system | AppShell header collides at 390px and the page overflows sideways |
| QA-005 | Medium | apps/web (B6) | `/search` records table scrolls the whole page at 390px (clinician, coordinator) |
| QA-006 | Medium | apps/public-site (B4) | Nav and footer links are 17px tall (below the 24px target minimum) |
| QA-007 | Medium | apps/web (B6), design-system | Small targets in the protected app (ID links 17px, brand 23px, segment buttons 36px) |
| QA-008 | Medium | apps/web (B6) | Heading order skips a level on search, account, help, sample entry |
| QA-009 | Medium | apps/web (B6) | Request wizard step 1 accepts identifier-like text with no error or warning |
| QA-010 | Medium | apps/public-site (B4), infra | Portal link points to `/app/`, but the SPA is meant to live at `/` |
| QA-011 | Low | apps/web (B6) | Two `nav` landmarks share the label "Language" / "שפה" on `/account` |
| QA-012 | Low | apps/public-site (B4) | Form error summary prints the raw field name `consent_contact` |
| QA-013 | Low | apps/api / apps/web | Every first load logs a red 401 for `GET /auth/session` |
| QA-014 | Low | apps/public-site (B4) | No theme switch on the public site (follows the OS only) |
| QA-015 | Low | docs / db | `db/README.md` and `docs/KNOWN-ISSUES.md` are referenced but missing |
| QA-016 | Low | packages/design-system | Session timeout dialog text reads the countdown twice |

## QA-001 High. Add to cart returns 404 on the live API
- Repro: seeded stack (`docs/qa/scripts/README.md`, "Full stack"), sign in as `researcher_il`, open `/search`, tick "FFPE", press "Add to request cart".
- Actual: `POST /api/v1/request-cart/items` with `{"criteria":{"sampleType":["ffpe"]}}` answers 404 `NOT_FOUND`. `{"criteria":{"diagnosis":["mb_shh"]}}` also 404. No row appears in `portal.requests`. `GET /request-cart` and `GET /requests` answer 200. The same call returns 201 in `apps/api/test/idor-contract.test.ts`, so the difference is the live process (NODE_ENV=development, `tsx src/server.ts`) or the seed.
- Impact: a researcher cannot start a request on the real stack, so the request, committee and close steps could not be driven.
- Suggested fix: reproduce with API logging at debug; check that the draft insert in `tx.requests.create` is not failing RLS and being mapped to NOT_FOUND. Add a smoke test that runs the cart flow against `tsx src/server.ts`, not only the in-process harness.
- Screenshot: none (network only). Log: `docs/qa/results/` has no log; call shown above.

## QA-002 High. Nothing calls `agg.refresh_snapshot()`
- Repro: seed 60 samples (script), sign in as `researcher_il`, open `/search`.
- Actual: every tile shows "Too few to show". After running `SELECT agg.refresh_snapshot()` as `app_readonly_bg` the tiles show 60 / 20 / 20 / 20. `grep -rn refresh_snapshot apps/api/src` finds nothing, and `render.yaml` has no job for it. The function is allowed only for `app_readonly_bg`, `app_migrator` and a coordinator session.
- Impact: in production, search never shows counts until someone runs the SQL by hand.
- Suggested fix: add a scheduled job (render cron or the existing `apps/api/src/jobs`) running as `app_readonly_bg`, and refresh after coordinator imports. Document the interval.

## QA-003 High. No screen to verify e-mail and set the first password
- Repro: `grep -rn "verify-email\|verifyEmail" apps/web/src` finds nothing. The API says registration needs e-mail verification and "also sets the first password for invited users" (`POST /auth/verify-email`). Registration form has no password field.
- Impact: a self-registered researcher, once approved, has no way to activate the account in the UI. Invited users have the same gap.
- Suggested fix: add `/verify-email?token=` (set password, then TOTP enrolment) to the route table and the mock server.

## QA-004 Medium. AppShell header collides at 390px
- Repro: open the gallery or any protected page at 390x844, Hebrew or English.
- Actual: brand text wraps over the language and theme switches, the user name overlaps the sign-out button. Gallery page width is 443px (Hebrew) or 457px (English) against a 390px viewport. Screenshots: `docs/qa/screenshots/gallery/he-mobile-top.png`, `docs/qa/screenshots/web/national_coordinator__search__en-dark-mobile.png`.
- Suggested fix: collapse the header on small screens (menu button already exists) and move language, theme and sign-out into it. Find the element with `min-inline-size` larger than the 20rem wrapper in the gallery Forms section (fields are 427px wide inside a 320px wrapper).

## QA-005 Medium. `/search` scrolls sideways at 390px for clinician and coordinator
- Page width 734px against 390px. The "Records (de-identified)" table is not in a scroll container. Screenshot: `docs/qa/screenshots/web/national_coordinator__search__en-dark-mobile.png`.
- Fix: wrap the table in an `overflow-inline: auto` region with a focusable label, or turn rows into cards below 600px.

## QA-006 Medium. Public site nav and footer links are 17px tall
- 84 of 86 page runs have links under 24px (WCAG 2.2 SC 2.5.8). Header and footer links measure 92x17, 87x17, 153x17, 145x17, 39x17. On mobile the stack is under 44px too. Example: `docs/qa/screenshots/public-site/en_join-mobile-dark.png` (footer links).
- Fix: `min-block-size: 24px` (44px on mobile) with padding on `.nav a` and footer links.

## QA-007 Medium. Small targets in the protected app
- 65 of 108 route audits have a target under 24px: ID links in tables (`smp_...`, `req_...`, 17px), brand link 23px. In the design system the language, theme and Dark/Light segment buttons are 36px high, and link-buttons ("Try again", "Copy") are 24 to 26px. At 390px none reach 44px.
- Fix: raise `.ds-segment` and `.ds-link-button` to a 44px hit area on coarse pointers; pad table links.

## QA-008 Medium. Heading order
- axe `heading-order` on `/search`, `/account`, `/help` for all roles and `/samples/new` for the coordinator: an `h3` follows the `h1` with no `h2`. Facet titles and card titles are `h3`.
- Fix: use `h2` for the first level of sections or set the facet heading level by prop.

## QA-009 Medium. Request wizard accepts identifier-like text
- Repro (mock): cart, Start request, type `Patient ID 123456789 phone 050-1234567` into "Research question", press Continue.
- Actual: moves to step 2, no error, no warning (`docs/qa/results/web-flows.json` key `idNotBlocked`, screenshot `docs/qa/screenshots/web/flow-researcher__request-identifier-text__en-light-desktop.png`). The public contact form does block this text. An `identifier-warning` chunk exists, so it may be meant as a soft warning that did not show.
- Fix: decide the rule (block or warn) and test it; the portal must not collect identifiers.

## QA-010 Medium. Portal link `/app/` versus SPA at `/`
- Every public page links "Sign in to the protected area" to `/app/` (`PORTAL_URL` default in `apps/public-site/src/lib/env.ts`). CLAUDE.md says the SPA is at `/`. On the QA static server `/app/` is 404 (44 links). Needs checking against `render.yaml` routing; set `PUBLIC_PORTAL_URL` explicitly in the Blueprint if the SPA stays at `/`.

## QA-011 Low. Duplicate `nav` label
- axe `landmark-unique` on `/account`: two `nav` elements labelled "Language". Give one a different label or merge.

## QA-012 Low. Raw field name in the error summary
- Public contact and join forms: summary line reads "consent_contact: Please confirm that we may contact you" in English and Hebrew. Use the checkbox label. Screenshot: `docs/qa/screenshots/public-site/form-contact-empty-errors-en.png`.

## QA-013 Low. Red 401 on every first load
- `GET /api/v1/auth/session` answers 401 before sign-in, so DevTools shows an error and tools that fail on console errors trip. Consider 200 with `{authenticated:false}` or accept it and filter in e2e.

## QA-014 Low. No theme switch on the public site
- Dark mode works through `prefers-color-scheme` (all 43 pages pass contrast in dark). There is no visible toggle, unlike the protected app. Confirm that this is intended.

## QA-015 Low. Missing docs
- CLAUDE.md names `docs/KNOWN-ISSUES.md` and a `db/README.md` (referenced from the old CLAUDE.md and the coordinator note). Neither exists at the time of the run.

## QA-016 Low. Countdown read twice
- Session timeout dialog text in Hebrew reads "הזמן שנותר: 1:35הזמן שנותר: 2:00": a visible countdown plus a live region with a different value. Keep one, or have the live region announce only at intervals.

## Fix verification (UI-FIX, 2026-11-13)

Re-run on commit 95183a4 (canonical request status: `closed` + `closeReason`, regenerated API client); all counts below are from that run.
Scope: bugs owned by apps/web (B6), apps/public-site (B4), packages/design-system. QA-001, QA-002, QA-010 and QA-015 belong to INT-1 and are not covered here.
How it was checked: the QA scripts were copied to a scratch folder and run from there, so `docs/qa/results` and `docs/qa/screenshots` still hold the first run. Web stages ran against the mock API on :3010. Nothing here was run against the real API and PostgreSQL.
One script change was needed: on a 390px screen the language and theme switches now sit behind the menu button, so `01-gallery.mjs` (`setup`) and `03-web-sweep.mjs` (`applyLT`) must click `.ds-shell-menu` first when it is visible. The copies in the scratch run had that one line added. The scripts in `docs/qa/scripts` are unchanged and need the same line, or the gallery stage stops on a hidden button.

| Check (QA script) | Before | After |
|---|---|---|
| Gallery: targets at least 44px (mobile) | 0/4 | 4/4 |
| Gallery: no horizontal scroll | 4/8 | 8/8 |
| Gallery: axe, contrast, 24px targets, keyboard | 8/8, 8/8, 8/8, 30/30 | same |
| Public site: targets at least 24px | 2/86 | 86/86 |
| Public site: axe, contrast, no scroll, clean console | 86/86 each | 86/86 each |
| Web: axe | 72/108 | 108/108 |
| Web: no horizontal scroll | 106/108 | 108/108 |
| Web: targets at least 24px | 43/108 | 108/108 |
| Web: targets at least 44px on the mobile runs (not in the first report) | 0/54 | 54/54 |
| Web: contrast, clean console, guards, anonymous redirects | 108/108, 108/108, 66/66, 21/21 | same |
| Web: functional flows | 24/25 | 25/25 |

Other runs: `@ari/design-system` 114 tests, `@ari/web` 48 unit tests and 30 Playwright tests (9 new in `apps/web/e2e/qa-fixes.spec.ts`), `@ari/i18n` key lint (587 keys, he and en equal) and tests, `@ari/public-site` 50 tests; typecheck and lint pass for these four packages; `pnpm arch` passes.

| ID | Status | What changed and how it was checked |
|---|---|---|
| QA-003 | Fixed (mock only) | New `/verify-email?token=` screen (the link the API mails; `/auth/verify-email` opens the same screen). It sets the first password, takes the token out of the address bar, and explains the next steps. The same endpoint and screen serve invited users. First sign-in of an account with no second factor now completes the challenge without a code and lands on a new `/setup-mfa` screen (authenticator app or passkey, recovery codes); every other route redirects there until a factor exists. Mock server gained `POST /auth/verify-email`, a not-yet-activated user and the enrolment-only session rule. Checked by e2e (verify, sign in, enrol, open `/search`) and 6 unit tests. Not run against the real API. |
| QA-003 gap | Not built | Password reset: `packages/contracts/openapi.yaml` has no forgot-password or reset operation (only `changePassword` for a signed-in user), so there is no screen. A change-password form for signed-in users is also not built. |
| QA-003 note | Partly open, other owner | Since 95183a4 the generated client has `/auth/verify-email` and `LoginResult.enrollmentRequired`, and the web app calls them directly. The OpenAPI `Session` schema still lacks `mfaEnrolled`, which the API sends (`SessionView`), so the app reads it with a cast in `needsMfaSetup` (`apps/web/src/app/session.tsx`). It should be added to the contract. |
| QA-004 | Fixed | AppShell at 48em and below: one bar with menu button, brand (ellipsis, no wrap) and an optional pinned slot (the cart link). Language, theme, user name and sign-out open with the menu. The gallery overflow came from `SearchBox`: the input's default width set the minimum width of the box. Checked: gallery no-scroll 8/8, e2e checks bar height, no overlap of header items, and no sideways scroll with the menu open and closed. |
| QA-005 | Fixed | `.search-layout` columns are `minmax(0, 1fr)`, so the records table scrolls inside its own labelled, focusable region. Web no-scroll 108/108; e2e for the coordinator at 390px. |
| QA-006 | Fixed | Footer links, breadcrumb links, back links and card title links are at least 24px, and 44px below 64em or on touch. Skip link and brand are 44px. 24px: 86/86. 44px on mobile: 39/43; the 4 left are the off-screen honeypot input on the contact and join forms, which nobody can reach. |
| QA-007 | Fixed | Table ID links, brand link, footer link, file input: 24px minimum. Segment buttons, link buttons, table links and stand-alone links: 44px at 48em and below or on a coarse pointer. Web 24px 108/108, 44px on mobile 54/54. |
| QA-008 | Fixed | Search has `h2` "Filters" and `h2` "Results" above the `h3` facet titles (`FacetFilter` has a `headingLevel` prop); account, help, cart and sample entry cards use `h2`. axe 108/108; e2e checks the heading sequence on the four pages. |
| QA-009 | Fixed (block) | The wizard refuses identifier-like text in research question, planned use and funding with the same five patterns as `packages/domain/src/identifier-guard.ts` (9-digit run, phone, e-mail, exact date, 7 or more digits; same digit normalisation). The step does not advance and a draft with such text is not sent, including autosave and "Save draft". Each pattern has its own he and en message. The same check blocks the reply, coordination note, pre-check note and committee comment. The mock API now answers 422 `IDENTIFIER_SUSPECTED` like the server. The patterns are a copy, because `apps/web` does not depend on `@ari/domain`; a change to the server list must be copied. QA flow 25/25; e2e for all five patterns in he and en, with a check that no PATCH is sent. |
| QA-011 | Fixed | `LanguageSwitch` with buttons is a labelled group, not a `nav` (it stays a `nav` when its options are links). axe `landmark-unique` gone. |
| QA-012 | Fixed | The summary line for the consent checkbox shows the error text only ("Please confirm that we may contact you"), in both languages. Seen in the QA form run. |
| QA-013 | Not fixed | The 401 on `GET /auth/session` before sign-in comes from the API contract. Returning 200 with an "anonymous" body is an API and contract decision. |
| QA-014 | Not fixed | Needs a product decision. The tokens already support `data-theme`, but a switch without a flash needs a script in `apps/public-site/public` and a check against the site's content security policy. |
| QA-016 | No change, by design | The visible countdown is `aria-hidden`; the second text is a visually hidden live region that speaks in steps of 30 or 10 seconds. A screen reader hears one of them. `innerText` shows both. |
| Web axe, 4 odd rules on `/search` (`document-title`, `html-has-lang`, `landmark-one-main`, `page-has-heading-one`) | Not reproduced | They did not come back in the re-run. The same four rules appeared once on three public pages during a re-run while another build was rewriting `dist` (the pages answered 404), and were gone on the next run. Most likely a page read during a rebuild. |

## Status of the INT-1 items (checked against the code on 2026-11-14)

| ID | Status | Evidence |
|---|---|---|
| QA-001 | Not reproduced | The cart step passes on the production-like stack in `scripts/e2e-fullstack.mjs`. Likely cause was QA's hand-made seed (`docs/KNOWN-ISSUES.md`, item 12). |
| QA-002 | Fixed | `apps/api/src/jobs/snapshot.ts` runs `agg.refresh_snapshot()`; cron `ari-cron-snapshot` in `render.yaml` (hourly, minute 5). The free demo has no crons: the snapshot is refreshed at every start (seed) and after a coordinator import. |
| QA-010 | Fixed in the Blueprint | `render.yaml` sets `PUBLIC_PORTAL_URL` for `ari-public` and redirects `/app/*`. The code default in `apps/public-site/src/lib/env.ts` is still `/app/`. |
| QA-013 | Not fixed | Unchanged. API and contract decision. |
| QA-015 | Fixed | `db/README.md` and `docs/KNOWN-ISSUES.md` exist. |
| QA-003 note | Still open | `Session` in `packages/contracts/openapi.yaml` still has no `mfaEnrolled`; `docs/REVIEW-2026-11.md` R-06. |
