# RB-02 Database restore

## When to use
- Data corruption or data loss.
- A migration damaged data.
- The database is lost.

Severity: Sev1. Targets: RPO 15 minutes within Render PITR, RTO 4 hours (ASSUMPTION-05; the real RPO is UNVERIFIED until drill DR-1 measures it).

## Prerequisites
- Incident commander (IC) has declared Sev1.
- A paid Render database plan with point-in-time recovery (PITR). The free demo has no backups.
- For the offsite dump path: 2 of 3 key holders for the age private key.

## Steps
1. Put the API in maintenance (read-only) mode. Set `DEPLOY_PAUSED=true`.
2. Pick the restore point in UTC, just before the bad event.
3. Restore with Render PITR to a **new** Postgres instance. Never restore in place. If PITR is unusable, use the newest Render logical backup, then the offsite dump.
4. Offsite dump path: the key holders release the age private key. Run `scripts/restore-drill.sh` against the new instance (set `CONFIRM_SCRATCH=yes` and `AUDIT_VERIFY_CMD`). Caution: a plain `pg_restore` as a non-superuser drops function grants. Use the two-pass restore in [`../migration/google-cloud.md`](../migration/google-cloud.md#56-findings-that-need-a-decision) (finding F-5) for any instance that will serve traffic.
5. On the new instance: check the migration level, run the audit-chain verify, compare row counts with the last known counts, test one synthetic sign-in.
6. List what was lost: row counts between the restore point and the event. Counts only, no data in tickets.
7. Point the API and crons at the new instance: change the database resource in `render.yaml` through a pull request (`DB_HOST`, `DB_PORT`, `DB_NAME` and `DATABASE_URL_OWNER` come from `fromDatabase`). In an emergency, change it in the Dashboard with a ticket, then reconcile in Git. Redeploy.
8. Invalidate all sessions. A restore brings back old rows in `authn.sessions`. A database admin sets `revoked_at` on all of them.
9. Lift maintenance mode. Watch for 60 minutes.
10. Privacy lead decides whether this is a breach (RB-03 path, needs legal review).

## Verify
- The audit chain verifies.
- Row counts match the expected values.
- Sign-in works.
- The next backup runs.

## Rollback
Keep the old instance for 7 days. If the new instance is wrong, point the services back to the old instance. After 7 days, delete the old instance and record that.

## Escalation
Executive contact if the data loss exceeds the RPO.
