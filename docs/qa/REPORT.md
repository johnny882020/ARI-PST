# QA report

## Current status

| Area | Status | Evidence |
|---|---|---|
| Design-system gallery | All checks pass, including 44px targets and no sideways scroll on mobile | [`BUGS.md`](BUGS.md#fix-evidence-ui-bugs-2026-11-13) |
| Public site (43 pages, he and en) | All checks pass: axe, contrast, 24px targets, consent, forms | [`BUGS.md`](BUGS.md#fix-evidence-ui-bugs-2026-11-13) |
| Protected app on the mock API | All checks pass: axe 108/108, targets, role guards 66/66, flows 25/25 | [`BUGS.md`](BUGS.md#fix-evidence-ui-bugs-2026-11-13) |
| Full stack (real API and PostgreSQL) | Every role signs in; one request goes from cart to `closed` | `pnpm test:e2e:full` (CI job `canary-smoke`) |
| End-to-end flows per role, with screenshots | See the flow report | [`flows/REPORT.md`](flows/REPORT.md) |
| Open QA items | QA-013 (API contract decision), QA-014 (product decision) | [`BUGS.md`](BUGS.md#status) |

Re-run the QA scripts: `node docs/qa/scripts/run-all.mjs` ([`scripts/README.md`](scripts/README.md)).

## First run (2026-11-13)

The rest of this file records the first QA run. Real Chromium through Playwright, deviceScaleFactor 2. Raw data: `docs/qa/results/*.json`. About 260 screenshots in `docs/qa/screenshots/`. The counts below are from before the fixes.

### Summary

| Area | Result |
|---|---|
| Design-system gallery | Strong. Zero axe and zero contrast failures in 8 runs; 30 of 30 keyboard and overlay checks pass. Fails: mobile header collision and sideways overflow, 44px targets on mobile |
| Public site (43 pages, he and en) | Strong. Zero axe, contrast, console, network and third-party failures in 86 runs; consent is correct. Fails: link targets under 24px, `/app/` link, one raw field name |
| Protected app on the mock API (6 roles, 23 routes) | Role guards, redirects, suppression and most flows pass. Fails: heading order, small targets, mobile overflow on `/search` for two roles, wizard accepts identifier text |
| Full stack (real API and PostgreSQL) | Partial. Sign-in with password and TOTP, role landing and search work. Add to cart fails (QA-001) and counts need a manual snapshot refresh (QA-002), so the request, vote and close flow was not completed |

### Counts

| Check | Pass | Fail |
|---|---|---|
| Gallery: axe (he/en x light/dark x desktop/mobile) | 8 | 0 |
| Gallery: text contrast against WCAG AA | 8 | 0 |
| Gallery: targets at least 24px | 8 | 0 |
| Gallery: targets at least 44px (mobile runs) | 0 | 4 |
| Gallery: no horizontal scroll | 4 | 4 (all mobile) |
| Gallery: keyboard, focus trap, Esc, focus restore, Space, arrows, tooltip, sort | 30 | 0 |
| Public site: axe | 86 | 0 |
| Public site: contrast | 86 | 0 |
| Public site: no horizontal scroll at 390px | 86 | 0 |
| Public site: no console error, failed request or third-party request | 86 | 0 |
| Public site: one h1 and no heading jump (42 pages) | 42 | 0 |
| Public site: targets at least 24px | 2 | 84 |
| Public site: consent (no request before consent, decline, accept, DNT, equal buttons) | 5 | 0 |
| Public site: forms (4 forms: validation, identifier block, success, 500, 429, values kept) | all | 0 |
| Public site: internal links (41 targets) | 40 | 0 broken; `/app/` (44 links) is outside the static server |
| Web: axe on route audits | 72 | 36 |
| Web: contrast | 108 | 0 |
| Web: no horizontal scroll | 106 | 2 |
| Web: targets at least 24px | 43 | 65 |
| Web: role guards (forbidden page shown, no data) | 66 | 0 |
| Web: anonymous redirect to `/login?next=` | 21 | 0 |
| Web: functional flows | 24 | 1 (QA-009) |

### What was tested

#### 1. Design-system gallery
Every component in `packages/design-system/gallery`: buttons (all variants, loading, disabled), icon button, chip, badge, toast, tooltip, inputs with help and error, textarea with counter, select, checkbox (indeterminate), switch, radio group, search box, facet filter, aggregate count tiles (value, suppressed, merged, loading, error, coordinator view), status pills, alerts, card, empty and error states, skeleton, tabs, sortable table, pagination, stepper, dialog, session-timeout dialog, consent banner, language and theme switches.
- Keyboard: Tab order is logical (45 stops, skip link first in Hebrew). Dialog opens on Enter, focus moves inside, Tab and Shift+Tab stay inside, Esc closes, focus returns to the opener. The session dialog is an `alertdialog` and Esc does not close it (correct). Space toggles checkbox and switch; arrows move tabs and radios; tooltip opens on focus and closes on Esc; table sort sets `aria-sort`.
- Focus ring: 2px offset plus 2px teal ring on focused controls.
- RTL: `dir=rtl`, `lang=he` set by the provider; pagination chevrons mirror in Hebrew and not in English.
- Suppressed tile shows "Too few to show" and an em dash; no number, no threshold.
- Reduced motion: no infinite animation remains.
- Long Hebrew strings (127 characters, no spaces) injected into buttons, chips, badges, cards, table cells and labels: nothing clipped inside its box; desktop does not scroll sideways. Mobile gallery overflows, see QA-004.
- Screenshots: `docs/qa/screenshots/gallery/` (the 8-run matrix, `dialog-open-*`, `session-timeout-*`, `consent-*`, `long-hebrew-*`, `he-mobile-top.png`).

#### 2. Public site
All 43 built pages (he and en) in light desktop and dark 390px: heading order, one h1, `lang`/`dir`, single `main`, skip link first, alt text, title: pass.
- Consent (on `dist-analytics`, which has an analytics origin): banner on first visit; zero requests to the analytics host before consent; decline stores `ari_consent=v1:denied` and keeps it off after reload; accept loads the script once; cookie Lax, 180 days; DNT hides the banner and loads nothing; Accept and Decline have identical size and colour. The mobile banner takes 38% of the screen height. The default build has no visible banner and no third-party request.
- Forms: empty submit shows a summary that takes focus and marks 5 fields invalid; bad e-mail message; ID-like text is refused; success on 202; 500 and 429 show messages and keep typed values; honeypot present. Hebrew and English pass.
- Language switch goes to the same page in the other language and flips `dir`. Mobile menu opens and closes with Esc.
- Screenshots: `docs/qa/screenshots/public-site/`.

#### 3. Protected app (mock API at :3010)
- 6 roles x every route the role may open, in two variants (Hebrew light desktop, English dark mobile): 108 audits. Plus 66 routes a role must not open: all show the "no permission" page with no data. Anonymous users go to `/login?next=...` on all 21 URLs, including an unknown one.
- Cookies: `__Host-sid` HttpOnly, Secure, Strict; `__Host-csrf` Secure, Strict. Sign-out returns to `/login`.
- Search suppression: ticking each of the 5 sample-type facets showed suppressed tiles 39 times and never a number under 5, "<5" or a threshold. The "Why are some numbers hidden?" text names no number.
- Flows passing: search with facets and empty result, keyboard-only add to cart, remove and re-add, wizard validation, complete 5-step wizard and submit, 8-step tracker, coordinator registrations and request list, CSV import dry run (a file with a name column and a full date is flagged), committee queue and decision page for two members, admin users, privacy settings and audit log (no e-mail addresses), session-timeout dialog (appears before expiry, Esc does not dismiss, "Stay signed in" works), wrong password (generic message with trace id), empty login, wrong MFA code with recovery path, registration validation and success.
- Screenshots: `docs/qa/screenshots/web/` (`<role>__<route>__<locale>-<theme>-<viewport>.png` and `flow-*`).

#### 4. Full stack
Local PostgreSQL 16 on port 55434 (`/tmp/qa-pg`), migrations through the API test script, 2 centers, 9 users with TOTP and 60 synthetic samples (seeded with the API test harness), API (`tsx src/server.ts`) serving `apps/web/dist` on :8080. `pnpm --filter @ari/api build` succeeds. Findings: sign-in with real password and TOTP lands on `/home`; `/search` shows suppressed tiles until a snapshot refresh (QA-002), then 60 / 20 / 20 / 20 with empty types suppressed; add to cart returns 404 (QA-001); no screen for e-mail verification (QA-003). Not run end to end in this first run: register, coordinator approval, MFA enrolment, request submission, committee vote, close.

### Limits of the first run
- The full-stack request, vote and close flow (blocked by QA-001 and QA-003; now covered by `pnpm test:e2e:full`).
- The contrast audit reads text nodes on solid or semi-transparent backgrounds. It does not check text over images or gradients, placeholders, icons, focus-ring colour or borders. Zero failures means none found, not proof.
- axe-core runs automated rules only. No screen reader, no 400% zoom, no high-contrast mode, no real phone, only Chromium.
- Public-site forms ran against a mocked endpoint; no ALTCHA, no real mail.
- Decap CMS (`/admin`) and WebAuthn were not exercised.
- Web results are against the mock server, which can differ from the API (QA-001 is one such difference).
- `apps/public-site/dist-analytics` was a pre-built output and was not rebuilt.
- Hebrew copy was checked for layout and mirroring, not language quality.
