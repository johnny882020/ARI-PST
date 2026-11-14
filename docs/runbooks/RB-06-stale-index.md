# RB-06 Stale index alert

## When to use
`index_stale_ratio` is over 25% (result of the cron `ari-cron-staleness`).

Severity: Sev3. Owner: `national_coordinator`.

## Prerequisites
- `national_coordinator` access to the freshness page (`/freshness` in the protected app).

## Steps
1. Open `/freshness`. Split the stale ratio by center (ids only).
2. Send a reminder to the center coordinator (notification template, role mailbox).
3. Center silent for 30 days: the national coordinator calls the contact role. At 60 days: raise it to the steering committee. Records show a "last verified" label.
4. Check that the cron really ran (Render, the cron, Runs). If it failed, go to RB-05.
5. Record the action. Review it at the monthly metrics review.

## Verify
The stale ratio is under 25% on the next staleness run.

## Rollback
Not applicable.

## Escalation
Steering committee after 60 days without an answer.
