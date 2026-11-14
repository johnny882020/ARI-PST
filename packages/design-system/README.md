# @ari/design-system

React 18 + TypeScript + plain CSS. Logical CSS properties only. Hebrew (RTL) and English (LTR). Light and dark. Source of tokens: `plan/05-design-brand/tokens.css`.

Export names below are stable. Add new ones; do not rename.

## Install and use (workspace)

```jsonc
// apps/web/package.json
{ "dependencies": { "@ari/design-system": "workspace:*" } }
```

```tsx
import "@ari/design-system/styles.css";          // tokens + base + components (one file)
import { DesignSystemProvider, Button, Field, Input } from "@ari/design-system";

<DesignSystemProvider locale="he" syncDocument>   {/* sets <html lang dir> */}
  <Input label="שם משתמש" help="…" error={err} required />
  <Button variant="primary" loading={pending}>שליחת בקשה</Button>
</DesignSystemProvider>
```

The package ships TypeScript source (`src/index.ts`). Vite compiles it. No build step is needed for `apps/web`.

Other CSS entry points: `@ari/design-system/tokens.css` (tokens only, for Astro or the public site), `@ari/design-system/fonts.css` (self-host font-face, opt-in).

Components carry built-in he/en default strings (close, next, "Too few to show", and so on). Override per key with `<DesignSystemProvider messages={{ he: {...}, en: {...} }}>`. Apps may pass their own i18n strings through props instead.

## Exports

### Provider, theme, bidi
| Export | Notes |
|---|---|
| `DesignSystemProvider` | props `locale: "he" \| "en"`, `messages?`, `syncDocument?`. Sets `lang` and `dir` on a `display: contents` wrapper. |
| `useDesignSystem()` | `{ locale, dir, t(key, vars?) }` |
| `defaultMessages`, `type Locale`, `type MessageKey` | built-in strings |
| `Bdi` | `<bdi>` isolate for Latin terms inside Hebrew. Props: `dir?` (default `auto`). |
| `Ltr` | isolated LTR run for codes, ISO dates, numbers, `sample_code`, e-mail, URLs. |
| `useTheme()`, `applyTheme(theme)`, `type Theme` | `"light" \| "dark" \| "system"`; persists with try/catch `localStorage`. |
| `VisuallyHidden`, `Spinner`, `Icon` | helpers. `Icon` names: `check x info alert search sun moon globe lock chevron-start chevron-end arrow-up arrow-down sort filter menu copy`. Direction icons mirror in RTL. |

### Forms
`Field` (label, help, error, required; render-prop gives `id`, `aria-describedby`, `aria-invalid`) · `Input` · `Textarea` · `Select` · `Checkbox` · `RadioGroup` + `Radio` · `Switch` · `SearchBox` · `FacetFilter`.
`Input`, `Textarea`, `Select` accept `label`, `help`, `error`, `required` and wrap themselves in `Field`.

### Actions
`Button` (`variant: primary|secondary|quiet|danger`, `loading`, `iconStart`, `iconEnd`, `size`) · `IconButton` (`label` required, adds tooltip) · `Chip` (optional `onRemove`) · `LanguageSwitch` · `ThemeToggle`.

### Display
`Card` · `Badge` (`tone`) · `StatusPill` (`status`: `done|current|waiting-you|waiting-others|returned|rejected|upcoming`) · `Alert` (`tone`, `onDismiss`) · `Skeleton` · `EmptyState` · `ErrorState` (`traceId`, `onRetry`) · `AggregateCountTile` · `SuppressionNotice` · `SuppressedCell`.

### Structure and navigation
`AppShell` (skip link, header, inline-start nav, main, footer; phone nav toggle) · `Nav` (prop `renderLink={(item, props) => <Link to={item.href} {...props} />}` plugs in a router link; `AppShell` takes the same prop) · `Tabs` · `Table` (sortable; loading, empty, error) · `Pagination` (cursor: previous/next only) · `Stepper` + `REQUEST_STEP_IDS` + `buildRequestSteps()` + `useRequestSteps()` (8 steps, REQ-034 / canonical-decisions §2).

### Overlays and consent
`Dialog` · `SessionTimeoutDialog` · `ToastProvider` + `useToast()` · `Tooltip` · `ConsentBanner`.

## Rules that components enforce

- `AggregateCountTile` never prints a threshold or `<k`. In the `suppressed` state the `value` prop is ignored. Text is "Too few to show" with a neutral tone (never red). Screen readers hear "Count not shown, to protect privacy".
- `FacetFilter` options with `count: null` show "—" and the same screen-reader text.
- All targets are at least 44 px. Focus is always visible. Reduced motion and forced colors are handled in `tokens.css`.
- Colors come from semantic tokens only. CSS uses logical properties only. `src/__tests__/css-logical.test.ts` fails the build on `margin-left`, `padding-right`, `left:`, `right:`, `text-align: left|right`, `float`, and similar. A deliberate exception needs a `/* physical: reason */` comment on the same line.

## Stepper mapping

`REQUEST_STEP_IDS = ["cart","submission","precheck","committee","coordination","agreements","delivery","closed"]`.
`useRequestSteps({ current, status?, dates?, descriptions?, labels? })` uses the built-in he/en step labels. `buildRequestSteps({ labels, current, ... })` is the non-hook form. Both return `Stepper` steps: earlier steps `done`, the current one `current` (or `status` override such as `waiting-you`, `returned`, `rejected`), later ones `upcoming`. `apps/web` maps the API request status to a `current` id.

## Fonts

Stacks fall back to system fonts, so nothing loads from a CDN. To self-host Heebo and Rubik (SIL OFL 1.1, believed; confirm and keep the license files), follow `fonts/README.md`. License is UNVERIFIED. No font files are bundled yet.

## Scripts

`pnpm --filter @ari/design-system test | typecheck | gallery:dev | gallery:build`

The gallery (`gallery/`) shows every component in he and en, light and dark (toolbar toggles).

## Types exported
`Locale`, `MessageKey`, `Theme`, `IconName`, `ButtonProps`, `InputProps`, `TableColumn<T>`, `TableProps<T>`, `StepperStep`, `StatusKind`, `RequestStepId`, `NavItem`, `FacetOption`, `AggregateCountState`, and a `*Props` type per component.

## Known gaps
No combobox/type-ahead (SearchBox has no suggestion list yet), no table row selection, no Breadcrumb/Progress/Sheet/DropZone. Native `<select>` is used for Select. Fonts are not bundled. Contrast is checked in Chromium by the QA scripts (`docs/qa/scripts`), not by jsdom axe.
