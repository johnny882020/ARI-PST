# Runbooks

Each runbook uses the same sections: **When to use**, **Prerequisites**, **Steps**, **Verify**, **Rollback**, **Escalation**.

Rules for every runbook:
- Never paste data, identifiers or secrets into tickets or chat. Use counts and ids only.
- Names in angle brackets (`<host>`) are placeholders.
- Render facts marked UNVERIFIED must be checked in the live Dashboard.

| ID | Runbook | Severity |
|---|---|---|
| RB-01 | [Bad deploy or failing health check](RB-01-bad-deploy.md) | Sev2 |
| RB-02 | [Database restore](RB-02-database-restore.md) | Sev1 |
| RB-03 | [Suspected re-identification or data exposure](RB-03-data-exposure.md) | Sev1 |
| RB-04 | [Credential or key compromise](RB-04-credential-compromise.md) | Sev1 or Sev2 |
| RB-05 | [Failed ingestion](RB-05-failed-ingestion.md) | Sev3 |
| RB-06 | [Stale index alert](RB-06-stale-index.md) | Sev3 |
| RB-07 | [Audit-chain break](RB-07-audit-chain-break.md) | Sev1 |
| RB-08 | [Region or platform outage](RB-08-platform-outage.md) | Sev1 if over 1 hour |

Severity levels and the incident process: [`../ops-model.md`](../ops-model.md#on-call-and-incidents).

Tools: `scripts/smoke.sh`, `scripts/backup-export.sh`, `scripts/restore-drill.sh`, the Render Dashboard (deploys, rollback, logs, shell).
On Google Cloud the same runbooks apply with the changes in [`../migration/google-cloud.md`](../migration/google-cloud.md#73-runbooks-mapped-to-gcp).
