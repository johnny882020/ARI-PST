# ADR-006 — CMS for the public site
Status: Superseded by ADR-011 (`plan/06-frontend/03-adr-cms-choice.md`, canonical-decisions C-17). Content path as built: `apps/public-site/src/content/{pages,news,...}/{he,en}`, not `apps/public-site/content`.
Original status: Proposed. Date: 2026-11-13. Covers: REQ-019, REQ-020, REQ-024.

## Context
Content must be edited by non-technical staff. Git is the source of truth. Site is bilingual.

## Decision
- Astro static site. Content as Markdown/JSON in `apps/public-site/content/{he,en}`.
- Decap CMS (assumed, from pack) at `/admin`, using the Git Gateway or GitHub backend with the `editorial_workflow` (edit creates a PR).
- Editors commit to a branch and open a PR. Preview deploy shows the change. A maintainer merges. CI then deploys.
- The CMS holds no secrets in the browser. OAuth proxy needed for GitHub backend: runs as small Render web service or Netlify-free alternative (A6/A7 choose).
- Content schema validated in CI (A6).

## Consequences
- Full history and rollback by Git. No CMS database.
- Editors need a GitHub account or a proxy login. Onboarding doc needed.
- Fallback if Decap is a poor fit: Tina or Keystatic (same Git model).

## Trade-off
Headless SaaS CMS has nicer UX but adds a processor and breaks Git-as-truth. Git-based CMS has plainer UX but fits the rules.
