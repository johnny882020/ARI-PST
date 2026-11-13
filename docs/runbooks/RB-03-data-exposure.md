# RB-03 Suspected re-identification or data exposure
Trigger: user report, identifier found in logs, k-anonymity bypass, a small cell shown, a record shown to the wrong role. Severity: Sev1 (Sev2 for a log hit with no outside exposure).

## Steps
1. IC opens Sev1 and tells the Privacy lead. Start the privacy-breach path (needs legal review).
2. Contain: disable the route or facet with a feature flag. Raise `k` for the field set (needs a second approver, C-08). Suspend the involved researcher account. Stop exports.
3. Preserve evidence: copy the relevant audit rows and logs to a locked read-only folder. Delete nothing.
4. Scope with the audit log: who viewed what, when, which role. The security lead runs reviewed aggregate queries. `system_admin` must not read sample data.
5. If an identifier is in logs: purge that log window at the log sink (vendor ticket), fix the redactor, add a test, record what was deleted.
6. Assess identifiability with the Privacy lead. Decide on notices.
7. Fix, test, release by the emergency path. Post-mortem.

## Verify
Cannot reproduce. Redaction scan clean. Tests added.

## Escalate
Executive contact and legal at once.
