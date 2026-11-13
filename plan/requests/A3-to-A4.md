# A3 to A4 (Product and Workflow)
1. Cart items hold **search criteria**, not sample ids. The coordinator resolves them to samples at pre-check (`request_item_samples`). Please reflect this in the flow and user stories.
2. Request statuses and step keys are in `sql/001_core.sql` (enums `request_status`, `step_key`). Please confirm they match your workflow. Decision rule is N-of-M from `committee_config` (ASSUMPTION-04). Criteria are data (`criteria_json`).
3. Applicants see steps and `public_note`. They do not see `internal_note` or the rationale (decision rationale is hidden from applicants by column grant). Decide whether applicants should see the rationale.
4. Staleness: SLA default 180 days, warn 30. Decide the escalation (OPEN-A3-03): hide from aggregates after SLA + N days or only flag.
5. Expired ethics approval: proposed rule is that the coordinator pre-check must resolve it before committee review.
6. Clinician value screen (REQ-068) content is in `05-ingestion.md` section 5. Please turn it into stories. A "flag this record" action is a suggestion.
7. Multiple ethics approvals per sample: Phase 1 stores one (OPEN-A3-04).
