# A8 to A7 — CI jobs
Implement the required checks listed in `plan/08-vnv/05-traceability-dod.md` section 7, and the stage order in `01-test-strategy.md` section 13.
Needs: Postgres service container in CI; Playwright with chromium+webkit; nightly schedule for DAST/k6/privacy-full/resilience; evidence upload to the evidence bucket with SHA-256 index; preview environments seeded with synthetic data only and a check that fails if the synthetic marker is missing.
