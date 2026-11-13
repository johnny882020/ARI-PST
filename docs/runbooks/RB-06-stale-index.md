# RB-06 Stale index alert
Trigger: `index_stale_ratio` over 25% (cron `ari-cron-staleness` result). Severity: Sev3, owner `national_coordinator`.

## Steps
1. Open the freshness page (`/freshness` in the protected app). Split the stale ratio by center (ids only). A dedicated admin data-health page (`/admin/health`) is not built in Phase 1.
2. Send a reminder to the center coordinator (notification template, role mailbox).
3. Center silent 30 days: the national coordinator calls the contact role. At 60 days: raise to the steering committee. Records show a "last verified" label and may be marked `limited` in counts (policy owner: product).
4. Check the cron really ran in Render (Cron, Runs). If it failed, go to RB-05.
5. Record the action. Review at the monthly metrics review.
