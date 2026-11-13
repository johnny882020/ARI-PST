# @ari/i18n
Flat ICU catalogs: `messages/he.json` (default, RTL) and `messages/en.json`. Key shape `area.screen.element`.
`pnpm --filter @ari/i18n lint` checks equal key sets, key shape and no raw HTML. `test` parses every message as ICU.
Hebrew text is a DRAFT. A native Hebrew editor must review it before launch (see `meta.catalog.reviewStatus`).
