# RB-02 Database restore
Trigger: corruption, bad migration with data damage, data loss, lost database. Severity: Sev1.
Targets: RPO 15 min within Render PITR, RTO 4 h (ASSUMPTION-05, real RPO UNVERIFIED until drill DR-1 measures it).

## Steps
1. Incident commander (IC) declares Sev1. Put the API in maintenance (read-only) mode. Pause deploys (`DEPLOY_PAUSED=true`).
2. Pick the restore point in UTC, just before the bad event.
3. Restore with Render point-in-time recovery to a NEW Postgres instance. Never restore in place. If PITR is unusable, use the newest Render logical backup, then the offsite dump (steps below).
4. Offsite dump path: key holders (2 of 3) release the age private key. Run `scripts/restore-drill.sh` against the NEW instance (set `CONFIRM_SCRATCH=yes`, `AUDIT_VERIFY_CMD`). Use real `pg_restore` options as in the script.
5. On the new instance: check migration level, run the audit-chain verify, compare row counts to the last known counts, test one synthetic login.
6. List what was lost: counts of rows between the restore point and the event. Counts only, no data in tickets.
7. Point `DATABASE_URL` at the new instance by changing `render.yaml` (new database resource or connection) through a PR, or temporarily in the Dashboard with a ticket, then reconcile in Git. Redeploy. Invalidate all sessions (rotate `SESSION_SECRET`).
8. Lift maintenance mode. Watch for 60 minutes.
9. Keep the old instance 7 days for forensics, then delete it and record that.
10. Privacy lead decides whether this is a breach (RB-03 path, needs legal review).

## Verify
Audit chain verifies. Counts match. Login works. Backup cron runs next night.

## Escalate
Executive contact if loss exceeds RPO.
