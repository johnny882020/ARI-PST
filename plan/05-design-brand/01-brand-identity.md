# 01 — Brand identity: ARI-PST × Tech4Cancer
Covers REQ-071, REQ-020. Status: draft v0.1. Hebrew terms are next to English where users see them.

## 1. Essence
**One line:** Science that walks beside families.
**Hebrew line (draft):** מדע שהולך לצד המשפחות.
**Meaning:** Many centers share knowledge. Children with brain tumors get better answers sooner.
The brand says: we are careful, we are open, we are hopeful.

## 2. Personality
| Is | Is not |
|---|---|
| Warm (חם) | Cold-clinical (hospital-white, sterile) |
| Hopeful (מלא תקווה) | Naive or cheerful at any cost |
| Dignified (מכבד) | Pity, drama, "brave little fighter" |
| Scientific (מדעי) | Jargon-heavy, intimidating |
| Calm, precise | Loud, urgent, alarmist |
| Collaborative | Corporate, competitive |

## 3. Voice and tone
Rules for both languages:
- Short sentences. One idea each.
- Say what happens next.
- Name people as people: "children and families", not "patients" in public text.
- Never use war words ("battle", "fight", "victim"). Never say "suffering from".
- Numbers are exact. Do not round up to look good.

| Context | English tone | Hebrew tone (טון) |
|---|---|---|
| Public site | Warm, plain, confident | חם, פשוט, בטוח. פנייה בלשון רבים ("אנחנו") |
| Families page | Gentle, slow, no jargon | עדין, ברור, בלי מונחים רפואיים לא מוסברים |
| Researcher app | Precise, calm, brief | מדויק, רגוע, קצר |
| Errors | Honest, helpful, blames no one | כנה ומועיל, בלי להאשים |
| Privacy and consent | Plain, complete, no pressure | פשוט ומלא, בלי לחץ |

Hebrew rules:
- Use gender-neutral wording where possible (infinitive, plural, "נא ל…" sparingly). When a form must address one person, use the plural or neutral form. Offer no gender guess.
- Use "ילדים ובני נוער" (children and teens) when talking about the age range. Do not say "חולים קטנים".
- Spell the brand in Latin script in both languages: **ARI-PST × Tech4Cancer**. Never transliterate.
- Write "Tech4Cancer" as one word. Keep the "4".

## 4. Naming and lock-up rules
- Product: **ARI-PST Portal** (EN) · **פורטל ARI-PST** (HE).
- Brand line: **ARI-PST × Tech4Cancer**. The "×" is U+00D7. Spaces around it.
- Order is fixed: ARI-PST first, Tech4Cancer second.
- Primary lock-up: mark + "ARI-PST" (bold) + "× Tech4Cancer" (medium, smaller). Horizontal.
- Stacked lock-up: for square spaces (app icon, social).
- Mark only: for favicon, avatar. Use only with a visible name nearby.
- Clear space: height of the letter "A" on every side.
- Minimum size: mark 24 px; full lock-up 120 px wide on screen.
- RTL page: the lock-up does **not** flip. Latin brand text stays left-to-right. The mark may sit at the inline-start edge (right side in Hebrew) while text stays LTR.
- Partner logos (Shaare Zedek, Madgam, others) follow their own guidelines. Place them in a "Partners" row. Do not merge them into the lock-up. UNVERIFIED: partner logo permissions.
- Do not: recolor outside the palette, add shadows, rotate, stretch, place on busy photos without a scrim, use gold for text.

## 5. Logo directions (3 concepts; owner picks one)
All SVGs are simple sketches. A designer must refine them. They use palette tokens.

### A — Bridge (`logo-a-bridge.svg`)
An arc joins two points. A gold dot sits above it like a sun or a sample. A clay line is the ground.
Idea: centers connected by shared knowledge. Feels calm and open. Risk: looks like a generic "bridge" icon.

### B — Constellation (`logo-b-constellation.svg`)
Four nodes joined by thin lines, with one gold node on top. White on a teal rounded square.
Idea: a distributed index of many centers, one hopeful point. Feels scientific and modern. Risk: network icons are common.

### C — Sprout (`logo-c-sprout.svg`)
A thin ring with a stem and two leaves (teal and clay). A small gold seed at the base.
Idea: growth and care. Feels warm and hopeful. Risk: can read as "eco" brand. Keep the leaves abstract. No heart, no ribbon, no child figure.

**Recommendation:** B for the app UI (it scales to a favicon). C for the public site and families page. Owner decides. See OPEN-A5-01.

## 6. Color system
Source of truth: `tokens.css`. Contrast ratios are computed (WCAG 2.1 relative luminance). Full table in `04-accessibility.md`.

Palette idea: deep teal (science, calm) + clay (warmth) + a small gold spark (hope). Neutrals are warm-tinted, not blue-white.

| Token | Light | Dark | Use |
|---|---|---|---|
| bg | #FBFAF8 | #12161C | Page |
| surface | #FFFFFF | #1A2029 | Cards |
| text | #1D2230 | #EDEFF3 | Body (15.2:1 / 15.8:1) |
| text-muted | #4A5262 | #AEB6C4 | Secondary (7.5:1 / 8.9:1) |
| primary | #0B5C73 | #6CC4DA | Links, buttons (7.2:1 / 9.1:1) |
| accent | #A8461F | #F0A27A | Warm highlight (5.7:1 / 8.8:1) |
| decor-warm | #F2B84B | #F2B84B | Decoration only. Never text. |
| success | #1E6B3B | #7FD39B | Status |
| warning | #7A5200 | #F2C46B | Status |
| danger | #B3261E | #FF9A91 | Status |

Rules:
- Color is never the only signal. Pair with text or icon.
- Restraint: one primary action per view. Accent at most once per view.
- Red is for real errors only. Never use red for counts, missing data, or "suppressed".
- Dark mode is not inverted light mode. Surfaces get lighter as they rise.

## 7. Imagery and illustration
- Style: soft, hand-drawn line plus flat color shapes. Round ends. No sharp edges.
- Themes: light, growth, connection, microscope detail as pattern, abstract cells. Many hands, not one hero.
- Palette: only brand colors. Gold in small amounts.
- Never: crying faces, IV poles, bald-head-as-symbol, hospital beds as main image, ribbons as main symbol, "before/after", superhero children, red blood imagery, skull or brain-in-pain visuals.
- Charts follow `02-design-system.md` data-visualization rules.
- Every image has useful alt text, or empty alt if decorative.
- Illustrations are SVG. Light/dark variants use tokens (`currentColor`, CSS vars).

## 8. Photography — do and don't
Do:
- Show researchers, clinicians, coordinators at work. Natural light. Real expressions.
- Show families only with signed, documented, revocable consent (needs legal review). Prefer hands, backs, shared moments, drawings.
- Show lab detail (slides, pipettes) as texture, not as fear.
- Mix backgrounds, ages, and genders. Reflect Israeli society (Jewish, Arab, Druze, others). UNVERIFIED: content plan with clinical leads.
- Use warm color grade. Soft contrast.

Don't:
- Do not use stock "sick child" photos. Do not use any photo of an identifiable child without guardian consent.
- Do not show a face on a medical bed with equipment as a hero image.
- Do not use before/after, pity framing, or donation-pressure shots.
- Do not show screens with real patient data. Mockups use synthetic data only.
- Do not use AI-generated images of children.

## 9. Sensitive-audience guidance (families)
Families may read this site on a very hard day. Design for that.
1. Put the main answer first. No dark patterns. No countdowns.
2. Plain words. Explain each medical term once, in a "What does this mean?" disclosure.
3. No auto-play video or sound. No pop-ups on the families page.
4. Never ask families to log in to read. The families page is public.
5. Say clearly what the portal is and is not: "This site does not hold your child's medical record." (REQ-002, REQ-009).
6. Do not show statistics about survival on the families page unless a clinical lead approves the exact text.
7. Provide a human route: contact, and links to support organizations. UNVERIFIED: list of Israeli support organizations (content owner supplies).
8. Offer reading comfort: text size, calm mode (reduced motion and lower contrast intensity is NOT allowed; keep AA), print view.
9. No tracking on the families page without consent. Analytics default off (REQ-025).
10. Review all families copy with a clinical lead, a social worker, and a parent advisor before launch.

## 11. Brand refresh 2026-11 (owner reference: `docs/design/reference-hero-mobile.jpg`)
The owner chose a calm, airy, Apple-like style. It replaces the teal + clay palette and logo concepts A-C.
- **Logo (concept D, "rising sun"):** thin light-grey ring, three concentric navy arcs (the middle one lighter), one small gold dot on top. Wordmark "ARI-PST": navy, bold, uppercase, letter-spacing 0.12em. Files: `logo-d-rising-sun.svg`, React `Logo` in `packages/design-system`, `apps/public-site/src/components/Logo.astro`. The lock-up never flips in RTL. "ARI-PST × Tech4Cancer" stays in the footer.
- **Palette (light / dark):**

| Token | Light | Dark | Use |
|---|---|---|---|
| primary | #2C4F76 | #9DBCE0 | Headline, wordmark, filled buttons, active toggle, links |
| heading | #2C4F76 | #C9DBEF | h1-h3 |
| text | #1C2B3E | #E8EDF4 | Body |
| text-muted | #5F6672 | #A9B4C3 | Lead, secondary text (reference #6B7280 darkened for margin) |
| eyebrow | #4A6787 | #A9B4C3 | Eyebrow line, inactive segments |
| gold | #E0B84F | #E0B84F | Eyebrow dot, logo dot. Decoration only, never text |
| accent (warm text) | #7F5A0B | #F0C96A | Rare warm text on accent-subtle |
| bg / surface | #FBFCFD / #FFFFFF | #0F1724 / #152033 | Page / cards |
| hero-from | #E9EDF2 | #16233A | Hero band gradient start (to bg) |
| border | #E3E7EC | #2A3A52 | Dividers, pill and card edges |
| border-strong | #7C8696 | #7487A0 | Input edges (3:1) |

- **Contrast (measured in Chromium, 2026-11-14):**

| Pair | Light | Dark |
|---|---|---|
| Display headline on hero-from | 7.18 | 11.13 |
| Eyebrow on hero-from | 4.99 | 7.49 |
| Lead (muted) on hero-from, worst case | 4.92 | 7.49 |
| Lead (muted) on white | 5.78 | 7.78 |
| Primary button text | 8.44 | 8.91 |
| Secondary button text on surface | 8.44 | 8.32 |
| Active language segment | 8.44 | 8.91 |
| Inactive language segment | 5.86 | 7.78 |
| Body text on surface | 14.34 | 13.88 |
| Input border on white (non-text) | 3.68 | 4.44 |

The light-grey border of secondary buttons and pills is 1.24:1. That is allowed: the text names the control (WCAG 1.4.11 does not need a visible button edge). Inputs keep `border-strong`.
