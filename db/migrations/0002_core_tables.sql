-- 0002 core tables. kind: expand. Synthetic data only until GATE-PROD-DATA.
CREATE TYPE portal.role_name AS ENUM
  ('anonymous','researcher_il','researcher_intl','center_clinician','national_coordinator','committee_member','system_admin');
CREATE TYPE portal.user_status AS ENUM ('invited','active','suspended','closed');
CREATE TYPE portal.sample_type AS ENUM ('ffpe','frozen','csf','plasma_or_liquid_biopsy','isolated_dna_rna');
CREATE TYPE portal.availability AS ENUM ('available','limited','depleted');
CREATE TYPE portal.quantity_class AS ENUM ('small','medium','large');
CREATE TYPE portal.clinical_timepoint AS ENUM ('diagnosis','during_treatment','relapse');
CREATE TYPE portal.age_band AS ENUM ('0_lt1','1_lt3','3_lt6','6_lt10','10_lt15','15_lt18');
CREATE TYPE portal.sex AS ENUM ('female','male','other_or_unknown');
CREATE TYPE portal.consent_status AS ENUM ('consent_obtained','broad_consent','waiver_by_committee','restricted','unknown');
CREATE TYPE portal.attached_data_type AS ENUM ('wes','wgs','rna_seq','mri','digital_pathology','redcap_clinical');
CREATE TYPE portal.ethics_kind AS ENUM ('helsinki_committee','irb_other');
CREATE TYPE portal.ethics_status AS ENUM ('active','expired','revoked');
-- canonical C-01 states and close reasons
CREATE TYPE portal.request_status AS ENUM
  ('draft','submitted','precheck','needs_info','committee_review','appeal_review','approved','rejected',
   'center_coordination','agreements','delivery','closed');
CREATE TYPE portal.close_reason AS ENUM ('delivered','withdrawn','expired','rejected','policy_cancelled');
CREATE TYPE portal.step_key AS ENUM ('center_coordination','delivery');
CREATE TYPE portal.step_status AS ENUM ('pending','in_progress','done','skipped','blocked');
CREATE TYPE portal.decision_outcome AS ENUM ('approved','rejected');
CREATE TYPE portal.vote_value AS ENUM ('approve','reject','abstain');
CREATE TYPE portal.vote_round AS ENUM ('initial','appeal');
CREATE TYPE portal.import_mode AS ENUM ('dry_run','commit');
CREATE TYPE portal.import_format AS ENUM ('csv','xlsx');
CREATE TYPE portal.import_status AS ENUM ('uploaded','validating','validated','rejected','committing','committed','failed','cancelled','expired');
CREATE TYPE portal.row_outcome AS ENUM ('accepted','warning','rejected');

CREATE TABLE portal.centers (
  id portal.ulid_text PRIMARY KEY CHECK (id LIKE 'ctr\_%'),
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9_]{2,32}$'),
  name_en text NOT NULL, name_he text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  contact_role text NOT NULL, contact_channel text, local_system_ref text,
  feeds_regularly boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TRIGGER trg_centers_touch BEFORE UPDATE ON portal.centers FOR EACH ROW EXECUTE FUNCTION portal.touch_updated_at();

CREATE TABLE portal.users (
  id portal.ulid_text PRIMARY KEY CHECK (id LIKE 'usr\_%'),
  email text NOT NULL CHECK (email = lower(email) AND position('@' IN email) > 1),
  display_name text NOT NULL,
  locale text NOT NULL DEFAULT 'he' CHECK (locale IN ('he','en')),
  status portal.user_status NOT NULL DEFAULT 'invited',
  email_verified_at timestamptz, external_idp_subject text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), last_login_at timestamptz,
  closed_at timestamptz);
CREATE UNIQUE INDEX ux_users_email ON portal.users (email);
CREATE UNIQUE INDEX ux_users_idp ON portal.users (external_idp_subject) WHERE external_idp_subject IS NOT NULL;
CREATE TRIGGER trg_users_touch BEFORE UPDATE ON portal.users FOR EACH ROW EXECUTE FUNCTION portal.touch_updated_at();

CREATE TABLE portal.role_assignments (
  id portal.ulid_text PRIMARY KEY CHECK (id LIKE 'rol\_%'),
  user_id portal.ulid_text NOT NULL REFERENCES portal.users(id),
  role portal.role_name NOT NULL CHECK (role <> 'anonymous'),
  center_id portal.ulid_text REFERENCES portal.centers(id),
  granted_by portal.ulid_text REFERENCES portal.users(id),
  approved_by portal.ulid_text REFERENCES portal.users(id),
  granted_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz,
  CONSTRAINT ck_role_center CHECK ((role = 'center_clinician' AND center_id IS NOT NULL) OR (role <> 'center_clinician' AND center_id IS NULL)),
  CONSTRAINT ck_revoked_after_grant CHECK (revoked_at IS NULL OR revoked_at >= granted_at),
  CONSTRAINT ck_two_person CHECK (role IN ('researcher_il','researcher_intl') OR granted_by IS NULL OR approved_by IS NULL OR granted_by <> approved_by));
CREATE UNIQUE INDEX ux_role_active ON portal.role_assignments (user_id, role, coalesce(center_id,'')) WHERE revoked_at IS NULL;
CREATE INDEX ix_role_user ON portal.role_assignments (user_id) WHERE revoked_at IS NULL;

-- Separation of duties (DB level). Applies to every writer, definer functions included.
CREATE FUNCTION portal.enforce_separation_of_duties() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE conflicting boolean;
BEGIN
  IF NEW.revoked_at IS NOT NULL THEN RETURN NEW; END IF;
  SELECT EXISTS (SELECT 1 FROM portal.role_assignments r
    WHERE r.user_id = NEW.user_id AND r.revoked_at IS NULL AND r.id <> NEW.id AND (
      (NEW.role = 'system_admin' AND r.role IN ('committee_member','national_coordinator','center_clinician')) OR
      (NEW.role IN ('committee_member','national_coordinator','center_clinician') AND r.role = 'system_admin') OR
      (NEW.role = 'committee_member' AND r.role = 'national_coordinator') OR
      (NEW.role = 'national_coordinator' AND r.role = 'committee_member')))
  INTO conflicting;
  IF conflicting THEN RAISE EXCEPTION 'separation_of_duties' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_role_sod BEFORE INSERT OR UPDATE ON portal.role_assignments FOR EACH ROW EXECUTE FUNCTION portal.enforce_separation_of_duties();

CREATE TABLE portal.diagnosis_terms (
  diagnosis_code text PRIMARY KEY CHECK (diagnosis_code ~ '^[a-z][a-z0-9_]{2,63}$'),
  parent_code text REFERENCES portal.diagnosis_terms(diagnosis_code),
  level text NOT NULL CHECK (level IN ('group','family','type')),
  classification text NOT NULL DEFAULT 'who_cns5', who_edition text NOT NULL DEFAULT 'CNS5-2021',
  icdo3_morph text CHECK (icdo3_morph ~ '^[0-9]{4}/[0-9]$'),
  label_en text NOT NULL, label_he text NOT NULL,
  is_selectable boolean NOT NULL DEFAULT true,
  valid_from date NOT NULL DEFAULT current_date, valid_to date,
  CONSTRAINT ck_dx_parent CHECK ((level = 'group') = (parent_code IS NULL)));
CREATE INDEX ix_dx_parent ON portal.diagnosis_terms (parent_code);
CREATE TABLE portal.diagnosis_synonyms (
  id bigserial PRIMARY KEY,
  diagnosis_code text NOT NULL REFERENCES portal.diagnosis_terms(diagnosis_code) ON DELETE CASCADE,
  lang text NOT NULL CHECK (lang IN ('he','en')), term text NOT NULL,
  kind text NOT NULL DEFAULT 'synonym' CHECK (kind IN ('synonym','abbreviation','legacy_name','spelling_variant')),
  UNIQUE (diagnosis_code, lang, term));

CREATE TABLE portal.ethics_approvals (
  id portal.ulid_text PRIMARY KEY CHECK (id LIKE 'eth\_%'),
  center_id portal.ulid_text NOT NULL REFERENCES portal.centers(id),
  approval_ref text NOT NULL CHECK (approval_ref ~ '^[A-Za-z0-9._/-]{3,64}$'),
  kind portal.ethics_kind NOT NULL DEFAULT 'helsinki_committee',
  status portal.ethics_status NOT NULL DEFAULT 'active',
  valid_from date, valid_to date,
  created_by portal.ulid_text REFERENCES portal.users(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (center_id, approval_ref), CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from));
CREATE TRIGGER trg_eth_touch BEFORE UPDATE ON portal.ethics_approvals FOR EACH ROW EXECUTE FUNCTION portal.touch_updated_at();

-- samples. donor_ref is INTERNAL: opaque random, never returned by any API, no column grant to read it.
CREATE TABLE portal.samples (
  id portal.ulid_text PRIMARY KEY CHECK (id LIKE 'smp\_%'),
  donor_ref text NOT NULL DEFAULT replace(gen_random_uuid()::text,'-','') CHECK (donor_ref ~ '^[0-9a-f]{32}$'),
  source_center_id portal.ulid_text NOT NULL REFERENCES portal.centers(id),
  diagnosis_code text NOT NULL REFERENCES portal.diagnosis_terms(diagnosis_code),
  age_band_at_diagnosis portal.age_band NOT NULL, sex portal.sex NOT NULL,
  sample_type portal.sample_type NOT NULL, availability portal.availability NOT NULL,
  quantity_class portal.quantity_class,
  clinical_timepoint portal.clinical_timepoint NOT NULL,
  collection_month char(7) NOT NULL CHECK (collection_month ~ '^(19[89][0-9]|20[0-9]{2})-(0[1-9]|1[0-2])$'),
  attached_data portal.attached_data_type[] NOT NULL DEFAULT '{}',
  consent_status portal.consent_status NOT NULL DEFAULT 'unknown',
  ethics_approval_id portal.ulid_text REFERENCES portal.ethics_approvals(id),
  contact_ref text NOT NULL,
  source_system text NOT NULL DEFAULT 'portal_entry' CHECK (source_system IN ('portal_entry','csv_import','madgam','redcap_ref')),
  is_synthetic boolean NOT NULL DEFAULT true,
  created_by portal.ulid_text REFERENCES portal.users(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  last_verified_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
  CONSTRAINT ck_sample_not_deleted_available CHECK (deleted_at IS NULL OR availability <> 'available'));
CREATE TRIGGER trg_samples_touch BEFORE UPDATE ON portal.samples FOR EACH ROW EXECUTE FUNCTION portal.touch_updated_at();
CREATE INDEX ix_samples_center ON portal.samples (source_center_id) WHERE deleted_at IS NULL;
CREATE INDEX ix_samples_dx ON portal.samples (diagnosis_code) WHERE deleted_at IS NULL;
CREATE INDEX ix_samples_donor ON portal.samples (donor_ref);
CREATE INDEX ix_samples_verified ON portal.samples (source_center_id, last_verified_at) WHERE deleted_at IS NULL;
CREATE INDEX ix_samples_ethics ON portal.samples (ethics_approval_id);

CREATE FUNCTION portal.check_sample_ethics_center() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.ethics_approval_id IS NOT NULL AND NOT EXISTS (
     SELECT 1 FROM portal.ethics_approvals e WHERE e.id = NEW.ethics_approval_id AND e.center_id = NEW.source_center_id) THEN
    RAISE EXCEPTION 'ethics_center_mismatch' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_samples_ethics BEFORE INSERT OR UPDATE OF ethics_approval_id, source_center_id ON portal.samples
  FOR EACH ROW EXECUTE FUNCTION portal.check_sample_ethics_center();

-- All samples of one donor must agree on diagnosis, sex, age band and center. This makes donor counts additive (privacy engine).
CREATE FUNCTION portal.check_donor_consistency() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, portal, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM portal.samples s WHERE s.donor_ref = NEW.donor_ref AND s.id <> NEW.id AND
       (s.diagnosis_code, s.sex, s.age_band_at_diagnosis, s.source_center_id) IS DISTINCT FROM
       (NEW.diagnosis_code, NEW.sex, NEW.age_band_at_diagnosis, NEW.source_center_id)) THEN
    RAISE EXCEPTION 'donor_inconsistent' USING ERRCODE = '23514'; END IF;
  RETURN NULL;
END $$;
-- AFTER ROW, checked at statement end: portal.donor_correct updates all samples of a donor in ONE statement.
CREATE CONSTRAINT TRIGGER trg_samples_donor AFTER INSERT OR UPDATE OF donor_ref, diagnosis_code, sex, age_band_at_diagnosis, source_center_id
  ON portal.samples DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION portal.check_donor_consistency();

CREATE TABLE portal.sample_attached_data (
  sample_id portal.ulid_text NOT NULL REFERENCES portal.samples(id) ON DELETE CASCADE,
  data_type portal.attached_data_type NOT NULL, is_available boolean NOT NULL DEFAULT true,
  reference_kind text DEFAULT 'none' CHECK (reference_kind IN ('none','redcap_pointer','object_store_key','external_repo_pointer')),
  reference_ref text, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sample_id, data_type),
  CHECK (data_type <> 'wgs' OR reference_kind IN ('none','external_repo_pointer')));
-- RT-05: runs as app_core, which has an explicit policy on samples (see 0004). Verified by test.
CREATE FUNCTION portal.sync_attached_data() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, portal, pg_temp AS $$
DECLARE sid text := coalesce(NEW.sample_id, OLD.sample_id);
BEGIN
  UPDATE portal.samples s SET attached_data = coalesce((SELECT array_agg(a.data_type ORDER BY a.data_type)
        FROM portal.sample_attached_data a WHERE a.sample_id = sid AND a.is_available), '{}')
   WHERE s.id = sid;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_attached_sync AFTER INSERT OR UPDATE OR DELETE ON portal.sample_attached_data
  FOR EACH ROW EXECUTE FUNCTION portal.sync_attached_data();

-- Config as data (C-14, C-07)
CREATE TABLE portal.workflow_config (
  key text NOT NULL, scope text NOT NULL DEFAULT 'global',
  value jsonb NOT NULL, updated_by text, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key, scope));
INSERT INTO portal.workflow_config (key, value) VALUES
 ('staleness.sla_days','180'),('staleness.warn_days','30'),('staleness.digest_days','7'),
 ('request.cart_idle_expiry_days','30'),('request.info_response_days','14'),('request.info_rounds_max','3'),
 ('request.appeal_window_days','30'),('request.center_coordination_max_days','45'),
 ('request.agreements_max_days','60'),('request.delivery_max_days','90'),
 ('retention.request_years','7'),('retention.request_text_months','24'),('retention.audit_years','7'),
 ('retention.sample_deleted_months','24'),('retention.user_closed_months','12'),
 ('retention.import_rows_months','12'),('retention.idempotency_hours','24');

CREATE TABLE portal.k_policies (
  field_set text PRIMARY KEY, k int NOT NULL CHECK (k >= 5),     -- C-08 floor
  updated_by text, updated_at timestamptz NOT NULL DEFAULT now());
INSERT INTO portal.k_policies VALUES ('default', 5);
CREATE FUNCTION portal.check_k_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.field_set <> 'default' AND NEW.k < (SELECT k FROM portal.k_policies WHERE field_set = 'default') THEN
    RAISE EXCEPTION 'k_below_default' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_k_check BEFORE INSERT OR UPDATE ON portal.k_policies FOR EACH ROW EXECUTE FUNCTION portal.check_k_policy();

CREATE TABLE portal.committee_config (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  votes_needed int NOT NULL DEFAULT 2 CHECK (votes_needed >= 2),
  members_total int NOT NULL DEFAULT 3, criteria_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(), CHECK (members_total >= votes_needed));
INSERT INTO portal.committee_config DEFAULT VALUES;

-- Two-person changes: role grants, k policy, committee config
CREATE TABLE portal.change_requests (
  id portal.ulid_text PRIMARY KEY CHECK (id LIKE 'chg\_%'),
  kind text NOT NULL CHECK (kind IN ('role_grant','k_policy','committee_config')),
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired')),
  proposed_by text NOT NULL, proposed_role text NOT NULL, proposed_at timestamptz NOT NULL DEFAULT now(),
  decided_by text, decided_at timestamptz,
  CHECK (decided_by IS NULL OR decided_by <> proposed_by));
CREATE TABLE portal.email_verifications (
  user_id portal.ulid_text PRIMARY KEY REFERENCES portal.users(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL, expires_at timestamptz NOT NULL, attempts int NOT NULL DEFAULT 0, used_at timestamptz);
CREATE TABLE portal.researcher_registrations (
  user_id portal.ulid_text PRIMARY KEY REFERENCES portal.users(id) ON DELETE CASCADE,
  requested_role portal.role_name NOT NULL CHECK (requested_role IN ('researcher_il','researcher_intl')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at timestamptz NOT NULL DEFAULT now());

-- Requests
CREATE TABLE portal.requests (
  id portal.ulid_text PRIMARY KEY CHECK (id LIKE 'req\_%'),
  applicant_user_id portal.ulid_text NOT NULL REFERENCES portal.users(id),
  status portal.request_status NOT NULL DEFAULT 'draft',
  close_reason portal.close_reason, close_detail text CHECK (close_detail ~ '^[a-z_]{1,40}$'),
  research_question text, applicant_ethics_ref text, planned_use text, funding_sources text,
  idempotency_key text, reached_committee boolean NOT NULL DEFAULT false,
  appeal_count int NOT NULL DEFAULT 0 CHECK (appeal_count <= 1), info_rounds int NOT NULL DEFAULT 0,
  on_hold boolean NOT NULL DEFAULT false, text_wiped_at timestamptz,
  state_entered_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz, decided_at timestamptz, delivered_at timestamptz, closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (char_length(research_question) <= 4000), CHECK (char_length(planned_use) <= 4000),
  CHECK (char_length(funding_sources) <= 1000), CHECK (char_length(applicant_ethics_ref) <= 100),
  CHECK ((status = 'closed') = (close_reason IS NOT NULL)),
  CHECK (status = 'draft' OR text_wiped_at IS NOT NULL OR (research_question IS NOT NULL AND applicant_ethics_ref IS NOT NULL
                              AND planned_use IS NOT NULL AND funding_sources IS NOT NULL)));
CREATE UNIQUE INDEX ux_req_idem ON portal.requests (applicant_user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX ix_req_status ON portal.requests (status, state_entered_at);
CREATE INDEX ix_req_applicant ON portal.requests (applicant_user_id, created_at DESC);
CREATE TRIGGER trg_req_touch BEFORE UPDATE ON portal.requests FOR EACH ROW EXECUTE FUNCTION portal.touch_updated_at();

CREATE TABLE portal.request_items (
  id portal.ulid_text PRIMARY KEY CHECK (id LIKE 'rit\_%'),
  request_id portal.ulid_text NOT NULL REFERENCES portal.requests(id) ON DELETE CASCADE,
  criteria jsonb NOT NULL CHECK (jsonb_typeof(criteria) = 'object' AND pg_column_size(criteria) < 4096),
  requested_count int CHECK (requested_count > 0),
  shown_count_bucket text CHECK (shown_count_bucket IN ('lt10','10_plus')),
  created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX ix_ritem_req ON portal.request_items (request_id);
CREATE FUNCTION portal.limit_request_items() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT count(*) FROM portal.request_items WHERE request_id = NEW.request_id) >= 50 THEN
    RAISE EXCEPTION 'too_many_items' USING ERRCODE = '54000'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_ritem_limit BEFORE INSERT ON portal.request_items FOR EACH ROW EXECUTE FUNCTION portal.limit_request_items();

-- RT-21: sample link is nullable with tombstone (code + center snapshot), so purge never breaks FKs.
CREATE TABLE portal.request_item_samples (
  id bigserial PRIMARY KEY,
  request_item_id portal.ulid_text NOT NULL REFERENCES portal.request_items(id) ON DELETE CASCADE,
  sample_id portal.ulid_text REFERENCES portal.samples(id) ON DELETE SET NULL,
  sample_code text NOT NULL, center_id text NOT NULL,
  resolved_by text, resolved_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_item_id, sample_code));
CREATE INDEX ix_ris_sample ON portal.request_item_samples (sample_id);
CREATE FUNCTION portal.fill_ris_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s record;
BEGIN
  SELECT id, source_center_id INTO s FROM portal.samples WHERE id = NEW.sample_id AND deleted_at IS NULL;
  IF s.id IS NULL THEN RAISE EXCEPTION 'sample_not_found' USING ERRCODE = '23503'; END IF;
  NEW.sample_code := s.id; NEW.center_id := s.source_center_id; NEW.resolved_by := portal.cur_user_id();
  RETURN NEW;
END $$;
CREATE TRIGGER trg_ris_fill BEFORE INSERT ON portal.request_item_samples FOR EACH ROW EXECUTE FUNCTION portal.fill_ris_snapshot();

CREATE TABLE portal.request_steps (
  id portal.ulid_text PRIMARY KEY CHECK (id LIKE 'stp\_%'),
  request_id portal.ulid_text NOT NULL REFERENCES portal.requests(id) ON DELETE CASCADE,
  step_key portal.step_key NOT NULL, center_id portal.ulid_text NOT NULL REFERENCES portal.centers(id),
  status portal.step_status NOT NULL DEFAULT 'pending', actor_user_id text,
  accepted boolean, public_note text CHECK (char_length(public_note) <= 1000),
  internal_note text CHECK (char_length(internal_note) <= 2000),
  started_at timestamptz, completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, step_key, center_id));
CREATE INDEX ix_rstep_req ON portal.request_steps (request_id);
CREATE INDEX ix_rstep_center ON portal.request_steps (center_id);

CREATE TABLE portal.request_events (
  id bigserial PRIMARY KEY,
  request_id portal.ulid_text NOT NULL REFERENCES portal.requests(id) ON DELETE CASCADE,
  at timestamptz NOT NULL DEFAULT now(), from_state portal.request_status, to_state portal.request_status NOT NULL,
  actor_user_id text, actor_role text NOT NULL, reason_code text CHECK (reason_code ~ '^[a-z_]{1,40}$'),
  public_note text CHECK (char_length(public_note) <= 1000));
CREATE INDEX ix_revent_req ON portal.request_events (request_id, at);

CREATE TABLE portal.request_decisions (
  id portal.ulid_text PRIMARY KEY CHECK (id LIKE 'dec\_%'),
  request_id portal.ulid_text NOT NULL REFERENCES portal.requests(id) ON DELETE CASCADE,
  round portal.vote_round NOT NULL, outcome portal.decision_outcome NOT NULL,
  rationale_codes text[] NOT NULL DEFAULT '{}', rationale text CHECK (char_length(rationale) <= 2000),
  criteria_snapshot jsonb, decided_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, round));
CREATE TABLE portal.request_votes (
  id portal.ulid_text PRIMARY KEY CHECK (id LIKE 'vot\_%'),
  request_id portal.ulid_text NOT NULL REFERENCES portal.requests(id) ON DELETE CASCADE,
  round portal.vote_round NOT NULL, voter_user_id portal.ulid_text NOT NULL REFERENCES portal.users(id),
  vote portal.vote_value NOT NULL, rationale_code text CHECK (rationale_code ~ '^[a-z_]{1,40}$'),
  comment text CHECK (char_length(comment) <= 1000), voted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, round, voter_user_id),
  CHECK (vote <> 'reject' OR rationale_code IS NOT NULL));
CREATE TABLE portal.request_recusals (
  request_id portal.ulid_text NOT NULL REFERENCES portal.requests(id) ON DELETE CASCADE,
  user_id portal.ulid_text NOT NULL REFERENCES portal.users(id), declared_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, user_id));
CREATE TABLE portal.request_agreements (
  id bigserial PRIMARY KEY,
  request_id portal.ulid_text NOT NULL REFERENCES portal.requests(id) ON DELETE CASCADE,
  center_id portal.ulid_text NOT NULL REFERENCES portal.centers(id),
  kind text NOT NULL CHECK (kind IN ('mta','dta')), doc_ref text NOT NULL CHECK (doc_ref ~ '^[A-Za-z0-9._/-]{3,64}$'),
  recorded_by text, signed_at timestamptz NOT NULL DEFAULT now(), UNIQUE (request_id, center_id, kind));

CREATE TABLE portal.idempotency_keys (
  user_id portal.ulid_text NOT NULL REFERENCES portal.users(id),
  key text NOT NULL CHECK (char_length(key) BETWEEN 8 AND 128),
  method_path text NOT NULL, request_hash bytea NOT NULL, response_status int, response_ref text,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (user_id, key));

CREATE TABLE portal.import_jobs (
  id portal.ulid_text PRIMARY KEY CHECK (id LIKE 'imp\_%'),
  created_by portal.ulid_text NOT NULL REFERENCES portal.users(id),
  center_id portal.ulid_text REFERENCES portal.centers(id),
  mode portal.import_mode NOT NULL DEFAULT 'dry_run', format portal.import_format NOT NULL,
  status portal.import_status NOT NULL DEFAULT 'uploaded', schema_version text NOT NULL DEFAULT 'v1',
  file_name_safe text NOT NULL CHECK (file_name_safe ~ '^[A-Za-z0-9._-]{1,100}$'),
  staging_key text, file_sha256 bytea, parent_job_id portal.ulid_text REFERENCES portal.import_jobs(id),
  total_rows int, accepted_rows int, warning_rows int, rejected_rows int, report_key text, result_map_key text,
  created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, finished_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days');
CREATE INDEX ix_imp_user ON portal.import_jobs (created_by, created_at DESC);
CREATE TABLE portal.import_job_rows (
  job_id portal.ulid_text NOT NULL REFERENCES portal.import_jobs(id) ON DELETE CASCADE,
  row_no int NOT NULL CHECK (row_no >= 1), outcome portal.row_outcome NOT NULL,
  sample_id portal.ulid_text REFERENCES portal.samples(id) ON DELETE SET NULL,
  action text CHECK (action IN ('create','update','verify_only','none')),
  issues jsonb NOT NULL DEFAULT '[]'::jsonb, PRIMARY KEY (job_id, row_no));

CREATE TABLE portal.staleness_reminders (
  id bigserial PRIMARY KEY, center_id portal.ulid_text NOT NULL REFERENCES portal.centers(id),
  generated_at timestamptz NOT NULL DEFAULT now(), due_soon_count int NOT NULL, stale_count int NOT NULL,
  acknowledged_by text, acknowledged_at timestamptz);
CREATE INDEX ix_stale_rem_center ON portal.staleness_reminders (center_id, generated_at DESC);

CREATE VIEW portal.v_sample_staleness WITH (security_invoker = true) AS
SELECT s.id AS sample_id, s.source_center_id, s.last_verified_at, p.sla_days,
       s.last_verified_at + make_interval(days => p.sla_days) AS due_at,
       CASE WHEN now() > s.last_verified_at + make_interval(days => p.sla_days) THEN 'stale'
            WHEN now() > s.last_verified_at + make_interval(days => p.sla_days - p.warn_days) THEN 'due_soon'
            ELSE 'fresh' END AS staleness
FROM portal.samples s
JOIN LATERAL (SELECT
   coalesce((SELECT (value #>> '{}')::int FROM portal.workflow_config WHERE key='staleness.sla_days' AND scope = s.source_center_id),
            (SELECT (value #>> '{}')::int FROM portal.workflow_config WHERE key='staleness.sla_days' AND scope='global'), 180) AS sla_days,
   coalesce((SELECT (value #>> '{}')::int FROM portal.workflow_config WHERE key='staleness.warn_days' AND scope = s.source_center_id),
            (SELECT (value #>> '{}')::int FROM portal.workflow_config WHERE key='staleness.warn_days' AND scope='global'), 30) AS warn_days) p ON true
WHERE s.deleted_at IS NULL;

CREATE TABLE portal.ctx_secret (id smallint PRIMARY KEY CHECK (id = 1), key bytea NOT NULL);
INSERT INTO portal.ctx_secret VALUES (1, ext.gen_random_bytes(32));
CREATE TABLE portal.breakglass_grants (
  id portal.ulid_text PRIMARY KEY CHECK (id LIKE 'bgl\_%'),
  requested_by text NOT NULL, purpose_code text NOT NULL CHECK (purpose_code ~ '^[a-z_]{1,40}$'),
  requested_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz,
  approver_1 text, approver_2 text, approved_at timestamptz,
  CHECK (approver_1 IS NULL OR approver_1 <> requested_by),
  CHECK (approver_2 IS NULL OR (approver_2 <> requested_by AND approver_2 <> approver_1)));
