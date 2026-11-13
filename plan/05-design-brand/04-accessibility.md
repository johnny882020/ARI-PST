# 04 — Accessibility
Covers REQ-022. Target: WCAG 2.1 Level AA, plus Israeli legal duties. This is not legal advice. Needs legal review.

## 1. Legal status (checked 2026-11-13 by WebSearch)
Findings come from secondary sources (vendor blogs). No official government text was reached. Mark: **UNVERIFIED against the official source.**
- Israeli Standard 5568 (IS 5568, ת"י 5568) covers web content accessibility. Secondary sources say it is based on WCAG, at level AA.
- Equal Rights for Persons with Disabilities Regulations (Service Accessibility Adjustments), 2013 (תקנות שוויון זכויות לאנשים עם מוגבלות (התאמות נגישות לשירות), התשע"ג-2013) are said to require service providers' websites to meet IS 5568 Part 1 at level AA. Said to apply to public and private service providers, with revenue-based exemptions for small ones.
- **Conflict between sources:** some say IS 5568 is anchored to WCAG 2.0 AA; others say the current edition (2020, with a 2023 update to Part 1) aligns with WCAG 2.1 AA. UNVERIFIED which is legally binding today.
- Decision (ASSUMPTION-A5-01): target **WCAG 2.1 AA**. It includes all WCAG 2.0 AA criteria, so it satisfies either reading. Add WCAG 2.2 AA items that are cheap (focus not obscured, target size, consistent help, accessible authentication) as "should".
- Typical duties named in secondary sources: an accessibility statement page; a named accessibility coordinator; a feedback channel. UNVERIFIED. Plan to include all three (REQ-022).
- Action for owner: ask counsel to confirm (1) whether this portal is a "service provider" under the Regulations, (2) the binding standard edition, (3) statement wording, (4) whether the protected area is in scope. See OPEN-A5-02.

Sources (secondary):
- https://www.boia.org/blog/israels-digital-accessibility-laws-an-overview
- https://user-a.co.il/en/standards/israeli-accessibility-standards-vs-wcag
- https://regulations.clym.io/israeli-standard-5568-is-5568
- https://blog.equally.ai/web-accessibility/is-5568-everything-on-israels-accessibility-law/
Official sources to check: Israeli Standards Institute (SII) IS 5568; Commission for Equal Rights of Persons with Disabilities (Ministry of Justice) site; Nevo/Knesset legal text.

## 2. Targets (measurable)
- 0 critical or serious axe violations on all key screens (he + en, light + dark).
- Manual audit with NVDA (Windows), VoiceOver (macOS, iOS), TalkBack (Android) before release. Include a Hebrew-speaking screen-reader user in testing.
- Lighthouse accessibility ≥ 95 (supporting signal only).
- All WCAG 2.1 A + AA criteria pass in a documented audit (A8 owns test cases).
- Accessibility statement published and dated; reviewed every 12 months and after major releases.

## 3. Contrast table (WCAG relative luminance; computed)
AA needs ≥ 4.5:1 for normal text, ≥ 3:1 for large text and UI components.
| Pair | Light | Ratio | Dark | Ratio |
|---|---|---|---|---|
| text on bg | #1D2230 / #FBFAF8 | 15.21 | #EDEFF3 / #12161C | 15.76 |
| text on surface | #1D2230 / #FFFFFF | 15.86 | #EDEFF3 / #1A2029 | 14.22 |
| muted on bg | #4A5262 / #FBFAF8 | 7.53 | #AEB6C4 / #12161C | 8.89 |
| muted on surface | #4A5262 / #FFFFFF | 7.85 | #AEB6C4 / #1A2029 | 8.02 |
| primary (link) on bg | #0B5C73 / #FBFAF8 | 7.21 | #6CC4DA / #12161C | 9.11 |
| primary on surface | #0B5C73 / #FFFFFF | 7.52 | #6CC4DA / #1A2029 | 8.22 |
| text on primary button | #FFFFFF / #0B5C73 | 7.52 | #0A1A20 / #6CC4DA | 8.93 |
| accent text on bg | #A8461F / #FBFAF8 | 5.65 | #F0A27A / #12161C | 8.77 |
| text on accent | #FFFFFF / #A8461F | 5.90 | #1A0E08 / #F0A27A | 9.15 |
| success on white/surface | #1E6B3B / #FFFFFF | 6.52 | #7FD39B / #1A2029 | 9.12 |
| warning on surface | #7A5200 / #FFFFFF | 6.92 | #F2C46B / #1A2029 | 10.05 |
| danger on surface | #B3261E / #FFFFFF | 6.54 | #FF9A91 / #1A2029 | 8.02 |
| success on subtle | #1E6B3B / #E6F3EA | 5.70 | #7FD39B / #17301F | 7.91 |
| warning on subtle | #7A5200 / #FFF3D6 | 6.28 | #F2C46B / #3A2C0E | 8.33 |
| danger on subtle | #B3261E / #FCE8E6 | 5.55 | #FF9A91 / #3D1B18 | 7.51 |
| info on subtle | #0B5C73 / #E4F1F5 | 6.52 | #6CC4DA / #12303A | 6.99 |
| suppressed text on suppressed bg | #4A5262 / #EEF0F3 | 6.88 | #AEB6C4 / #242B36 | 6.98 |
| control border (UI, 3:1) | #7B8494 / #FFFFFF | 3.77 | #7D8799 / #1A2029 | 4.52 |
| focus ring on surface | #0B5C73 / #FFFFFF | 7.52 | #6CC4DA / #1A2029 | 8.22 |
Gold `#F2B84B` is decorative only; it has no text pairing.
Method: script in the author's scratchpad, formula from WCAG 2.1 (sRGB linearization). A7 should add a CI contrast test on `tokens.css` (token-pair list above).

## 4. Target sizes and spacing
- Touch/click target ≥ 44 × 44 CSS px (WCAG 2.1 AAA 2.5.5 level; we adopt it; AA 2.2 minimum is 24 px).
- ≥ 8 px between adjacent targets.
- Inline links in text are exempt but keep line-height ≥ 1.5.
- Text resizes to 200% without loss; reflow at 320 px width (1.4.10); text spacing override works (1.4.12).

## 5. Keyboard flows
Global:
- First Tab stop: "Skip to main content" (he: "דלג לתוכן הראשי"). Then header, nav, main.
- Visible focus ring everywhere (2 px outline + offset, ≥ 3:1).
- No keyboard trap. Esc closes dialogs, sheets, menus. Focus returns to the trigger.
- Landmarks: header, nav, main, aside (filters), footer. One `h1` per page. Headings in order.
- Page title changes on route change. Focus moves to `h1` on SPA navigation; live region announces "Page loaded: {title}".

Search results:
1. Tab to search field → type → Enter. Focus stays; results region announces "{n} results".
2. Tab to filters. Each filter group is a `fieldset`. Space toggles checkboxes. Applied-filter chips are in tab order with remove buttons.
3. Tab to results table or list. Arrow keys are not required; Tab moves through rows' actions.
4. "Add to cart" button label: "Add {category} to request cart". After adding, a polite live message "Added. Cart has {n} items." Focus stays on the button.

Request form:
1. Stepper links allow jump to completed steps only.
2. On error, focus moves to the error summary; links jump to fields.
3. Submit shows confirmation page with `h1` focus.

Data table: sortable header buttons; row checkbox; bulk bar appears after the table header and is announced ("2 rows selected").
Dialogs: focus first field or title; trap; labeled by title.
Combobox: ARIA 1.2 pattern: Down opens list; Up/Down move; Enter selects; Esc closes. In RTL, Left/Right do not navigate lists.
Tabs: Left/Right move (reversed in RTL); Home/End.

## 6. Screen-reader copy (examples)
| Element | English | Hebrew |
|---|---|---|
| Count tile, value | "Samples with this diagnosis: 128" | "דגימות עם אבחנה זו: 128" |
| Count tile, suppressed | "Count not shown, to protect privacy" | "המספר אינו מוצג, כדי להגן על הפרטיות" |
| Merged | "Count includes related categories" | "המספר כולל קטגוריות קרובות" |
| Remove filter | "Remove filter: Medulloblastoma" | "הסר סינון: Medulloblastoma" |
| Cart button | "Add to request cart" | "הוסף לסל הבקשה" |
| Stepper | "Step 3 of 8, Committee decision, current" | "שלב 3 מתוך 8, החלטת הוועדה, נוכחי" |
| Loading | "Loading results" | "טוען תוצאות" |
| Language switch | "עברית, current language" / "English" | "English" with `lang="en"` |
| Icon-only close | "Close dialog" | "סגור חלון" |
Rules: no "click here"; link text is meaningful; `aria-live="polite"` for results and cart; `assertive` only for blocking errors; do not announce every keystroke.

## 7. Other requirements
- Language of page and of parts (`lang`).
- Forms: labels, instructions, errors in text, `autocomplete` tokens (1.3.5), no time limits; session timeout warning 2 minutes before, with "extend" (2.2.1).
- Authentication (REQ-044): passkey, TOTP; no cognitive-test CAPTCHA. Paste allowed in code fields. Accessible alternative for each step.
- Media: captions + transcript for video; no autoplay.
- PDF and exports: tagged, with language. CSV exports have header row in `he` or `en` by choice.
- Charts: text alternative + data table.
- Motion: reduced-motion respected. No flashing.
- Color: not the only cue; works in forced-colors, grayscale.
- Print stylesheet for the families page and request summary.
- Accessibility statement page (he + en): conformance claim, known gaps, contact (coordinator role), date, feedback route, response time. Wording needs legal review.
- Accessibility regression tests: axe in Playwright on every key screen, he + en, light + dark.
