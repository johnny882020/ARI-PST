// Tables in the full export (FK-friendly order). NDJSON: one JSON object per line, ordered by primary key.
// Excluded on purpose: authn.* (credentials, sessions), ops.notification_outbox (e-mail addresses), portal.ctx_secret,
// portal.email_verifications, agg.* (derived: rebuilt by agg.refresh_snapshot()). audit.chain_key only with --include-keys (ops).
export const EXPORT_TABLES = [
  'portal.centers', 'portal.users', 'portal.diagnosis_terms', 'portal.diagnosis_synonyms', 'portal.role_assignments', 'portal.ethics_approvals',
  'portal.samples', 'portal.sample_attached_data', 'portal.workflow_config', 'portal.k_policies', 'portal.committee_config', 'portal.change_requests',
  'portal.researcher_registrations', 'portal.requests', 'portal.request_items', 'portal.request_item_samples', 'portal.request_steps',
  'portal.request_events', 'portal.request_decisions', 'portal.request_votes', 'portal.request_recusals', 'portal.request_agreements',
  'portal.idempotency_keys', 'portal.import_jobs', 'portal.import_job_rows', 'portal.staleness_reminders', 'portal.breakglass_grants',
  'audit.chain_head', 'audit.chain_truncation', 'audit.audit_events',
];
export const KEY_TABLES = ['audit.chain_key'];
