# A2 — Security & Privacy (index)

Status: draft v0.1, 2026-11-13. Owner: A2. **Needs legal review** (all compliance statements).
Binding source: `plan/00-contract-pack.md`. All data in examples is synthetic.

| File | Content |
|---|---|
| `01-threat-model.md` | STRIDE per module, data-flow diagrams, trust boundaries |
| `02-reidentification-controls.md` | Aggregate-count privacy: algorithms, budgets, testable properties |
| `03-adr-201-k-anonymity.md` | ADR-201 (GATE-K): k = 5 default |
| `04-two-step-coding-and-clinician.md` | Two-step coding, no link keys, GATE-CLINICIAN-ID resolution |
| `05-identity-access.md` | MFA, sessions, RBAC/ABAC, RLS, break-glass, onboarding |
| `06-crypto-secrets.md` | TLS, at-rest, keys, secret scanning |
| `07-audit-log.md` | Events, hash chain, retention, readers |
| `08-compliance-map.md` | Legal map with sources (verified / UNVERIFIED) |
| `09-secure-sdlc.md` | Gates, dependencies, SBOM, SLAs, pen-test, bug reports |
| `10-never-in-portal-and-render-hardening.md` | Forbidden-data list, enforcing controls, Render hardening |

ADR numbers 201–209 are reserved for A2 (provisional; orchestrator may renumber).

## Security principles
1. The portal holds an index. It never holds identifiers.
2. Deny by default. Every check happens on the server, and again in the database (RLS).
3. External users see aggregates only. Every aggregate passes the suppression engine.
4. No single role can both change data and approve access.
5. Every read of sensitive data is logged. The log is tamper-evident.
6. Controls are code. Each control has a test (see A8 properties).
