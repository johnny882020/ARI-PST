# RB-08 Region or platform outage

## When to use
- The Render status page shows an incident.
- Public site, app and `/readyz` probes all fail.
- The Render Dashboard is unreachable.

Severity: Sev1 if over 1 hour.

## Prerequisites
- An outside check (a monitor that does not run on Render).
- Access to the status page.

## Steps
1. Confirm on the Render status page and with the outside check. Rule out our DNS and certificates.
2. Post on the status page within 15 minutes. The public site may keep working from the CDN.
3. Wait and watch for up to 2 hours, unless data is at risk. Do not deploy. Do not restore into a degraded platform.
4. If the outage may last over 4 hours: decide with the executive contact whether to build the cold standby (drill DR-4: apply `render.yaml` in another EU region and restore the newest offsite dump). The data-loss window is up to the age of that dump (up to 24 hours). This exceeds the RPO and needs executive approval and legal review for the new region.
5. During the outage, make no production changes. Keep a list of events in the lost window.
6. After recovery: verify the database state, the audit chain, backup jobs and cron runs. Check that PITR is active.
7. Write a post-mortem. Claim service credits if the contract allows.

A single region in Phase 1 is an accepted risk (RISK-A9-01).

## Verify
- `/readyz` is green.
- Crons and backups ran after recovery.

## Rollback
If a cold standby was built, move back to the original region only through a planned change, after Render is stable.

## Escalation
Executive contact if the outage exceeds 4 hours.
