# RB-03 Suspected re-identification or data exposure

## When to use
- A user reports exposed data.
- An identifier is found in logs.
- A k-anonymity bypass or a small cell is shown.
- A record is shown to the wrong role.

Severity: Sev1. Sev2 for a log hit with no outside exposure.

## Prerequisites
- Incident commander (IC) and Privacy lead are reachable.
- Access to the audit log through the security lead. `system_admin` must not read sample data.

## Steps
1. IC opens Sev1 and tells the Privacy lead. Start the privacy-breach path (needs legal review).
2. Contain:
   - Turn off the route or facet with a feature flag.
   - Raise `k` for the field set (needs a second approver, C-08).
   - Suspend the researcher account involved.
   - Stop exports.
3. Preserve evidence: copy the relevant audit rows and logs to a locked, read-only folder. Delete nothing.
4. Scope with the audit log: who viewed what, when, with which role. The security lead runs reviewed aggregate queries.
5. If an identifier is in logs: purge that log window at the log sink, fix the redactor, add a test, record what was deleted.
6. Assess identifiability with the Privacy lead. Decide on notices.
7. Fix, test and release by the emergency path.
8. Write a post-mortem.

## Verify
- The exposure cannot be reproduced.
- A redaction scan of the logs is clean.
- Tests cover the cause.

## Rollback
Lift the containment steps (flag, `k`, account suspension, export stop) one at a time, only after the fix is verified. A `k` change back needs a second approver.

## Escalation
Executive contact and legal counsel at once.
