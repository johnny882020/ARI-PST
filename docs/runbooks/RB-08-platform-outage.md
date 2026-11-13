# RB-08 Region or platform outage
Trigger: Render status page incident, public site, app and `/readyz` probes all failing, Render Dashboard unreachable. Severity: Sev1 if over 1 hour.

## Steps
1. Confirm on the Render status page and with an outside check. Rule out our DNS and certificates.
2. Post on the status page within 15 minutes. The public site may keep working from the CDN.
3. Wait and watch up to 2 hours unless data is at risk. Do not deploy. Do not restore into a degraded platform.
4. If the expected outage is over 4 hours: decide with the executive contact whether to build the cold standby (drill DR-4: apply `render.yaml` in another EU region, restore the newest offsite dump). The data-loss window is up to the age of that dump (up to 24 hours). This exceeds RPO 15 min and needs executive approval and legal review for the new region.
5. During the outage make no production changes. Keep a list of lost-window events.
6. After recovery: verify DB state, audit chain, backup jobs and cron runs. Check PITR is active.
7. Post-mortem. Claim service credits if the contract allows.

Single region in Phase 1 is an accepted risk (RISK-A9-01). Say so to the owner.
