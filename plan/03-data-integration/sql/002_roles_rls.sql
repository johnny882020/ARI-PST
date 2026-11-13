-- Migration 0002: database roles, grants, Row-Level Security.
-- Model:
--   * The API logs in as portal_app (NOINHERIT, no table privileges).
--   * Per transaction it runs:  SET LOCAL ROLE portal_<x>;  and set_config('app.user_id'|'app.center_id', ..., true).
--   * External roles (anonymous, researcher_il, researcher_intl) map to portal_external.
--     portal_external has NO privilege on samples, sample_attached_data or request_item_samples.
--     It reaches counts only through SECURITY DEFINER functions owned by portal_agg (003_search.sql).
--   * RLS is FORCED on every table that holds index or request data. Defence in depth.
-- Run as the migration owner role (here: the role that ran 001).

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['portal_external','portal_clinician','portal_coordinator',
                           'portal_committee','portal_admin','portal_agg'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN NOINHERIT', r);
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portal_app') THEN
    CREATE ROLE portal_app LOGIN NOINHERIT;      -- password set out of band (secret store)
  END IF;
END $$;

GRANT portal_external, portal_clinician, portal_coordinator, portal_committee, portal_admin TO portal_app;
-- portal_app has no inherited privileges. It can only SET ROLE to the above. portal_agg is not grantable to it.

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA portal, search TO portal_external, portal_clinician, portal_coordinator, portal_committee, portal_admin, portal_agg;
GRANT USAGE ON SCHEMA audit TO portal_external, portal_clinician, portal_coordinator, portal_committee, portal_admin;
REVOKE ALL ON ALL TABLES IN SCHEMA portal, audit FROM PUBLIC;

-- ---------- Enable and force RLS ----------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','role_assignments','samples','sample_attached_data','ethics_approvals',
    'requests','request_items','request_item_samples','request_steps','request_decisions',
    'request_votes','import_jobs','import_job_rows','staleness_reminders','idempotency_keys'] LOOP
    EXECUTE format('ALTER TABLE portal.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE portal.%I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
  ALTER TABLE audit.audit_events ENABLE ROW LEVEL SECURITY;
  ALTER TABLE audit.audit_events FORCE ROW LEVEL SECURITY;
END $$;

-- ---------- Public reference data: readable by every app role ----------
GRANT SELECT ON portal.centers, portal.diagnosis_terms, portal.diagnosis_synonyms, portal.k_policies
  TO portal_external, portal_clinician, portal_coordinator, portal_committee, portal_admin, portal_agg;
GRANT INSERT, UPDATE ON portal.centers TO portal_admin;
GRANT INSERT, UPDATE ON portal.diagnosis_terms, portal.diagnosis_synonyms TO portal_coordinator;   -- vocabulary upkeep
GRANT USAGE ON SEQUENCE portal.diagnosis_synonyms_id_seq TO portal_coordinator;
GRANT UPDATE ON portal.k_policies TO portal_admin;
GRANT SELECT ON portal.committee_config TO portal_committee, portal_coordinator, portal_admin;
GRANT UPDATE ON portal.committee_config TO portal_admin;
GRANT SELECT, INSERT, UPDATE ON portal.staleness_policies TO portal_coordinator;
GRANT SELECT ON portal.staleness_policies TO portal_clinician;
GRANT USAGE ON SEQUENCE portal.staleness_policies_id_seq TO portal_coordinator;

-- ---------- samples ----------
GRANT SELECT ON portal.samples, portal.sample_attached_data TO portal_clinician, portal_coordinator, portal_agg;
GRANT INSERT, UPDATE ON portal.samples, portal.sample_attached_data TO portal_coordinator;
-- No DELETE grant. Removal is soft (deleted_at) by coordinator; purge by retention job (migration role).
-- Deliberately NO grant to portal_external, portal_committee, portal_admin.

CREATE POLICY samples_clinician_read ON portal.samples FOR SELECT TO portal_clinician
  USING (source_center_id = portal.cur_center_id() AND deleted_at IS NULL);
CREATE POLICY samples_coord_all ON portal.samples FOR ALL TO portal_coordinator
  USING (true) WITH CHECK (true);
CREATE POLICY samples_agg_read ON portal.samples FOR SELECT TO portal_agg
  USING (deleted_at IS NULL);

CREATE POLICY attached_clinician_read ON portal.sample_attached_data FOR SELECT TO portal_clinician
  USING (EXISTS (SELECT 1 FROM portal.samples s
                 WHERE s.id = sample_id AND s.source_center_id = portal.cur_center_id() AND s.deleted_at IS NULL));
CREATE POLICY attached_coord_all ON portal.sample_attached_data FOR ALL TO portal_coordinator
  USING (true) WITH CHECK (true);
CREATE POLICY attached_agg_read ON portal.sample_attached_data FOR SELECT TO portal_agg USING (true);

-- The sync trigger updates samples. It must work for the coordinator role.
ALTER FUNCTION portal.sync_attached_data() SECURITY DEFINER SET search_path = portal, pg_catalog;

-- ---------- ethics approvals ----------
GRANT SELECT ON portal.ethics_approvals TO portal_clinician, portal_coordinator;
GRANT INSERT, UPDATE ON portal.ethics_approvals TO portal_coordinator;
CREATE POLICY eth_clinician_read ON portal.ethics_approvals FOR SELECT TO portal_clinician
  USING (center_id = portal.cur_center_id());
CREATE POLICY eth_coord_all ON portal.ethics_approvals FOR ALL TO portal_coordinator
  USING (true) WITH CHECK (true);

-- ---------- users and role assignments ----------
GRANT SELECT ON portal.users TO portal_external, portal_clinician, portal_coordinator, portal_committee, portal_admin;
GRANT INSERT, UPDATE ON portal.users TO portal_admin;
GRANT UPDATE (status, email_verified_at) ON portal.users TO portal_coordinator;   -- approve researcher registration
GRANT SELECT, INSERT, UPDATE ON portal.role_assignments TO portal_admin;
GRANT SELECT ON portal.role_assignments TO portal_external, portal_clinician, portal_coordinator, portal_committee;
GRANT INSERT ON portal.role_assignments TO portal_coordinator;

CREATE POLICY users_self ON portal.users FOR SELECT
  TO portal_external, portal_clinician, portal_committee USING (id = portal.cur_user_id());
CREATE POLICY users_coord_read ON portal.users FOR SELECT TO portal_coordinator USING (true);
CREATE POLICY users_coord_update ON portal.users FOR UPDATE TO portal_coordinator USING (true) WITH CHECK (true);
CREATE POLICY users_admin_all ON portal.users FOR ALL TO portal_admin USING (true) WITH CHECK (true);

CREATE POLICY roles_self ON portal.role_assignments FOR SELECT
  TO portal_external, portal_clinician, portal_committee USING (user_id = portal.cur_user_id());
CREATE POLICY roles_coord_read ON portal.role_assignments FOR SELECT TO portal_coordinator USING (true);
CREATE POLICY roles_coord_insert ON portal.role_assignments FOR INSERT TO portal_coordinator
  WITH CHECK (role IN ('researcher_il','researcher_intl'));
CREATE POLICY roles_admin_all ON portal.role_assignments FOR ALL TO portal_admin USING (true) WITH CHECK (true);

-- ---------- requests ----------
GRANT SELECT, INSERT, UPDATE ON portal.requests, portal.request_items TO portal_external, portal_coordinator;
GRANT SELECT ON portal.requests, portal.request_items TO portal_committee, portal_clinician;
GRANT DELETE ON portal.request_items TO portal_external;
-- request_steps: applicants get column-level access. internal_note is excluded.
GRANT SELECT (id, request_id, step_key, center_id, status, public_note, started_at, completed_at, created_at)
  ON portal.request_steps TO portal_external, portal_clinician;
GRANT SELECT, INSERT, UPDATE ON portal.request_steps TO portal_coordinator;
GRANT SELECT ON portal.request_steps TO portal_committee;
GRANT SELECT, INSERT ON portal.request_decisions TO portal_committee;
GRANT SELECT ON portal.request_decisions TO portal_coordinator;
GRANT SELECT (id, request_id, outcome, decided_at) ON portal.request_decisions TO portal_external;  -- no rationale by default
GRANT SELECT, INSERT, UPDATE ON portal.request_votes TO portal_committee;
GRANT SELECT ON portal.request_votes TO portal_coordinator;
GRANT SELECT, INSERT, DELETE ON portal.request_item_samples TO portal_coordinator;
GRANT SELECT, INSERT, UPDATE ON portal.idempotency_keys TO portal_external, portal_coordinator;

CREATE POLICY req_owner ON portal.requests FOR ALL TO portal_external
  USING (applicant_user_id = portal.cur_user_id())
  WITH CHECK (applicant_user_id = portal.cur_user_id() AND status IN ('draft','submitted','withdrawn'));
CREATE POLICY req_coord ON portal.requests FOR ALL TO portal_coordinator USING (true) WITH CHECK (true);
CREATE POLICY req_committee ON portal.requests FOR SELECT TO portal_committee
  USING (status NOT IN ('draft','submitted','precheck','needs_info'));
CREATE POLICY req_clinician ON portal.requests FOR SELECT TO portal_clinician
  USING (EXISTS (SELECT 1 FROM portal.request_steps st
                 WHERE st.request_id = id AND st.center_id = portal.cur_center_id()));

CREATE POLICY ritem_owner ON portal.request_items FOR ALL TO portal_external
  USING (EXISTS (SELECT 1 FROM portal.requests r WHERE r.id = request_id AND r.applicant_user_id = portal.cur_user_id() AND r.status = 'draft'))
  WITH CHECK (EXISTS (SELECT 1 FROM portal.requests r WHERE r.id = request_id AND r.applicant_user_id = portal.cur_user_id() AND r.status = 'draft'));
CREATE POLICY ritem_owner_read ON portal.request_items FOR SELECT TO portal_external
  USING (EXISTS (SELECT 1 FROM portal.requests r WHERE r.id = request_id AND r.applicant_user_id = portal.cur_user_id()));
CREATE POLICY ritem_coord ON portal.request_items FOR ALL TO portal_coordinator USING (true) WITH CHECK (true);
CREATE POLICY ritem_committee ON portal.request_items FOR SELECT TO portal_committee USING (true);
CREATE POLICY ritem_clinician ON portal.request_items FOR SELECT TO portal_clinician
  USING (EXISTS (SELECT 1 FROM portal.request_steps st
                 WHERE st.request_id = request_items.request_id AND st.center_id = portal.cur_center_id()));

CREATE POLICY ris_coord ON portal.request_item_samples FOR ALL TO portal_coordinator USING (true) WITH CHECK (true);

CREATE POLICY step_owner ON portal.request_steps FOR SELECT TO portal_external
  USING (EXISTS (SELECT 1 FROM portal.requests r WHERE r.id = request_id AND r.applicant_user_id = portal.cur_user_id()));
CREATE POLICY step_clinician ON portal.request_steps FOR SELECT TO portal_clinician
  USING (center_id = portal.cur_center_id());
CREATE POLICY step_coord ON portal.request_steps FOR ALL TO portal_coordinator USING (true) WITH CHECK (true);
CREATE POLICY step_committee ON portal.request_steps FOR SELECT TO portal_committee USING (true);

CREATE POLICY dec_owner ON portal.request_decisions FOR SELECT TO portal_external
  USING (EXISTS (SELECT 1 FROM portal.requests r WHERE r.id = request_id AND r.applicant_user_id = portal.cur_user_id()));
CREATE POLICY dec_committee ON portal.request_decisions FOR ALL TO portal_committee USING (true) WITH CHECK (true);
CREATE POLICY dec_coord ON portal.request_decisions FOR SELECT TO portal_coordinator USING (true);

-- A committee member writes only their own vote. Updates allowed until a decision exists.
CREATE POLICY vote_committee_read ON portal.request_votes FOR SELECT TO portal_committee USING (true);
CREATE POLICY vote_committee_write ON portal.request_votes FOR INSERT TO portal_committee
  WITH CHECK (voter_user_id = portal.cur_user_id());
CREATE POLICY vote_committee_update ON portal.request_votes FOR UPDATE TO portal_committee
  USING (voter_user_id = portal.cur_user_id()
         AND NOT EXISTS (SELECT 1 FROM portal.request_decisions d WHERE d.request_id = request_votes.request_id))
  WITH CHECK (voter_user_id = portal.cur_user_id());
CREATE POLICY vote_coord_read ON portal.request_votes FOR SELECT TO portal_coordinator USING (true);

CREATE POLICY idem_owner ON portal.idempotency_keys FOR ALL TO portal_external, portal_coordinator
  USING (user_id = portal.cur_user_id()) WITH CHECK (user_id = portal.cur_user_id());

-- ---------- import jobs: coordinator only ----------
GRANT SELECT, INSERT, UPDATE ON portal.import_jobs, portal.import_job_rows TO portal_coordinator;
CREATE POLICY imp_coord ON portal.import_jobs FOR ALL TO portal_coordinator USING (true) WITH CHECK (true);
CREATE POLICY impr_coord ON portal.import_job_rows FOR ALL TO portal_coordinator USING (true) WITH CHECK (true);

-- ---------- staleness ----------
GRANT SELECT ON portal.staleness_reminders TO portal_clinician, portal_coordinator;
GRANT INSERT, UPDATE ON portal.staleness_reminders TO portal_coordinator;
GRANT USAGE ON SEQUENCE portal.staleness_reminders_id_seq TO portal_coordinator;
CREATE POLICY strem_clinician ON portal.staleness_reminders FOR SELECT TO portal_clinician
  USING (center_id = portal.cur_center_id());
CREATE POLICY strem_coord ON portal.staleness_reminders FOR ALL TO portal_coordinator USING (true) WITH CHECK (true);

-- security_invoker: the view runs with the caller's privileges and RLS. External roles get no grant.
ALTER VIEW portal.v_sample_staleness SET (security_invoker = true);
GRANT SELECT ON portal.v_sample_staleness TO portal_clinician, portal_coordinator;

-- ---------- audit ----------
GRANT SELECT ON audit.audit_events TO portal_admin;
CREATE POLICY audit_admin_read ON audit.audit_events FOR SELECT TO portal_admin USING (true);
-- Appends go through audit.append (SECURITY DEFINER; table owner, FORCE RLS needs an owner policy):
CREATE POLICY audit_owner_insert ON audit.audit_events FOR INSERT TO CURRENT_USER WITH CHECK (true);
CREATE POLICY audit_owner_read ON audit.audit_events FOR SELECT TO CURRENT_USER USING (true);
REVOKE ALL ON FUNCTION audit.append(text,text,text,text,text,text,text,text,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION audit.verify_chain(bigint,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit.append(text,text,text,text,text,text,text,text,text,jsonb)
  TO portal_external, portal_clinician, portal_coordinator, portal_committee, portal_admin;
GRANT EXECUTE ON FUNCTION audit.verify_chain(bigint,bigint) TO portal_admin;
