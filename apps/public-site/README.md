# @ari/public-site

Public site of the ARI-PST Portal (Astro, static). Hebrew and English. Content is in Git and is edited with Decap CMS at `/admin`. The site has no data path to the index; its forms post to `/api/v1/public/forms/*` without credentials.

## Scripts

| Command | What it does |
|---|---|
| `pnpm --filter @ari/public-site dev` | Starts the dev server (<http://localhost:4321>) |
| `pnpm --filter @ari/public-site build` | Builds `dist/` |
| `pnpm --filter @ari/public-site preview` | Serves the built site |
| `pnpm --filter @ari/public-site test` | All tests |
| `pnpm --filter @ari/public-site test:unit` | Unit tests |
| `pnpm --filter @ari/public-site test:build` | Checks on the built output |
| `pnpm --filter @ari/public-site test:a11y` | axe on the built pages, he and en |
| `pnpm --filter @ari/public-site typecheck` | `astro check` |
| `pnpm --filter @ari/public-site lhci` | Lighthouse CI (not run in CI) |
| `pnpm --filter @ari/public-site gen:cms-config` | Generates the Decap CMS configuration |
| `pnpm --filter @ari/public-site check:content-only` | Fails if a change touches files outside `src/content/` |

`dev` and `build` first copy Decap CMS into `public/` (`scripts/vendor-decap.mjs`).

## Key files

| Path | Content |
|---|---|
| `src/content/` | Pages, news, partners, people, legal pages (he and en). The only folder editors may change |
| `src/pages/` | Routes per locale |
| `src/layouts/`, `src/components/` | Page layout and components |
| `CMS-SECURITY.md` | How editor changes are limited to `src/content/` |

Legal pages are drafts and need legal review. Hebrew copy needs a Hebrew editor.
