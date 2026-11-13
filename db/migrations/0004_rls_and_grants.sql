-- 0004 grants + FORCE RLS. kind: expand
-- Model: ONE runtime login (app_runtime, no SET ROLE). Access depends on the signed session context (portal.cur_role()).
-- Table owner app_migrator has FORCE RLS and NO policy: it cannot read data. app_core/app_agg (definer owners) have explicit policies.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['centers','users','role_assignments','diagnosis_terms','diagnosis_synonyms','ethics_approvals','samples',
    'sample_attached_data','workflow_config','k_policies','committee_config','change_requests','email_verifications',
    'researcher_registrations','requests','request_items','request_item_samples','request_steps','request_events','request_decisions',
    'request_votes','request_recusals','request_agreements','idempotency_keys','import_jobs','import_job_rows','staleness_reminders',
    'ctx_secret','breakglass_grants'] LOOP
    EXECUTE format('ALTER TABLE portal.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE portal.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY core_all ON portal.%I FOR ALL TO app_core USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA portal FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA portal TO app_core;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA portal TO app_core;
GRANT SELECT ON portal.samples, portal.diagnosis_terms, portal.k_policies TO app_agg;
CREATE POLICY agg_read ON portal.samples FOR SELECT TO app_agg USING (deleted_at IS NULL);

-- reference data: readable in any non-anonymous context? vocabulary and centers are public facts -> any context
GRANT SELECT ON portal.centers, portal.diagnosis_terms, portal.diagnosis_synonyms, portal.workflow_config, portal.k_policies,
  portal.committee_config TO app_runtime;
CREATE POLICY ref_read ON portal.centers FOR SELECT TO app_runtime USING (true);
CREATE POLICY ref_read ON portal.diagnosis_terms FOR SELECT TO app_runtime USING (true);
CREATE POLICY ref_read ON portal.diagnosis_synonyms FOR SELECT TO app_runtime USING (true);
CREATE POLICY ref_read ON portal.workflow_config FOR SELECT TO app_runtime USING (portal.cur_role() IS NOT NULL AND portal.cur_role() <> 'anonymous');
-- k and committee settings: not visible to external roles (RT-28)
CREATE POLICY ref_read ON portal.k_policies FOR SELECT TO app_runtime USING (portal.cur_role() IN ('system_admin','committee_member','national_coordinator'));
CREATE POLICY ref_read ON portal.committee_config FOR SELECT TO app_runtime USING (portal.cur_role() IN ('system_admin','committee_member','national_coordinator'));
GRANT INSERT, UPDATE ON portal.centers TO app_runtime;
CREATE POLICY centers_admin_w ON portal.centers FOR INSERT TO app_runtime WITH CHECK ((SELECT portal.cur_role()) = 'system_admin');
CREATE POLICY centers_admin_u ON portal.centers FOR UPDATE TO app_runtime USING ((SELECT portal.cur_role()) = 'system_admin') WITH CHECK ((SELECT portal.cur_role()) = 'system_admin');
GRANT INSERT, UPDATE ON portal.diagnosis_terms, portal.diagnosis_synonyms TO app_runtime;
GRANT USAGE ON SEQUENCE portal.diagnosis_synonyms_id_seq TO app_runtime;
CREATE POLICY dx_coord_w ON portal.diagnosis_terms FOR INSERT TO app_runtime WITH CHECK ((SELECT portal.cur_role()) = 'national_coordinator');
CREATE POLICY dx_coord_u ON portal.diagnosis_terms FOR UPDATE TO app_runtime USING ((SELECT portal.cur_role()) = 'national_coordinator') WITH CHECK ((SELECT portal.cur_role()) = 'national_coordinator');
CREATE POLICY dxs_coord_w ON portal.diagnosis_synonyms FOR INSERT TO app_runtime WITH CHECK ((SELECT portal.cur_role()) = 'national_coordinator');
CREATE POLICY dxs_coord_u ON portal.diagnosis_synonyms FOR UPDATE TO app_runtime USING ((SELECT portal.cur_role()) = 'national_coordinator') WITH CHECK ((SELECT portal.cur_role()) = 'national_coordinator');

-- samples: NO policy for external roles, committee, admin => zero rows, writes denied. donor_ref has no SELECT grant (nobody reads it).
GRANT SELECT (id, source_center_id, diagnosis_code, age_band_at_diagnosis, sex, sample_type, availability, quantity_class, clinical_timepoint,
  collection_month, attached_data, consent_status, ethics_approval_id, contact_ref, source_system, is_synthetic, created_by, created_at,
  updated_at, last_verified_at, deleted_at) ON portal.samples TO app_runtime;
GRANT INSERT (id, donor_ref, source_center_id, diagnosis_code, age_band_at_diagnosis, sex, sample_type, availability, quantity_class,
  clinical_timepoint, collection_month, consent_status, ethics_approval_id, contact_ref, source_system, created_by, last_verified_at) ON portal.samples TO app_runtime;
GRANT UPDATE (diagnosis_code, age_band_at_diagnosis, sex, sample_type, availability, quantity_class, clinical_timepoint, collection_month,
  consent_status, ethics_approval_id, contact_ref, last_verified_at, deleted_at) ON portal.samples TO app_runtime;
CREATE POLICY samples_clinician_r ON portal.samples FOR SELECT TO app_runtime
  USING ((SELECT portal.cur_role()) = 'center_clinician' AND source_center_id = (SELECT portal.cur_center_id()) AND deleted_at IS NULL);
CREATE POLICY samples_coord_r ON portal.samples FOR SELECT TO app_runtime USING ((SELECT portal.cur_role()) = 'national_coordinator');
CREATE POLICY samples_coord_i ON portal.samples FOR INSERT TO app_runtime WITH CHECK ((SELECT portal.cur_role()) = 'national_coordinator');
CREATE POLICY samples_coord_u ON portal.samples FOR UPDATE TO app_runtime USING ((SELECT portal.cur_role()) = 'national_coordinator') WITH CHECK ((SELECT portal.cur_role()) = 'national_coordinator');
GRANT SELECT, INSERT, UPDATE, DELETE ON portal.sample_attached_data TO app_runtime;
CREATE POLICY att_clinician_r ON portal.sample_attached_data FOR SELECT TO app_runtime
  USING ((SELECT portal.cur_role()) = 'center_clinician' AND EXISTS (SELECT 1 FROM portal.samples s WHERE s.id = sample_id AND s.source_center_id = (SELECT portal.cur_center_id()) AND s.deleted_at IS NULL));
CREATE POLICY att_coord ON portal.sample_attached_data FOR ALL TO app_runtime USING ((SELECT portal.cur_role()) = 'national_coordinator') WITH CHECK ((SELECT portal.cur_role()) = 'national_coordinator');
CREATE VIEW portal.v_samples WITH (security_invoker = true) AS
  SELECT id, source_center_id, diagnosis_code, age_band_at_diagnosis, sex, sample_type, availability, quantity_class, clinical_timepoint,
         collection_month, attached_data, consent_status, ethics_approval_id, contact_ref, source_system, is_synthetic, created_at, updated_at,
         last_verified_at, deleted_at FROM portal.samples;
GRANT SELECT ON portal.v_samples TO app_runtime;

GRANT SELECT ON portal.ethics_approvals TO app_runtime; GRANT INSERT, UPDATE ON portal.ethics_approvals TO app_runtime;
CREATE POLICY eth_clin_r ON portal.ethics_approvals FOR SELECT TO app_runtime USING ((SELECT portal.cur_role()) = 'center_clinician' AND center_id = (SELECT portal.cur_center_id()));
CREATE POLICY eth_coord ON portal.ethics_approvals FOR ALL TO app_runtime USING ((SELECT portal.cur_role()) = 'national_coordinator') WITH CHECK ((SELECT portal.cur_role()) = 'national_coordinator');

-- users / roles: read only. All writes go through definer functions (0005).
GRANT SELECT ON portal.users, portal.role_assignments, portal.researcher_registrations, portal.change_requests, portal.breakglass_grants TO app_runtime;
CREATE POLICY users_self ON portal.users FOR SELECT TO app_runtime USING (id = (SELECT portal.cur_user_id()));
CREATE POLICY users_staff ON portal.users FOR SELECT TO app_runtime USING ((SELECT portal.cur_role()) IN ('national_coordinator','system_admin'));
CREATE POLICY roles_self ON portal.role_assignments FOR SELECT TO app_runtime USING (user_id = (SELECT portal.cur_user_id()));
CREATE POLICY roles_staff ON portal.role_assignments FOR SELECT TO app_runtime USING ((SELECT portal.cur_role()) IN ('national_coordinator','system_admin'));
CREATE POLICY reg_staff ON portal.researcher_registrations FOR SELECT TO app_runtime USING ((SELECT portal.cur_role()) IN ('national_coordinator','system_admin'));
CREATE POLICY chg_staff ON portal.change_requests FOR SELECT TO app_runtime USING ((SELECT portal.cur_role()) IN ('system_admin','committee_member','national_coordinator'));
CREATE POLICY bg_staff ON portal.breakglass_grants FOR SELECT TO app_runtime USING ((SELECT portal.cur_role()) IN ('system_admin','committee_member','national_coordinator'));

-- requests. Status and all governance columns are NOT writable by the runtime (column grants + guard trigger in 0006).
GRANT SELECT ON portal.requests, portal.request_items, portal.request_item_samples, portal.request_steps, portal.request_events,
  portal.request_decisions, portal.request_votes, portal.request_recusals, portal.request_agreements TO app_runtime;
GRANT UPDATE (research_question, applicant_ethics_ref, planned_use, funding_sources) ON portal.requests TO app_runtime;
GRANT INSERT, UPDATE, DELETE ON portal.request_items TO app_runtime;
GRANT INSERT, DELETE ON portal.request_item_samples TO app_runtime;
GRANT USAGE ON SEQUENCE portal.request_item_samples_id_seq TO app_runtime;
CREATE POLICY req_owner_r ON portal.requests FOR SELECT TO app_runtime USING (applicant_user_id = (SELECT portal.cur_user_id()) AND (SELECT portal.cur_role()) IN ('researcher_il'));
CREATE POLICY req_owner_u ON portal.requests FOR UPDATE TO app_runtime
  USING (applicant_user_id = (SELECT portal.cur_user_id()) AND (SELECT portal.cur_role()) = 'researcher_il' AND status IN ('draft','needs_info'))
  WITH CHECK (applicant_user_id = (SELECT portal.cur_user_id()));
CREATE POLICY req_coord_r ON portal.requests FOR SELECT TO app_runtime USING ((SELECT portal.cur_role()) = 'national_coordinator' AND status <> 'draft');
CREATE POLICY req_committee_r ON portal.requests FOR SELECT TO app_runtime USING ((SELECT portal.cur_role()) = 'committee_member' AND reached_committee);
-- RT-20 fix: the subquery column is qualified (requests.id), not the step's own id
CREATE POLICY req_clinician_r ON portal.requests FOR SELECT TO app_runtime
  USING ((SELECT portal.cur_role()) = 'center_clinician' AND EXISTS (SELECT 1 FROM portal.request_steps st
         WHERE st.request_id = requests.id AND st.center_id = (SELECT portal.cur_center_id())));

CREATE POLICY ritem_owner_r ON portal.request_items FOR SELECT TO app_runtime
  USING ((SELECT portal.cur_role()) = 'researcher_il' AND EXISTS (SELECT 1 FROM portal.requests r WHERE r.id = request_items.request_id AND r.applicant_user_id = (SELECT portal.cur_user_id())));
CREATE POLICY ritem_owner_w ON portal.request_items FOR INSERT TO app_runtime
  WITH CHECK ((SELECT portal.cur_role()) = 'researcher_il' AND EXISTS (SELECT 1 FROM portal.requests r WHERE r.id = request_items.request_id AND r.applicant_user_id = (SELECT portal.cur_user_id()) AND r.status = 'draft'));
CREATE POLICY ritem_owner_u ON portal.request_items FOR UPDATE TO app_runtime
  USING ((SELECT portal.cur_role()) = 'researcher_il' AND EXISTS (SELECT 1 FROM portal.requests r WHERE r.id = request_items.request_id AND r.applicant_user_id = (SELECT portal.cur_user_id()) AND r.status = 'draft'))
  WITH CHECK (EXISTS (SELECT 1 FROM portal.requests r WHERE r.id = request_items.request_id AND r.applicant_user_id = (SELECT portal.cur_user_id()) AND r.status = 'draft'));
CREATE POLICY ritem_owner_d ON portal.request_items FOR DELETE TO app_runtime
  USING ((SELECT portal.cur_role()) = 'researcher_il' AND EXISTS (SELECT 1 FROM portal.requests r WHERE r.id = request_items.request_id AND r.applicant_user_id = (SELECT portal.cur_user_id()) AND r.status = 'draft'));
CREATE POLICY ritem_coord_r ON portal.request_items FOR SELECT TO app_runtime USING ((SELECT portal.cur_role()) = 'national_coordinator' AND EXISTS (SELECT 1 FROM portal.requests r WHERE r.id = request_items.request_id AND r.status <> 'draft'));
CREATE POLICY ritem_committee_r ON portal.request_items FOR SELECT TO app_runtime USING ((SELECT portal.cur_role()) = 'committee_member' AND EXISTS (SELECT 1 FROM portal.requests r WHERE r.id = request_items.request_id AND r.reached_committee));
CREATE POLICY ritem_clin_r ON portal.request_items FOR SELECT TO app_runtime
  USING ((SELECT portal.cur_role()) = 'center_clinician' AND EXISTS (SELECT 1 FROM portal.request_steps st WHERE st.request_id = request_items.request_id AND st.center_id = (SELECT portal.cur_center_id())));

CREATE POLICY ris_coord_r ON portal.request_item_samples FOR SELECT TO app_runtime USING ((SELECT portal.cur_role()) = 'national_coordinator');
CREATE POLICY ris_coord_i ON portal.request_item_samples FOR INSERT TO app_runtime
  WITH CHECK ((SELECT portal.cur_role()) = 'national_coordinator' AND EXISTS (SELECT 1 FROM portal.request_items i JOIN portal.requests r ON r.id = i.request_id
     WHERE i.id = request_item_samples.request_item_id AND r.status IN ('approved','center_coordination')));
CREATE POLICY ris_coord_d ON portal.request_item_samples FOR DELETE TO app_runtime
  USING ((SELECT portal.cur_role()) = 'national_coordinator' AND EXISTS (SELECT 1 FROM portal.request_items i JOIN portal.requests r ON r.id = i.request_id
     WHERE i.id = request_item_samples.request_item_id AND r.status IN ('approved','center_coordination')));

CREATE POLICY step_staff_r ON portal.request_steps FOR SELECT TO app_runtime USING ((SELECT portal.cur_role()) IN ('national_coordinator','committee_member'));
CREATE POLICY step_clin_r ON portal.request_steps FOR SELECT TO app_runtime USING ((SELECT portal.cur_role()) = 'center_clinician' AND center_id = (SELECT portal.cur_center_id()));
CREATE POLICY evt_staff_r ON portal.request_events FOR SELECT TO app_runtime USING ((SELECT portal.cur_role()) IN ('national_coordinator','committee_member'));
CREATE POLICY evt_owner_r ON portal.request_events FOR SELECT TO app_runtime
  USING ((SELECT portal.cur_role()) = 'researcher_il' AND EXISTS (SELECT 1 FROM portal.requests r WHERE r.id = request_events.request_id AND r.applicant_user_id = (SELECT portal.cur_user_id())));
CREATE POLICY dec_staff_r ON portal.request_decisions FOR SELECT TO app_runtime USING ((SELECT portal.cur_role()) IN ('national_coordinator','committee_member'));
CREATE POLICY dec_owner_r ON portal.request_decisions FOR SELECT TO app_runtime
  USING ((SELECT portal.cur_role()) = 'researcher_il' AND EXISTS (SELECT 1 FROM portal.requests r WHERE r.id = request_decisions.request_id AND r.applicant_user_id = (SELECT portal.cur_user_id())));
CREATE POLICY vote_staff_r ON portal.request_votes FOR SELECT TO app_runtime USING ((SELECT portal.cur_role()) IN ('national_coordinator','committee_member'));
CREATE POLICY rec_committee_r ON portal.request_recusals FOR SELECT TO app_runtime USING ((SELECT portal.cur_role()) = 'committee_member' AND user_id = (SELECT portal.cur_user_id()));
CREATE POLICY agr_staff_r ON portal.request_agreements FOR SELECT TO app_runtime USING ((SELECT portal.cur_role()) IN ('national_coordinator','committee_member'));
CREATE POLICY agr_clin_r ON portal.request_agreements FOR SELECT TO app_runtime USING ((SELECT portal.cur_role()) = 'center_clinician' AND center_id = (SELECT portal.cur_center_id()));

GRANT SELECT, INSERT, UPDATE ON portal.idempotency_keys TO app_runtime;
CREATE POLICY idem_owner ON portal.idempotency_keys FOR ALL TO app_runtime USING (user_id = (SELECT portal.cur_user_id())) WITH CHECK (user_id = (SELECT portal.cur_user_id()));
GRANT SELECT, INSERT, UPDATE ON portal.import_jobs, portal.import_job_rows TO app_runtime;
CREATE POLICY imp_coord ON portal.import_jobs FOR ALL TO app_runtime USING ((SELECT portal.cur_role()) = 'national_coordinator') WITH CHECK ((SELECT portal.cur_role()) = 'national_coordinator' AND created_by = (SELECT portal.cur_user_id()));
CREATE POLICY impr_coord ON portal.import_job_rows FOR ALL TO app_runtime USING ((SELECT portal.cur_role()) = 'national_coordinator') WITH CHECK ((SELECT portal.cur_role()) = 'national_coordinator');
GRANT SELECT ON portal.staleness_reminders, portal.v_sample_staleness TO app_runtime;
GRANT UPDATE (acknowledged_by, acknowledged_at) ON portal.staleness_reminders TO app_runtime;
CREATE POLICY strem_clin ON portal.staleness_reminders FOR SELECT TO app_runtime USING ((SELECT portal.cur_role()) = 'center_clinician' AND center_id = (SELECT portal.cur_center_id()));
CREATE POLICY strem_coord ON portal.staleness_reminders FOR ALL TO app_runtime USING ((SELECT portal.cur_role()) = 'national_coordinator') WITH CHECK ((SELECT portal.cur_role()) = 'national_coordinator');
