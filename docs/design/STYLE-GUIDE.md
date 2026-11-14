# ARI-PST style guide

This guide tells you how to make a screen look like the ARI-PST brand. The style is calm, airy and quiet: white space, navy type, one small gold accent.

Reference picture from the owner: [`reference-hero-mobile.jpg`](reference-hero-mobile.jpg).
Token source: [`plan/05-design-brand/tokens.css`](../../plan/05-design-brand/tokens.css). Components: [`packages/design-system`](../../packages/design-system/README.md).

## 1. Palette

Use semantic tokens (`--color-*`) in components. Do not type hex values in component CSS.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--color-primary` | `#2C4F76` | `#9DBCE0` | Filled buttons, active toggle, links, logo arcs |
| `--color-heading` | `#2C4F76` | `#C9DBEF` | Headlines, wordmark |
| `--color-text` | `#1C2B3E` | `#E8EDF4` | Body text |
| `--color-text-muted` | `#5F6672` | `#A9B4C3` | Lead paragraph, help text |
| `--color-eyebrow` | `#4A6787` | `#A9B4C3` | Eyebrow line, inactive segment |
| `--color-gold` | `#E0B84F` | `#E0B84F` | Dots only. Never text |
| `--color-bg` | `#FBFCFD` | `#0F1724` | Page |
| `--color-surface` | `#FFFFFF` | `#152033` | Cards, header, secondary buttons |
| `--color-hero-from` | `#E9EDF2` | `#16233A` | Top of the hero gradient |
| `--color-border` | `#E3E7EC` | `#2A3A52` | Dividers, pill and card edges |
| `--color-border-strong` | `#7C8696` | `#7487A0` | Input edges |

## 2. Contrast

Measured in Chromium on the built public site (2026-11-14). AA needs 4.5:1 for text and 3:1 for input edges.

| Pair | Light | Dark |
|---|---|---|
| Display headline on hero band | 7.18 | 11.13 |
| Eyebrow on hero band | 4.99 | 7.49 |
| Lead text on hero band (worst point) | 4.92 | 7.49 |
| Muted text on white | 5.78 | 7.78 |
| Primary button text | 8.44 | 8.91 |
| Secondary button text | 8.44 | 8.32 |
| Active language segment | 8.44 | 8.91 |
| Inactive language segment | 5.86 | 7.78 |
| Body text on card | 14.34 | 13.88 |
| Input edge (non-text) | 3.68 | 4.44 |

The reference grey `#6B7280` was darkened to `#5F6672` so that lead text stays above 4.5:1 on the grey hero band.

## 3. Typography

| Role | Stack | Size | Weight | Line height | Tracking |
|---|---|---|---|---|---|
| Display (hero h1) | `--font-display` (Inter, SF) | `clamp(2.125rem, 1.25rem + 3.6vw, 4.5rem)` | 400 | 1.05 | -0.025em |
| h1 (pages) | `--font-display` | 2.75rem (2.125rem phone) | 400 | 1.2 | -0.025em |
| h2 | `--font-display` | 1.5-2rem | 500 | 1.2 | 0 |
| Eyebrow | `--font-body` | 0.8125rem (0.75rem phone), caps | 600 | 1.4 | 0.28em |
| Wordmark | `--font-display` | 1.25-1.5rem, caps | 700 | 1.1 | 0.12em |
| Hero lead | `--font-body` (Source Sans 3) | 1.25rem (1.125rem phone) | 400 | 1.6 | 0 |
| Body | `--font-body` | 1rem | 400 | 1.6 | 0 |

Hebrew uses `--font-he` (Assistant, Heebo) and `--font-display-he` (Heebo). Hebrew gets no letter-spacing and no caps. The tokens do this for you through `:lang(he)`.

Fonts are not bundled. The stacks use `local()` and system fonts. Never load a font from a CDN. To bundle fonts, follow `packages/design-system/fonts/README.md`.

## 4. Components

1. **Logo.** Use `<Logo />` (React) or `Logo.astro`. Ring, three navy arcs, gold dot, wordmark "ARI-PST". Use `<Logo partner />` for the "ARI-PST × Tech4Cancer" lock-up (footer). Do not mirror it in RTL.
2. **Eyebrow.** `<Eyebrow>A national initiative · Paediatric oncology</Eyebrow>`. One per view, above the main heading.
3. **Display heading.** `<DisplayHeading>` for a hero. Use `size="title"` for a page title in the app.
4. **Buttons.** Every button is a pill. Primary: navy fill, white text. Secondary: white, light border, navy text. Sizes: `sm` 44 px, `md` 48 px, `lg` 56 px (52 px on phones). Add `arrow` to the one "go forward" action. The arrow mirrors in RTL.
5. **Links that look like buttons.** Use `buttonClass({ variant, size, arrow })` on a router `Link`.
6. **Language switch.** `<LanguageSwitch />` shows "EN | עב". The active segment is a navy pill. The accessible name is the full endonym ("English", "עברית").
7. **Menu button.** `IconButton variant="outline"`: round, light border, navy hamburger.
8. **Cards.** 24 px radius, 1 px light border, very soft shadow.
9. **Hero.** Gradient from `--color-hero-from` to `--color-bg`, then eyebrow, display heading, lead, buttons.

## 5. Do and don't

| Do | Don't |
|---|---|
| Leave a lot of white space | Fill the hero with pictures or boxes |
| Use one primary button per view | Put two navy buttons next to each other |
| Use gold only for the two dots | Use gold for text, borders or icons |
| Use the muted grey for long lead text | Use grey below 4.5:1 |
| Keep headings light (400) and navy | Make display headings bold |
| Use logical CSS (`margin-inline-start`) | Use `margin-left`, `left:`, `text-align: left` |

## 6. RTL notes

1. Set `lang` and `dir` on `<html>`. Tokens switch fonts and tracking by `:lang(he)`.
2. The arrow icon (`arrow-end`) points to the inline end. It mirrors in RTL.
3. The language switch keeps the order EN, עב in the markup. In RTL the order shows from right to left.
4. The logo lock-up has `dir="ltr"`. It does not flip.
5. Wrap Latin names inside Hebrew text with `<bdi>` when they end a sentence.

## 7. Screenshots

| Screen | File |
|---|---|
| Reference (left) and public home, en, 390 px (right) | [`screenshots/compare-reference-vs-en-390.png`](screenshots/compare-reference-vs-en-390.png) |
| Public home, en, 390 x 844 | [`screenshots/public-home-en-390.png`](screenshots/public-home-en-390.png) |
| Public home, he, 390 x 844 | [`screenshots/public-home-he-390.png`](screenshots/public-home-he-390.png) |
| Public home, en, dark, 390 x 844 | [`screenshots/public-home-en-390-dark.png`](screenshots/public-home-en-390-dark.png) |
| Public home, en, 1280 x 800 | [`screenshots/public-home-en-1280.png`](screenshots/public-home-en-1280.png) |
| App sign-in, 1280 and 390 | [`screenshots/web-login-en-1280.png`](screenshots/web-login-en-1280.png), [`screenshots/web-login-en-390.png`](screenshots/web-login-en-390.png) |
| App MFA, 390 | [`screenshots/web-mfa-en-390.png`](screenshots/web-mfa-en-390.png) |
| App researcher home, 1280 and 390 | [`screenshots/web-researcher-home-en-1280.png`](screenshots/web-researcher-home-en-1280.png), [`screenshots/web-researcher-home-en-390.png`](screenshots/web-researcher-home-en-390.png) |

All screenshots use synthetic data and the in-repo mock API.

## 8. Known differences from the reference

1. The eyebrow wraps to two lines on a 390 px phone. The reference face is narrower. Smaller type would be hard to read.
2. Source Sans 3 is not bundled, so body text falls back to the system sans. Lines are a little wider than in the reference.
3. Header controls are at least 44 px (touch target rule). The reference controls are a little smaller.
4. Lead text is darker (`#5F6672`) than the reference grey, for contrast.
