# A5 to A6 (Frontend)
1. Use `plan/05-design-brand/tokens.css` as the source for `packages/design-system`. Keep token names.
2. Add stylelint rule for logical properties only. Fail CI on physical properties (exception comment `/* physical: reason */`).
3. Self-host Heebo, Rubik (WOFF2, Hebrew+Latin subset). No Google Fonts CDN at runtime. Confirm OFL license files.
4. Implement `<bdi>` helper for user data and a `he-XB` pseudo-locale (see `03-rtl-bidi.md` §4).
5. Implement the count-tile component with states: value, suppressed, merged, loading, error (`02-design-system.md` §7.8).
6. Add axe + contrast-token tests (see `04-accessibility.md` §3).
7. Mockups in `mockups/` show intended layout only. They are not production code.
