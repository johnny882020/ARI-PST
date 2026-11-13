# RB-07 Audit-chain break
Trigger: `ari-cron-audit-verify` fails or alerts. Severity: Sev1.

## Steps
1. Stop writes that need audit (they fail closed). Turn off sensitive views if the chain is in doubt.
2. Run the verify job (`node apps/api/dist/jobs/audit-verify.js`, from a Render shell on `ari-api`) to find the first bad row index. Do not repair in place.
3. Compare with the signed hourly audit export and the last offsite dump. This shows rows changed, removed or added.
4. Cause: bug (out-of-order concurrent writes), restore artifact, or tampering. If tampering is possible, start RB-04 and RB-03.
5. If a bug: fix, then record a signed "chain re-anchor" event that links the old head to the new segment. Old rows are never erased. Needs Privacy lead and security lead approval.
6. Tell the committee chair that audit continuity has a documented gap.
7. A post-mortem is mandatory. No auto rollback for this signal (it is a data issue).

## Verify
Chain verifies from the anchor. No alert for 24 hours.
