# RB-07 Audit-chain break

## When to use
`ari-cron-audit-verify` fails or alerts.

Severity: Sev1.

## Prerequisites
- Render shell access on `ari-api`.
- The signed hourly audit export and the last offsite dump.
- Privacy lead and security lead are reachable.

## Steps
1. Writes that need audit fail closed. Turn off sensitive views if the chain is in doubt.
2. Run the verify job from a Render shell on `ari-api`: `node apps/api/dist/jobs/audit-verify.js`. Note the first bad row. Do not repair in place.
3. Compare with the signed audit export and the last offsite dump. Find rows that were changed, removed or added.
4. Find the cause: a bug (out-of-order concurrent writes), a restore artifact, or tampering. If tampering is possible, start RB-04 and RB-03.
5. If a bug: fix it. Then record a signed "chain re-anchor" event that links the old head to the new segment. Old rows are never erased. This needs Privacy lead and security lead approval.
6. Tell the committee chair that audit continuity has a documented gap.
7. Write a post-mortem (mandatory).

## Verify
- The chain verifies from the anchor.
- No alert for 24 hours.

## Rollback
None. Do not roll back code or data for this signal: it is a data issue.

## Escalation
Privacy lead and security lead at once. Executive contact if tampering is confirmed.
