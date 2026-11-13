# Runbooks
Format: Trigger, Severity, Steps, Verify, Escalate. Never paste data into tickets. Names such as service ids are placeholders.

| ID | Runbook |
|---|---|
| RB-01 | [Bad deploy or failing health check](RB-01-bad-deploy.md) |
| RB-02 | [Database restore](RB-02-database-restore.md) |
| RB-03 | [Suspected re-identification or data exposure](RB-03-data-exposure.md) |
| RB-04 | [Credential or key compromise](RB-04-credential-compromise.md) |
| RB-05 | [Failed ingestion](RB-05-failed-ingestion.md) |
| RB-06 | [Stale index alert](RB-06-stale-index.md) |
| RB-07 | [Audit-chain break](RB-07-audit-chain-break.md) |
| RB-08 | [Region or platform outage](RB-08-platform-outage.md) |

Tools: `scripts/smoke.sh`, `scripts/backup-export.sh`, `scripts/restore-drill.sh`. Render Dashboard for deploys, rollback, logs, shell. Render facts marked UNVERIFIED must be checked live.
