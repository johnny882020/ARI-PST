# 03 — RTL and bidirectional rules
Covers REQ-020. Hebrew is the default locale. RTL is first-class, not a mirror afterthought.

## 1. Direction
- `<html lang="he" dir="rtl">` and `<html lang="en" dir="ltr">`. Set both on every page. Set `hreflang` links.
- Locale switch changes `lang`, `dir`, and URL path (`/he/…`, `/en/…`).
- Test every screen in both. Playwright runs he + en (A8).

## 2. CSS: logical properties only
| Do not use | Use |
|---|---|
| margin-left / right | margin-inline-start / -end |
| padding-left / right | padding-inline-start / -end |
| left / right | inset-inline-start / -end |
| text-align: left / right | text-align: start / end |
| border-left | border-inline-start |
| border-top-left-radius | border-start-start-radius |
| float: left | float: inline-start |
| width/height in axis terms | inline-size / block-size (when it helps) |
| transform: translateX(n) | use `calc(var(--dir) * n)`; `--dir` is 1 in LTR and -1 in RTL |
Flexbox and grid follow direction by default. Do not use `row-reverse` to fake RTL.
Lint: stylelint `liberty/use-logical-spec` (verify plugin name; UNVERIFIED). CI fails on physical properties in `packages/design-system` and `apps/**`.
Exception: things that are physically fixed (a map, a chart's numeric axis, a video timeline). Mark with a comment `/* physical: reason */`.

## 3. Icons that MUST mirror in RTL
Mirror (flip horizontally) when the icon shows direction of reading or progress:
- arrow-back / arrow-forward, chevron-start / chevron-end, caret-next / previous
- "next" / "previous" pagination arrows
- breadcrumb separator
- list-with-indent, text-indent, outdent
- reply, forward, undo, redo (curved arrows)
- sign-in / sign-out, external-link arrow (the "out" arrow)
- stepper progress arrow, timeline connector arrows
- sidebar collapse/expand, drawer open/close
- "send", "paper plane"
- quote marks, bullet-list markers
- slider thumbs, progress bars (fill from the inline-start)
- help-with-arrow, "continue" icons

Do NOT mirror:
- Logo and brand mark
- Clock, refresh/rotate-clockwise (clock direction is universal)
- Checkmark, plus, minus, close (X), search magnifier (handle direction: keep as is; acceptable either way)
- Media play / pause / forward-rewind controls (they follow the timeline, which stays LTR in media players)
- Phone, globe, camera, heart, user, lock, bell, warning, info, filter funnel, settings gear
- Charts' numeric axes and any graph (see 02 §8)
- Text with Latin script, numbers, phone numbers
- Real-world objects (microscope, test tube, calendar grid layout of the week: week starts Sunday in Israel; follow `Intl` locale)
Implementation: `.icon-mirror { transform: scaleX(-1) }` inside `[dir="rtl"]` only. Icons carry `data-mirror="true"` in the icon set.

## 4. Bidi (mixed Hebrew / English / numbers / Latin terms)
Problem: Latin and numbers inside Hebrew can reorder punctuation and break order.
Rules:
1. Wrap every inline Latin phrase in Hebrew text with `<bdi>` (isolates, auto direction), or `<span lang="en" dir="ltr">`.
2. User-generated or unknown-language text: `dir="auto"` on the element, or `<bdi>`. Applies to: names of centers, free-text fields, search echoes, file names.
3. Form inputs with mixed content: `<input dir="auto">`. Identifiers and codes: `dir="ltr"` with `text-align: start`.
4. Numbers: keep Western digits (0–9) in both languages. Use `Intl.NumberFormat('he-IL')`. Large numbers use a comma thousands separator. Wrap in `<span class="num">` (direction LTR, isolated) when next to punctuation or Latin text.
5. Ranges and ages: "6–<10" in Hebrew UI uses `<bdi dir="ltr">6–&lt;10</bdi>` plus a unit: "גיל 6 עד פחות מ-10". Do not rely on symbols alone in Hebrew; use words in the label and symbols in the compact table.
6. Percent: write `<bdi>45%</bdi>` — the `%` stays attached to the number.
7. Dates: ISO `2026-09-01` in tables (LTR isolate). Prose dates use `Intl.DateTimeFormat('he-IL', {dateStyle:'long'})`. Collection month `YYYY-MM` is LTR isolate.
8. Latin medical terms (e.g. "Medulloblastoma", "FFPE", "WES", "RNA-seq", "MRI"): keep Latin spelling; wrap in `<bdi>` or `<span lang="en" dir="ltr">`. Provide Hebrew gloss in parentheses on first use. Example: `<bdi>FFPE</bdi> (פרפין)` — UNVERIFIED term list; A3 owns vocabulary.
9. Parentheses and punctuation at the end of a Hebrew sentence that ends in Latin: the isolate keeps the period at the correct side. Do not add manual Unicode marks (LRM/RLM) unless a test shows a fault; if needed use `&lrm;` / `&rlm;` and document the case.
10. Email, URL, phone: `dir="ltr"` isolate, selectable as one unit.
11. `unicode-bidi: isolate` for `.num`, `.ltr`, `bdi`. Do not use `unicode-bidi: bidi-override` (it breaks copy-paste and screen readers).
12. Sorting and search: use `Intl.Collator('he')`. Search ignores Hebrew niqqud (vowel marks) and final-letter forms. Latin search is case-insensitive.
13. Truncation: ellipsis at the inline-end. Do not truncate inside a Latin token or number.
14. Screen readers: set `lang` on foreign-language spans so the voice changes (`lang="en"`).
15. i18n keys carry no direction. ICU MessageFormat placeholders are wrapped by a helper `bdi(value)` for user data.
16. Pseudo-locale test: add an `he-XB` pseudo locale with mixed strings (Hebrew + Latin + numbers + long text) to catch bidi faults in CI (A6/A8).

## 5. Layout rules in RTL
- Navigation sits at the inline-start (right). Primary button sits at the inline-end of a button row, as in LTR logic (so in Hebrew: left). Check with users: UNVERIFIED; convention follows logical order, "primary last".
- Tables: first column at the inline-start (right).
- Numeric columns align to inline-end, with LTR isolate.
- Progress and sliders fill from inline-start.
- Toasts appear at the block-end, centered, so no side issues.
- Keyboard: ArrowLeft/ArrowRight reverse in RTL for tabs, radio groups, sliders, carousels (none planned), menus. Implement through logical helpers, not by checking the key alone.
- Text fields: caret and placeholders follow `dir`. Placeholder alignment is `start`.
- Scrollbars: browser decides. Do not override.
- Hebrew text is ~10–20% shorter than English for some strings and longer for others. Allow wrap. Never fix button width.

## 6. Test checklist (RTL)
- [ ] Every screen in `he` and `en` in light and dark.
- [ ] No physical CSS properties (lint).
- [ ] All mirror-list icons flip. No non-mirror icon flips.
- [ ] Mixed strings: "FFPE (פרפין) – 128 דגימות, 2026-09" renders in logical order.
- [ ] Copy/paste of a Hebrew sentence with Latin term keeps order.
- [ ] Screen reader reads Latin terms with an English voice (NVDA + Hebrew voice; VoiceOver Hebrew).
- [ ] Zoom 200% and 400% reflow, no clipping.
