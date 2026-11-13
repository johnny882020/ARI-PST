# 08 Runbooks

Format: Trigger, Severity, Owner, Steps, Verify, Escalate. Commands are examples; names are placeholders. Do not paste data into tickets.

## RB-01 Bad deploy or failing health check
Trigger: AL-03, AL-14, AL-15. Sev2.
1. Check D-Release: did error rate jump at a deploy marker?
2. If a deploy is still building: cancel it in Render.
3. Set auto-deploy Off for the service.
4. Roll back to the previous good deploy (Render dashboard).
5. Confirm `/readyz` OK, error rate normal, login probe OK.
6. If a migration ran: do not roll back the schema. Check that old code works on new schema. If not, use feature flag or fix forward (RB-02 only if data is damaged).
7. Open a revert PR. Merge. Re-enable auto-deploy.
8. Post in chat. Start post-mortem if impact over 15 min.
Verify: 30 min of normal SLIs. Escalate: IC if rollback fails or health check fails on the old version too (then suspect DB or Render, go to RB-08).

## RB-02 Database restore (corruption, bad migration, data loss)
Trigger: AL-13, wrong data seen, failed migration with damage. Sev1.
1. IC declares Sev1. Put the API in read-only maintenance mode.
2. Decide the restore point: the time just before the bad event (use deploy marker and the PITR marker note). Write it down in UTC.
3. Restore with Render PITR to a NEW Postgres instance (F4). If PITR is unusable, use the newest Render logical backup, then the offsite dump (DR-2 steps, key holders needed).
4. Run on the new instance: migrations status check, `verify-audit-chain`, row counts against last known counts from D-Data-Health, one synthetic login.
5. Compare what is lost: rows created between restore point and event. List counts only. Plan to ask coordinators to re-enter (no data in tickets).
6. Update `DATABASE_URL` for API, ingest, backup jobs through Blueprint change. Deploy. Invalidate all sessions.
7. Lift maintenance mode. Watch 60 min.
8. Keep the old instance for 7 days for forensics, then delete with a record.
9. Privacy lead decides if the event is a breach (see `07`).
Escalate: executive contact if data loss exceeds RPO.

## RB-03 Suspected re-identification or data exposure
Trigger: user report, AL-19 (identifier in logs), k-anonymity bypass, a researcher shows a small cell, a record shown to the wrong role. Sev1 (Sev2 for a log hit with no external exposure).
1. IC opens Sev1 and notifies the Privacy lead. Start the privacy-breach path in `07`.
2. Contain: disable the affected route or search facet with a feature flag; raise k for the field set (config, GATE-K); suspend the researcher account if involved; stop exports.
3. Preserve evidence: copy relevant audit rows and logs to a locked evidence folder (read-only). Do not delete anything.
4. Scope with the audit log: who viewed what, when, which role. Use aggregate queries by the security lead. `system_admin` must not read sample data (separation of duties): the security lead role runs queries via a reviewed script.
5. If an identifier appears in logs: purge the affected log window at the sink (vendor ticket), fix the redactor, add a test case (R6), and record what was deleted.
6. Assess identifiability with the Privacy lead and A2. Decide on notices.
7. Fix, test, release via the emergency path. Post-mortem.
Escalate: executive contact and legal at once.

## RB-04 Credential or key compromise
Trigger: leaked secret in Git (secret scanner), suspicious admin login, vendor breach notice, lost laptop. Sev1 if production secret or admin account; else Sev2.
1. Identify which secret: DB URL, API signing key, session secret, offsite write key, Render API key, GitHub token, SMTP key, TOTP encryption key.
2. Revoke or rotate at the source first. Then update the vault and Blueprint env. Redeploy.
3. Order of rotation: Render API key and GitHub tokens, DB password, session secret (forces re-login), field-encryption key (re-encrypt TOTP secrets; plan the key versioning in A2), offsite keys.
4. Force logout all sessions. Require MFA re-check for admins.
5. Review the audit log and Render audit/event log for use of the secret since exposure.
6. If the secret was in Git: remove from history is not enough; assume it is public.
7. If the age/GPG private backup key may be exposed: generate a new key pair; re-encrypt or start a new backup chain; old backups stay readable only with the old key held offline.
8. Privacy lead decides if data was reachable (then `07` path).
Verify: old secret fails; health green; no unknown sessions.

## RB-05 Failed ingestion
Trigger: AL-16 (job failed or over 20% rows rejected). Sev3.
1. Look at the ingest run report (counts, reject reason codes; no row values).
2. Reason `schema_mismatch` or `missing_field`: tell the coordinator which field codes failed; they fix the file. Do not hand-edit data in the DB.
3. Reason `forbidden_field` (a column that looks like an identifier, e.g. name, ID number): treat as RB-03 (identifier entered). Quarantine the staged file; delete staged file after privacy lead decision.
4. Reason `job_error`: check logs by `traceId`; rerun after fix. Ingestion is idempotent by `sample_code`; reruns are safe.
5. Confirm record counts changed as expected and `last_verified_at` updated.
6. Tell the coordinator the result in the notification module.
Verify: next scheduled run succeeds.

## RB-06 Stale index alert
Trigger: AL-17 (`index_stale_ratio` over 25%). Sev3 to the coordinator.
1. Open D-Data-Health. Split stale ratio by center (centers are ids, no personal data).
2. Send a reminder to the center's coordinator via notifications (template, role mailbox).
3. If a center is silent 30 days: national coordinator calls the contact role. After 60 days: raise to steering committee; the center's records show a "last verified" label and may be marked `limited` in public counts (policy owner: product, OPEN-A9-06).
4. Check that the ingest job really ran (not a pipeline fault). If a fault, go to RB-05.
5. Record the action. Review at the monthly metrics review.
See `10-operating-model.md` for owners (Doc §11 stale-data risk).

## RB-07 Audit-chain break
Trigger: AL-09, AL-10. Sev1.
1. Stop writes that need audit (they should already fail closed). Keep reads off for sensitive views if the chain is in doubt.
2. Run `verify-audit-chain` to find the first bad row index. Do not repair in place.
3. Compare with the hourly signed audit export and the last offsite dump. This shows if rows were changed, removed, or added.
4. Cause types: bug (code path wrote out of order, e.g. concurrent writes), restore artifact, or tampering. If tampering is possible, start RB-04 and RB-03.
5. If a bug: fix, then record a signed "chain re-anchor" event that links the old head to the new segment. This never erases old rows. Needs approval of the Privacy lead and the security lead.
6. Notify the committee chair that audit continuity has a documented gap.
7. Post-mortem is mandatory.
Verify: chain verifies from the anchor; AL-10 clear for 24 h.

## RB-08 Region or platform outage
Trigger: Render status page incident, AL-01 and AL-02 and AL-15 all firing, Render dashboard unreachable. Sev1 if over 1 h.
1. Confirm via Render status page and an outside check (other service on Render and one not). Rule out our DNS and cert (AL-20).
2. Post on our status page within 15 min. Public site first: if CDN is up, it keeps working.
3. Wait and watch up to 2 h unless data is at risk. Do not deploy, do not restore into a degraded platform.
4. If expected outage time is over 4 h (Render's ETA or none): decide with the executive contact whether to start the cold standby build (DR-4 steps, `03-backup-restore-dr.md`). Cost: data-loss window up to the last offsite dump; this needs executive approval.
5. During outage: no changes to production. Collect a list of lost-window events for later.
6. After recovery: verify DB state, audit chain, backup jobs, and cron heartbeats. Check PITR is active (AL-13).
7. Post-mortem and a vendor claim for service credits if the contract allows.
