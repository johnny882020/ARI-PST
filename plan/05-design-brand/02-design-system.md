# 02 — Design system
Covers REQ-071, REQ-020, REQ-021. Package: `packages/design-system` (tokens + components). Tokens: `tokens.css` (this folder, copy source).

## 1. Principles (Apple-style, our reading)
1. **Clarity.** One job per screen. Plain labels. Big enough type. Icons have text.
2. **Deference.** The UI steps back. Content (counts, filters, requests) leads. Few borders, few colors, no ornament.
3. **Depth.** Layers show hierarchy: page, card, sheet, modal. Use soft shadow and blur lightly. Never heavy.
4. **Generous space.** Use the 8-pt scale. Default to more space.
5. **Restrained color.** Neutrals first. One primary. Warm accent rare.
6. **Motion is short and physical.** 150–320 ms. Ease-out or small spring. Motion explains change. It never decorates.
7. **Reduced motion is complete.** Every animation has a non-moving equivalent (see §6).
8. **Calm by default.** No flashing. No auto-scroll. No surprise.

## 2. Typography
Goal: system-like feel, excellent Hebrew.
| Role | Font stack | Why |
|---|---|---|
| UI and body (he + en) | `system-ui, -apple-system, "Segoe UI"` then **Heebo** | Native feel on Apple/Windows. Heebo gives Hebrew glyphs matched to Latin. |
| Hebrew fallback | **Heebo**, then **Assistant**, then Arial | Both free, wide weights |
| Display (headings, public site) | **Rubik** (Latin + Hebrew) | Rounded corners = warm |
| Numbers, codes | `ui-monospace` | `sample_code`, IDs |

Fonts (check license on the source site before bundling; all believed SIL Open Font License 1.1; verify):
- Heebo — Google Fonts, OFL. Variable weight 100–900. Hebrew + Latin.
- Assistant — Google Fonts, OFL. Weights 200–800.
- Rubik — Google Fonts, OFL. Weights 300–900. Hebrew + Latin + Cyrillic.
- Noto Sans Hebrew — OFL. Extra fallback.
- UNVERIFIED: licenses were not re-checked online in this session. A6 or legal must confirm and store license files in the repo.

Rules:
- **Self-host** WOFF2 files. Do not call Google Fonts CDN at runtime (privacy, GDPR; REQ-049).
- `font-display: swap`. Preload the Hebrew subset of the body face.
- Subset: Hebrew + Latin + digits + punctuation. Budget: ≤ 120 KB total fonts on the public home page. UNVERIFIED target.
- Body 16 px minimum. Hebrew line-height 1.6. English 1.5 is fine; the token uses 1.6 for both.
- Do not use italics for Hebrew. Use weight or color for emphasis.
- Do not use letter-spacing on Hebrew.
- No ALL CAPS in Hebrew (no case). In English, use caps only for tiny labels.
- Scale: caption 13 · small 14 · body 16 · lead 19 · h4 20 · h3 24 · h2 32 · h1 44 · display 56 px (rem tokens).
- Line length: max 68ch.

## 3. Tokens summary
See `tokens.css`. Groups: color (light/dark), type, spacing (4/8/12/16/24/32/48/64/96), radius (4/8/12/16/24/pill), elevation (0–3), motion (duration + easing), focus ring, z-index, `--target-min: 44px`.
Naming: `--group-name`. Components use only semantic tokens, never raw palette tokens.
Dark theme: `prefers-color-scheme` plus `data-theme` override. A theme toggle stores the choice in `localStorage` (try/catch; works without it).

## 4. Layout
- Breakpoints (min-width): 0 (phone) · 40em · 48em · 64em · 80em.
- Container: max 72rem. Gutter 16 px phone, 24 px tablet and up.
- Grid: 4 cols phone, 8 tablet, 12 desktop. Use CSS grid and `gap`.
- App shell (protected area): top bar + inline-start nav (right side in Hebrew) + content. On phone the nav becomes a bottom sheet.
- Logical properties only: `margin-inline`, `padding-block`, `inset-inline-start`, `border-start-start-radius`, `text-align: start`. No `left`, `right`, `margin-left`, etc. A stylelint rule enforces this (A6/A7).

## 5. Component inventory
State legend: D default · H hover · F focus-visible · A active/pressed · X disabled · L loading · E error · S selected · R read-only · Em empty.
All components: keyboard operable, name/role/value exposed, 44 px target (except inline links), works in RTL, light, dark, forced-colors.

| Component | States | Notes |
|---|---|---|
| Button (primary, secondary, quiet, danger) | D H F A X L | One primary per view. Loading keeps width and shows spinner + text. |
| Icon button | D H F A X | Needs `aria-label`. Tooltip on hover and focus. |
| Link | D H F visited | Underline always in body text. |
| Text field | D H F E X R | Label above. Help text. Error text with icon. |
| Textarea | D H F E X | Counter has `aria-live="polite"` off by default. |
| Select / combobox | D H F E X open | ARIA 1.2 combobox. Type-ahead. Hebrew sort. |
| Checkbox, radio, switch | D H F S X E | Target includes label. |
| Segmented control | D H F S X | For he/en, list/grid. |
| Chip (filter, removable) | D H F S X | Remove button label: "Remove filter {name}". |
| Tag / badge (status) | D | Status = color + text + icon. |
| Card | D H F (if link) | No nested interactive cards. |
| Table | D sorted, selected, loading, empty, error | See §7.3. |
| Tabs | D H F S | Arrow keys. RTL reverses arrows. |
| Stepper | current, done, upcoming, error | See §7.5. |
| Dialog / sheet | open, closing | Focus trap. Esc closes. Returns focus. |
| Toast | info, success, error | `role="status"`. Not for errors that need action. |
| Banner (inline alert) | info, success, warning, error | `role="status"` or `alert` (errors that block). |
| Tooltip | D | Never the only source of information. |
| Disclosure / accordion | closed, open | Used for plain-language explanations. |
| Pagination (cursor) | D H F X | "Previous / Next". No page numbers (cursor API). |
| Breadcrumb | D | `aria-current="page"`. Separator mirrors. |
| Navigation (top, side, mobile sheet) | D H F current | Skip link first. |
| Search field | D F L results E | See §7.1. |
| Filter group | collapsed, expanded, applied | See §7.2. |
| Count tile (aggregate) | value, suppressed, loading, error | See §7.8. |
| Consent/privacy notice | D | See §7.7. |
| Empty state | D | Icon, one sentence, one action. |
| Skeleton | L | Static under reduced motion. |
| Avatar / role badge | D | Initials of synthetic users only in mockups. |
| Language switcher | D F S | Uses `lang` and `hreflang`. |
| Theme switcher | light, dark, system | Persists per viewer. |
| Timeline (request history) | step done, current, pending | Every step visible to applicant (REQ-036). |
| File drop (CSV import) | D drag F L E done | Keyboard-accessible button also. Synthetic data in staging. |
| Data viz (bar, line, stacked) | D H F | See §8. |

## 6. Motion
- Durations: instant 80 · fast 150 · base 220 · slow 320 ms.
- Easing: standard `cubic-bezier(.2,0,0,1)`; spring `cubic-bezier(.34,1.4,.64,1)` only for small elements (switch, chip).
- Use: fade + 8 px translate for entry. Sheet slides from the bottom on phone. Dialog scales 0.98 → 1.
- Direction in RTL: horizontal slides mirror. Use logical transform helpers (`--dir: 1 | -1`).
- No parallax. No looping animation. No auto-play. Nothing flashes more than 3 times per second (WCAG 2.3.1).
- **prefers-reduced-motion: reduce:** all durations go to ~0; no translate, no scale, no spring; fades become instant; skeleton shimmer stops; smooth scroll off; progress shows as text/static bar. Implemented in `tokens.css`. JS animations must read `matchMedia('(prefers-reduced-motion: reduce)')`.
- Users may also set an in-app "Reduce motion" switch. It sets `data-motion="reduce"`. UNVERIFIED need; low cost.

## 7. Patterns
### 7.1 Search
- One large field at the top. Placeholder shows an example, not instructions.
- Free-text plus "smart" suggestions (REQ-030): suggestions come from a controlled vocabulary of diagnosis terms in he and en.
- Submit on Enter. Results update without page jump. Announce "{n} results" via `aria-live="polite"`.
- Never show raw records to `researcher_il`, `researcher_intl` (REQ-032).
- Search history for the viewer is off by default. UNVERIFIED privacy decision (A2).

### 7.2 Filters
Required filters (REQ-031): diagnosis, sample type, age band, center, attached data, clinical time point.
- Desktop: panel at inline-start. Phone: "Filters" button opens a sheet with "Show {n} results".
- Applied filters show as removable chips above results. "Clear all" is a quiet button.
- Each change updates the URL (shareable). Counts update live.
- Filter option counts follow suppression rules (§7.8). An option with a suppressed count stays selectable but shows "—".

### 7.3 Data tables
- Real `<table>`. Header cells `scope="col"`. Caption names the table.
- Sort: button in header; `aria-sort`. Sticky header. Row height 48 px.
- Numbers align at the inline-end and use `dir="ltr"` isolate, tabular figures.
- Row select: checkbox column first. Bulk bar appears above table.
- Phone: table becomes a stacked list of cards. Keep column labels.
- States: loading (skeleton rows), empty, error, suppressed cells.
- No horizontal page scroll. Wide tables scroll inside a labeled region (`tabindex="0"`, `role="region"`, `aria-label`).

### 7.4 Forms
- One column. Label above field. Required marked with text "(required)" / "(חובה)", not only an asterisk.
- Validate on blur and on submit. Do not show errors while the user types the first time.
- On submit error: error summary at top (focus moves to it), each item links to its field.
- Group related fields with `fieldset` + `legend`.
- Autosave draft for the request form (server side, no free-text logs). UNVERIFIED with A4.
- Never ask for direct identifiers (REQ-042). Any free-text field carries the notice: "Do not enter names, ID numbers, or any detail that could identify a child."
- Input type for IDs and codes uses `dir="ltr"`, `inputmode` set, `autocomplete="off"`.

### 7.5 Stepper (request flow, REQ-034)
Steps: 1 Search · 2 Cart · 3 Form · 4 Pre-check · 5 Committee · 6 Center coordination · 7 MTA/DTA · 8 Delivery.
- Applicant stepper (steps 3–8) is a vertical timeline. Each step shows status, date (ISO date), and a plain sentence.
- Statuses: done, current, waiting-on-you, waiting-on-others, returned, rejected.
- `aria-current="step"`. Text states always present.
- Form wizard stepper (inside step 3): sections with progress "Step 2 of 4". Back is always possible. Data is kept.

### 7.6 Empty and error states
- Empty: icon (line, 48 px) + title + one sentence + one action. No blame, no jokes.
- No results: say what was searched, suggest removing a filter, show "Clear filters".
- Error: say what happened, what is saved, what to do. Include `traceId` as a small copyable code (RFC 9457 `traceId`). Never show stack traces or identifiers.
- Offline / 5xx: keep user input. Offer "Try again".
- 403: say the role cannot see this. Do not reveal that hidden data exists.

### 7.7 Consent and privacy notices
- Layered: one plain sentence + "Learn more" disclosure + link to full policy.
- Cookie/analytics consent: equal-weight "Accept" and "Decline" buttons. Default off. Choice is changeable from the footer. (REQ-025.)
- Researcher terms at first login: scroll-free summary with 3 bullet points; full text in a sheet; checkbox "I agree" not pre-checked; version and date logged.
- A permanent "Privacy" link in footer. A "This portal holds no patient identity" badge on search pages (REQ-041).
- All legal copy: needs legal review.

### 7.8 Aggregate-count display with suppressed state (REQ-032, REQ-033)
Count tile shows: label, value, optional note.
| State | Display | Screen reader |
|---|---|---|
| Value (≥ k) | "128" large, tabular | "128 samples" |
| Suppressed (< k) | Show "—" with a neutral icon and the text "Too few to show" | "Count not shown to protect privacy" |
| Merged | Value for the broader category + chip "Includes related categories" | "Count includes related categories" |
| Loading | Static skeleton | "Loading count" |
| Error | "Could not load" + retry | same |
Rules:
- Never print the threshold-adjacent number ("<5") in the UI. It leaks information. Show only "Too few to show". (Closed by canonical-decisions C-09.)
- Never use red or warning color. Use `--color-suppressed-bg` and muted text.
- Suppression must not be inferable by difference: totals and sub-totals are suppressed together when needed (complementary suppression, A2).
- Show a "Why are some numbers hidden?" disclosure on every page with counts.
- Role differences: `national_coordinator` and `center_clinician` (own center) may see exact counts per their role. Display a badge "Coordinator view".

## 8. Data visualization
Follow the same palette. Max 5 series. Pair color with pattern or label. Direct labels over legends. Axis text ≥ 12 px. Every chart has a table alternative and a text summary. Suppressed bins are drawn as hatched neutral bars labeled "Too few to show", never as zero. Rule: **time runs inline-start to inline-end** (right to left in Hebrew), following reading order. Numbers and Latin labels stay LTR. UNVERIFIED convention; confirm with a Hebrew reader panel (OPEN-A5-04).

## 9. Iconography
- Style: 1.75 px stroke, round caps, 24 px grid. One icon set (open license such as Lucide, ISC; verify license — UNVERIFIED).
- Icons never carry meaning alone. Mirror list in `03-rtl-bidi.md`.

## 10. Do / don't summary
Do: space, plain words, one primary action, visible status. Don't: heavy shadows, gradients over text, color-only status, icon-only buttons without labels, red for suppression, carousels.
