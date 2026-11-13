# 06 — Key screens: wireframe descriptions
Mockups (self-contained HTML, he RTL + en LTR, light + dark; toggle buttons in the header, or `?lang=en&theme=dark`) are in `mockups/`. All data is synthetic. Layout below is logical (inline-start = right in Hebrew).

| # | Screen | Role | Mockup | REQ |
|---|---|---|---|---|
| 1 | Home (public) | anonymous | `mockups/index-home.html` | 004, 019 |
| 2 | Researcher dashboard | researcher_il | `mockups/researcher-dashboard.html` | 013 |
| 3 | Search results with aggregate counts | researcher_il / intl | `mockups/search-results.html` | 030–033 |
| 4 | Request cart + form | researcher_il | `mockups/request-cart.html` | 034, 035 |
| 5 | Request tracker | researcher_il | `mockups/request-tracker.html` | 036 |
| 6 | Coordinator entry | national_coordinator, center_clinician | `mockups/coordinator-entry.html` | 007, 016, 068 |
| 7 | Committee / admin dashboard | committee_member, system_admin | `mockups/committee-dashboard.html` | 017, 018, 066 |

## 1. Home
Blocks, top to bottom: sticky header (brand lock-up, nav, language, theme) · hero (gradient of teal-subtle and clay-subtle; headline; lead; primary "Search the index"; secondary "For families") · three quiet stat tiles · "How it works" in three cards · families card with the "no medical record" sentence · partners row.
Behavior: no carousel. No auto-play. Search button goes to login if anonymous. Mobile: single column; nav collapses to a menu button (sheet).
Empty/error: none (static content).

## 2. Researcher dashboard
Greeting · large search field · "My requests" tiles (waiting, need info, delivered) · action banner if info is needed · cart summary · note "aggregate counts only".
Order is by urgency: action needed first.

## 3. Search results
Large search · privacy note · inline-start filter panel (sample type, age band, center, more) · applied-filter chips · results table: diagnosis, sample type, count, add-to-cart · "Why are some numbers hidden?" disclosure.
Rows can show: normal count; "Too few to show" (muted, disabled add); count with "Includes related categories" chip.
Phone: filters in a sheet; table becomes cards.
Role variants: `researcher_intl` same view, no cart. `national_coordinator` sees exact counts + badge.

## 4. Request cart
Table of groups with Remove · "What happens after you send" 3-step note · form: research question, ethics/Helsinki reference, planned use, funding (more fields in A4's spec) · free-text warning · Send request (primary) and Save draft.
Wizard variant for the full form: 4 sections with progress "Step n of 4".

## 5. Request tracker
Header with request ID and title · status banner with one plain sentence · vertical timeline: sent, pre-check, committee, center coordination, MTA/DTA, delivery. Each step: status badge, sentence, ISO date. Messages from coordinator appear under the current step.
States: needs info (action button), returned, rejected (reasons shown), delivered.

## 6. Coordinator entry
Banner "no identifying details" · single-column fixed form with coded fields (sample code auto, center, diagnosis, age band, sample type, availability, time point, collection month, ethics reference, attached data) · "Save and add another" primary · CSV import · side card with repeat value (entries this month, stale records).
Goal: under 4 minutes per record (REQ-068). Keyboard: Enter saves and focuses the first field of the next record.
Errors: inline per field; identifier detector warns on free text.

## 7. Committee / admin dashboard
Tiles (open requests, average days to delivery with suppressed state until enough data, centers feeding, stale records) · decision queue table with votes N/M · separation-of-duties note · recent audit activity.
Committee view: queue + decision form (approve, reject, ask for info; reasons required). Admin view: users, roles, audit log, content; no sample data, no approve button.

## Shared
- Header: lock-up at inline-start; nav; language switch; theme switch.
- Footer: Privacy, Terms, Accessibility statement, "no patient identity" line.
- Every screen: skip link, one h1, landmarks, 44 px targets, light + dark + forced-colors tested.
