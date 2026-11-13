# ADR-009 — Event and audit approach
Status: Proposed. Date: 2026-11-13. Covers: REQ-036, REQ-046, REQ-066.

## Context
Need a full audit of views, downloads, approvals. Need request history visible to applicant. Need metrics events. Team is small.

## Decision
- Two separate things:
  1. Audit log: append-only table `audit_events` via `AuditPort`, written in the same transaction as the action (no lost events).
  2. Request history: `request_steps` owned by `access-requests`, shown to applicant.
- Audit event fields: `id`, `ts` (UTC), `actor_id`, `actor_role`, `action`, `resource_type`, `resource_id`, `center_id`, `outcome`, `trace_id`, `prev_hash`, `hash`. No identifiers, no free text.
- Reads of sample records and every export are audited (not only writes).
- DB role for audit has INSERT only. Hash chain gives tamper evidence. Daily chain check by cron. Copy to object store (WORM-like retention if available; UNVERIFIED).
- In-process domain events (simple typed dispatcher) for decoupling. Outbox table for email. No message broker in Phase 1.
- Metrics for REQ-066 are derived from tables and audit, via SQL views.

## Consequences
- Strong, simple, transactional.
- Audit table grows fast. Partition by month. Retention policy by A2.
- A broker can be added later behind the same port.

## Trade-off
Full event sourcing would give perfect history but costs complexity. A transactional audit table plus normal tables is enough here.
