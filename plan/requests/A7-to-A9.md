# A7 to A9

- Own SLO alert thresholds used for auto-rollback (5xx 2%, p95 2x).
- Own restore-test runbook and monthly drill; PITR needs vs RPO 15 min.
- Own rollback runbook (Render rollback, re-enable autodeploy).
- Need alert webhook for ari-cron-audit-verify and staleness job.
