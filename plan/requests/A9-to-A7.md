# A9 to A7 (DevOps / CI-CD)
1. `DEPLOY_PAUSED` repo variable: pipeline stops before the production approval step when true (see `plan/09-sre/05-safe-release.md`).
2. Render Blueprint: health check path `/readyz` for API; cron jobs for offsite backup (02:00 UTC), audit export (hourly), freshness job (daily), audit-chain verify (nightly), heartbeat pings.
3. CI: ban commit text that skips Render deploys on production paths; check preview env vars never point to production DB.
4. Weekly job: Blueprint drift diff vs live Render config.
5. Confirm exact Render auto-deploy option names and rollback behavior (V-05, V-08).
6. Deploy start/end markers to the dashboard (webhook or GitHub Action).
7. Mirror repo to a second Git remote.
