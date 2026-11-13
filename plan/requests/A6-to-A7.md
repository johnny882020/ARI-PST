# A6 to A7 (DevOps / CI-CD)

1. Render headers for site and app (CSP etc.) from `plan/06-frontend/04-protected-app-security.md` section 2. Separate `/admin/*` header set for Decap on the site.
2. Small stateless GitHub OAuth proxy for Decap CMS (ADR-A6-001). Needs a GitHub OAuth app and secrets.
3. CI jobs and required checks listed in `plan/06-frontend/05-budgets-and-ci.md` section 5. LHCI config JSON is in that file.
4. CODEOWNERS for `content/**` and `content/legal/**`, `content/patients/**`; check `content-only-diff` for `cms/*` branches.
5. Self-hosted analytics (Umami or Plausible CE) service plus separate Postgres, optional (flag).
6. Generated-file drift checks (`gen:api`, `gen:schemas`, `gen:cms-config`). `oasdiff` job.
7. Preview builds are `noindex`.
