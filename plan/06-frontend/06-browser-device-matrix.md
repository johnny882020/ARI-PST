# 06 — Browser, device, and mobile support

Scope: REQ-020, REQ-021, REQ-022. Version numbers are targets as of 2026-11-13; check usage data before final.

## 1. Support levels

- **Tier 1:** fully tested in CI (Playwright) and in the release checklist. No known defects allowed.
- **Tier 2:** tested by smoke tests. Minor visual defects allowed. Functional defects are fixed.
- **Tier 3:** best effort. Public site must stay readable. Protected app shows an "unsupported browser" page.

| Browser | Public site | Protected app | Notes |
|---|---|---|---|
| Chrome / Edge (Chromium), last 2 stable | Tier 1 | Tier 1 | Desktop + Android |
| Safari, last 2 majors (iOS and macOS) | Tier 1 | Tier 1 | iOS Safari is the main mobile browser in Israel (UNVERIFIED stat) |
| Firefox, last 2 stable + ESR | Tier 1 | Tier 2 | |
| Samsung Internet, last 2 | Tier 2 | Tier 2 | |
| Older evergreen (up to ~2 years: Chrome 109, Safari 16.4, Firefox 115) | Tier 2 | Tier 2 | Build target floor |
| Internet Explorer, legacy Edge, Opera Mini, UC | Tier 3 | Not supported | Public site works as plain HTML/CSS |

Required platform features in the protected app (checked at start-up; if missing → unsupported page): ES2022, `fetch`, CSS logical properties, CSS custom properties, `Intl.PluralRules`, `crypto.subtle`, `BroadcastChannel`. WebAuthn is not required (TOTP fallback).

Vite targets: `['es2022','chrome109','edge109','firefox115','safari16.4']`. Browserslist file shared with Astro: `defaults and fully supports css-logical-properties, last 2 versions`... exact string set at build (to be validated).

Public site rule: works with JS disabled (all content, navigation, language switch via links). Forms need JS for the challenge; a no-JS mailto fallback to the role mailbox is shown.

## 2. Devices and viewports (CI and manual)

| Class | Viewport (CSS px) | Test in CI |
|---|---|---|
| Small phone | 360x740, DPR 3 | Playwright `Pixel 5` / custom |
| iPhone | 390x844 | Playwright `iPhone 13/14` |
| Small tablet | 768x1024 | Playwright `iPad` |
| Laptop | 1280x800 | default |
| Wide | 1920x1080 | smoke |

Breakpoints (tokens; final values with A5): `sm 600`, `md 840`, `lg 1200`. Mobile-first CSS.

Real-device manual pass per release: one iPhone (current iOS), one mid-range Android, one tablet, one Windows laptop with screen magnifier.

## 3. Mobile behavior

Public site:
- Single column; sticky header with hamburger (`button` with `aria-expanded`, focus trap not needed for a disclosure nav).
- Language switch visible in the header (not hidden in menu).
- Tap targets ≥ 44x44 px. Body text ≥ 16 px (prevents iOS zoom on inputs).
- No horizontal scroll at 320 px.
- Images are responsive; hero is height-limited to keep LCP fast.

Protected app (REQ-021: mobile-friendly):
- Search: filters collapse into a bottom sheet "Filters (n)" with Apply / Clear. Results show as cards, not wide tables.
- Tables on small screens become stacked cards (key fields first). Horizontal scroll tables are used only for the audit log, with a sticky first column and an accessible caption.
- Request cart is a full-screen page on mobile (drawer on desktop).
- Request form: one step per screen, sticky "Next" bar, large inputs, correct `inputmode` and `autocomplete`.
- Tracker: vertical timeline.
- Committee vote screen works on a phone (large buttons, explicit confirm).
- Coordinator entry screen and import wizard are **desktop-first**; on a phone they show a read-only view plus a notice "Use a larger screen to enter data". (Entry on mobile is not a Phase 1 goal; OPEN-A6-07.)
- Session warning dialog is full-width on mobile.
- Passkey works on mobile (platform authenticator). TOTP code paste works.
- Safe areas (`env(safe-area-inset-*)`) respected. `meta viewport` without `user-scalable=no`.
- Orientation: both. No fixed-height layouts. Use `dvh` units.
- Network: slow-network skeletons; retry button; offline banner (no offline data cache for privacy).
- Dark mode follows the system; manual toggle in settings; `color-scheme` meta set.
- Print: public pages have a clean print CSS. App print is limited (see security file).
- Touch and pointer: hover-only content always has a tap or focus alternative.

## 3b. RTL and bidi checks

- `dir` set at `<html>`. Mixed Hebrew/Latin (diagnosis codes, `sample_code`, numbers with units) wrapped in `<bdi>` or `dir="ltr"`.
- Layout mirrored: nav, steppers, timeline, breadcrumbs, pagination, progress, sliders.
- Charts: axis direction follows the locale; numbers stay LTR.
- Fonts: Hebrew-capable family with matching Latin (A5 picks); subset with Hebrew range U+0590–05FF.
- Playwright screenshot diff he vs en for key screens catches broken mirroring.

## 4. Assistive tech matrix

| AT | Browser | Tier |
|---|---|---|
| NVDA | Firefox, Chrome | 1 |
| JAWS | Chrome | 2 |
| VoiceOver | Safari macOS, Safari iOS | 1 |
| TalkBack | Chrome Android | 1 |
| Windows magnifier / ZoomText, browser zoom 200–400% | Chrome | 1 |
| Voice control (iOS/Windows) | n/a | 2 |
