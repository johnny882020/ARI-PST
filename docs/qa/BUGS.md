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
