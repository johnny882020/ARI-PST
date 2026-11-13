# A2 to A7 — requests

1. `render.yaml`: Postgres IP allow list empty; services private where possible; secrets `sync: false`; separate envs; previews synthetic only. Checklist: `plan/02-security-privacy/10-never-in-portal-and-render-hardening.md`, section 3 (verify UNVERIFIED items first).
2. CI jobs: CodeQL/Semgrep, gitleaks, dependency audit, SBOM (CycloneDX), ZAP baseline, TLS scan, schema allow-list diff, architecture test (`09-secure-sdlc.md`).
3. Branch protection, CODEOWNERS for `plan/02-security-privacy/**`, `db/migrations/**`, `packages/domain/privacy/**`; production environment with required reviewers.
4. Cron jobs: nightly aggregate snapshot, hourly audit verify, daily audit anchor, nightly identifier scanner (CAN-04), retention job, staging-file cleanup.
5. Anchor store: separate account/bucket with object lock (EU region). Decide with A1/owner (GATE-BUDGET).
6. Key service decision (ADR-205 in `06-crypto-secrets.md`): external KMS vs Render secret.
7. `security.txt` on the public site (A6 builds).
