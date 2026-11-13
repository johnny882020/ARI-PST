-- ARI-PST Portal - core schema v1 (PostgreSQL 16)
-- Migration 0001 (expand phase: all objects are new).
-- Synthetic data only until GATE-PROD-DATA is closed.
-- IDs are text with a prefix and a 26-char ULID (Crockford base32).

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE SCHEMA IF NOT EXISTS portal;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS search;
SET search_path = portal, public;

-- ---------- Domains ----------
CREATE DOMAIN portal.ulid_text AS text
  CHECK (VALUE ~ '^[a-z]{3}_[0-9A-HJKMNP-TV-Z]{26}$');

-- ---------- Enums ----------
CREATE TYPE portal.role_name AS ENUM
  ('anonymous','researcher_il','researcher_intl','center_clinician',
   'national_coordinator','committee_member','system_admin');
CREATE TYPE portal.user_status AS ENUM ('invited','active','suspended','closed');
CREATE TYPE portal.sample_type AS ENUM
  ('ffpe','frozen','csf','plasma_or_liquid_biopsy','isolated_dna_rna');
CREATE TYPE portal.availability AS ENUM ('available','limited','depleted');
CREATE TYPE portal.quantity_class AS ENUM ('small','medium','large');          -- ASSUMPTION-A3-03
CREATE TYPE portal.clinical_timepoint AS ENUM ('diagnosis','during_treatment','relapse');
CREATE TYPE portal.age_band AS ENUM
  ('0_lt1','1_lt3','3_lt6','6_lt10','10_lt15','15_lt18');                       -- ASSUMPTION-01
CREATE TYPE portal.sex AS ENUM ('female','male','other_or_unknown');
CREATE TYPE portal.consent_status AS ENUM
  ('consent_obtained','broad_consent','waiver_by_committee','restricted','unknown'); -- ASSUMPTION-A3-04
CREATE TYPE portal.attached_data_type AS ENUM
  ('wes','wgs','rna_seq','mri','digital_pathology','redcap_clinical');
CREATE TYPE portal.ethics_kind AS ENUM ('helsinki_committee','irb_other');
CREATE TYPE portal.ethics_status AS ENUM ('active','expired','revoked');
CREATE TYPE portal.request_status AS ENUM
  ('draft','submitted','precheck','needs_info','committee_review','approved',
   'rejected','center_coordination','agreements','delivery','delivered','withdrawn','closed');
CREATE TYPE portal.step_key AS ENUM
  ('submitted','precheck','committee_review','decision','center_coordination',
   'mta_dta','delivery','closed');
CREATE TYPE portal.step_status AS ENUM ('pending','in_progress','done','skipped','blocked');
CREATE TYPE portal.decision_outcome AS ENUM ('approved','rejected','needs_info');
CREATE TYPE portal.vote_value AS ENUM ('approve','reject','abstain');
CREATE TYPE portal.import_mode AS ENUM ('dry_run','commit');
CREATE TYPE portal.import_format AS ENUM ('csv','xlsx');
CREATE TYPE portal.import_status AS ENUM
  ('uploaded','validating','validated','rejected','committing','committed','failed','cancelled','expired');
CREATE TYPE portal.row_outcome AS ENUM ('accepted','warning','rejected');

-- ---------- Helper: current session context (set by API per transaction) ----------
-- The API runs: SET LOCAL ROLE portal_<role>; SELECT set_config('app.user_id', ..., true); etc.
CREATE FUNCTION portal.cur_user_id() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id', true), '') $$;
CREATE FUNCTION portal.cur_center_id() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.center_id', true), '') $$;

CREATE FUNCTION portal.touch_updated_at() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

-- ---------- centers ----------
CREATE TABLE portal.centers (
  id               portal.ulid_text PRIMARY KEY CHECK (id LIKE 'ctr\_%'),
  code             text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9_]{2,32}$'),
  name_en          text NOT NULL,
  name_he          text NOT NULL,
  is_active        boolean NOT NULL DEFAULT true,
  contact_role     text NOT NULL,            -- role label, e.g. 'Center research coordinator'. Never a person.
  contact_channel  text,                     -- shared mailbox or portal route. Never a personal address.
  local_system_ref text,                     -- pointer to center RedCAP project. Reference only (REQ-039).
  feeds_regularly  boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_centers_touch BEFORE UPDATE ON portal.centers
  FOR EACH ROW EXECUTE FUNCTION portal.touch_updated_at();

-- ---------- users and role assignments ----------
-- Credentials (Argon2id hash, passkeys, TOTP secrets, sessions) live in schema authn,
-- owned by the auth-local adapter (A2). They are not modelled here.
CREATE TABLE portal.users (
  id            portal.ulid_text PRIMARY KEY CHECK (id LIKE 'usr\_%'),
  email         text NOT NULL CHECK (email = lower(email) AND position('@' IN email) > 1),
  display_name  text NOT NULL,
  locale        text NOT NULL DEFAULT 'he' CHECK (locale IN ('he','en')),
  status        portal.user_status NOT NULL DEFAULT 'invited',
  email_verified_at timestamptz,
  external_idp_subject text,                 -- Phase 2 SSO hook (OIDC 'sub'); NULL in Phase 1
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);
CREATE UNIQUE INDEX ux_users_email ON portal.users (email);
CREATE UNIQUE INDEX ux_users_idp ON portal.users (external_idp_subject) WHERE external_idp_subject IS NOT NULL;
CREATE TRIGGER trg_users_touch BEFORE UPDATE ON portal.users
  FOR EACH ROW EXECUTE FUNCTION portal.touch_updated_at();

CREATE TABLE portal.role_assignments (
  id          portal.ulid_text PRIMARY KEY CHECK (id LIKE 'rol\_%'),
  user_id     portal.ulid_text NOT NULL REFERENCES portal.users(id),
  role        portal.role_name NOT NULL CHECK (role <> 'anonymous'),
  center_id   portal.ulid_text REFERENCES portal.centers(id),
  granted_by  portal.ulid_text REFERENCES portal.users(id),
  granted_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz,
  -- center_clinician needs exactly one center. Other roles must not carry a center.
  CONSTRAINT ck_role_center CHECK (
    (role = 'center_clinician' AND center_id IS NOT NULL) OR
    (role <> 'center_clinician' AND center_id IS NULL)),
  -- Separation of duties: system_admin is never combined with data or decision roles (checked by trigger).
  CONSTRAINT ck_revoked_after_grant CHECK (revoked_at IS NULL OR revoked_at >= granted_at)
);
CREATE UNIQUE INDEX ux_role_active ON portal.role_assignments (user_id, role, coalesce(center_id,''))
  WHERE revoked_at IS NULL;
CREATE INDEX ix_role_user ON portal.role_assignments (user_id) WHERE revoked_at IS NULL;

CREATE FUNCTION portal.enforce_separation_of_duties() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.revoked_at IS NULL THEN
    IF NEW.role = 'system_admin' AND EXISTS (
         SELECT 1 FROM portal.role_assignments r
         WHERE r.user_id = NEW.user_id AND r.revoked_at IS NULL AND r.id <> NEW.id
           AND r.role IN ('committee_member','national_coordinator','center_clinician')) THEN
      RAISE EXCEPTION 'separation_of_duties: system_admin cannot hold data or decision roles' USING ERRCODE = '23514';
    END IF;
    IF NEW.role IN ('committee_member','national_coordinator','center_clinician') AND EXISTS (
         SELECT 1 FROM portal.role_assignments r
         WHERE r.user_id = NEW.user_id AND r.revoked_at IS NULL AND r.id <> NEW.id
           AND r.role = 'system_admin') THEN
      RAISE EXCEPTION 'separation_of_duties: system_admin cannot hold data or decision roles' USING ERRCODE = '23514';
    END IF;
    IF NEW.role = 'committee_member' AND EXISTS (
         SELECT 1 FROM portal.role_assignments r
         WHERE r.user_id = NEW.user_id AND r.revoked_at IS NULL AND r.id <> NEW.id
           AND r.role = 'national_coordinator') THEN
      RAISE EXCEPTION 'separation_of_duties: committee_member cannot edit the index' USING ERRCODE = '23514';
    END IF;
    IF NEW.role = 'national_coordinator' AND EXISTS (
         SELECT 1 FROM portal.role_assignments r
         WHERE r.user_id = NEW.user_id AND r.revoked_at IS NULL AND r.id <> NEW.id
           AND r.role = 'committee_member') THEN
      RAISE EXCEPTION 'separation_of_duties: committee_member cannot edit the index' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_role_sod BEFORE INSERT OR UPDATE ON portal.role_assignments
  FOR EACH ROW EXECUTE FUNCTION portal.enforce_separation_of_duties();

-- ---------- diagnosis vocabulary (data, not enum: changes with WHO updates) ----------
CREATE TABLE portal.diagnosis_terms (
  diagnosis_code  text PRIMARY KEY CHECK (diagnosis_code ~ '^[a-z][a-z0-9_]{2,63}$'),
  parent_code     text REFERENCES portal.diagnosis_terms(diagnosis_code),
  level           text NOT NULL CHECK (level IN ('group','family','type')),
  classification  text NOT NULL DEFAULT 'who_cns5',   -- see 02-diagnosis-coding.md
  who_edition     text NOT NULL DEFAULT 'CNS5-2021',
  icdo3_morph     text CHECK (icdo3_morph ~ '^[0-9]{4}/[0-9]$'),   -- reference only. Not unique. UNVERIFIED until A3 clinical review.
  label_en        text NOT NULL,
  label_he        text NOT NULL,
  is_selectable   boolean NOT NULL DEFAULT true,
  valid_from      date NOT NULL DEFAULT current_date,
  valid_to        date,
  CONSTRAINT ck_dx_parent CHECK ((level = 'group') = (parent_code IS NULL))
);
CREATE INDEX ix_dx_parent ON portal.diagnosis_terms (parent_code);
CREATE INDEX ix_dx_icdo ON portal.diagnosis_terms (icdo3_morph);

CREATE TABLE portal.diagnosis_synonyms (
  id             bigserial PRIMARY KEY,
  diagnosis_code text NOT NULL REFERENCES portal.diagnosis_terms(diagnosis_code) ON DELETE CASCADE,
  lang           text NOT NULL CHECK (lang IN ('he','en')),
  term           text NOT NULL,
  kind           text NOT NULL DEFAULT 'synonym' CHECK (kind IN ('synonym','abbreviation','legacy_name','spelling_variant')),
  UNIQUE (diagnosis_code, lang, term)
);

-- ---------- ethics approvals ----------
CREATE TABLE portal.ethics_approvals (
  id            portal.ulid_text PRIMARY KEY CHECK (id LIKE 'eth\_%'),
  center_id     portal.ulid_text NOT NULL REFERENCES portal.centers(id),
  approval_ref  text NOT NULL CHECK (approval_ref ~ '^[A-Za-z0-9._/-]{3,64}$'),  -- opaque approval ID only
  kind          portal.ethics_kind NOT NULL DEFAULT 'helsinki_committee',
  status        portal.ethics_status NOT NULL DEFAULT 'active',
  valid_from    date,
  valid_to      date,
  created_by    portal.ulid_text REFERENCES portal.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (center_id, approval_ref),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);
CREATE TRIGGER trg_eth_touch BEFORE UPDATE ON portal.ethics_approvals
  FOR EACH ROW EXECUTE FUNCTION portal.touch_updated_at();

-- ---------- samples ----------
CREATE TABLE portal.samples (
  id                    portal.ulid_text PRIMARY KEY CHECK (id LIKE 'smp\_%'),   -- = sample_code. Opaque. Never derived from patient data.
  source_center_id      portal.ulid_text NOT NULL REFERENCES portal.centers(id),
  diagnosis_code        text NOT NULL REFERENCES portal.diagnosis_terms(diagnosis_code),
  age_band_at_diagnosis portal.age_band NOT NULL,
  sex                   portal.sex NOT NULL,
  sample_type           portal.sample_type NOT NULL,
  availability          portal.availability NOT NULL,
  quantity_class        portal.quantity_class,
  clinical_timepoint    portal.clinical_timepoint NOT NULL,
  collection_month      char(7) NOT NULL CHECK (collection_month ~ '^(19[89][0-9]|20[0-9]{2})-(0[1-9]|1[0-2])$'),
  attached_data         portal.attached_data_type[] NOT NULL DEFAULT '{}',   -- denormalised from sample_attached_data (trigger)
  consent_status        portal.consent_status NOT NULL DEFAULT 'unknown',
  ethics_approval_id    portal.ulid_text REFERENCES portal.ethics_approvals(id),
  contact_ref           text NOT NULL,                                       -- center contact ROLE label
  source_system         text NOT NULL DEFAULT 'portal_entry' CHECK (source_system IN ('portal_entry','csv_import','madgam','redcap_ref')),
  is_synthetic          boolean NOT NULL DEFAULT true,                       -- must be false only after GATE-PROD-DATA
  created_by            portal.ulid_text REFERENCES portal.users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  last_verified_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz,                                         -- soft delete; hard purge by retention job
  CONSTRAINT ck_sample_not_deleted_available CHECK (deleted_at IS NULL OR availability <> 'available')
);
CREATE TRIGGER trg_samples_touch BEFORE UPDATE ON portal.samples
  FOR EACH ROW EXECUTE FUNCTION portal.touch_updated_at();

-- Ethics approval must belong to the same center as the sample.
CREATE FUNCTION portal.check_sample_ethics_center() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.ethics_approval_id IS NOT NULL AND NOT EXISTS (
     SELECT 1 FROM portal.ethics_approvals e
     WHERE e.id = NEW.ethics_approval_id AND e.center_id = NEW.source_center_id) THEN
    RAISE EXCEPTION 'ethics_center_mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_samples_ethics BEFORE INSERT OR UPDATE OF ethics_approval_id, source_center_id ON portal.samples
  FOR EACH ROW EXECUTE FUNCTION portal.check_sample_ethics_center();

-- Indexes (facets + staleness + entry).
CREATE INDEX ix_samples_center        ON portal.samples (source_center_id) WHERE deleted_at IS NULL;
CREATE INDEX ix_samples_dx            ON portal.samples (diagnosis_code)   WHERE deleted_at IS NULL;
CREATE INDEX ix_samples_type_avail    ON portal.samples (sample_type, availability) WHERE deleted_at IS NULL;
CREATE INDEX ix_samples_age_sex_tp    ON portal.samples (age_band_at_diagnosis, sex, clinical_timepoint) WHERE deleted_at IS NULL;
CREATE INDEX ix_samples_attached_gin  ON portal.samples USING gin (attached_data) WHERE deleted_at IS NULL;
CREATE INDEX ix_samples_verified      ON portal.samples (source_center_id, last_verified_at) WHERE deleted_at IS NULL;
CREATE INDEX ix_samples_ethics        ON portal.samples (ethics_approval_id);

-- ---------- attached-data flags ----------
CREATE TABLE portal.sample_attached_data (
  sample_id    portal.ulid_text NOT NULL REFERENCES portal.samples(id) ON DELETE CASCADE,
  data_type    portal.attached_data_type NOT NULL,
  is_available boolean NOT NULL DEFAULT true,
  reference_kind text CHECK (reference_kind IN ('none','redcap_pointer','object_store_key','external_repo_pointer')) DEFAULT 'none',
  reference_ref  text,       -- opaque pointer. No URL with identifiers. Genomics: flag only (GATE-GENOMICS).
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sample_id, data_type),
  CHECK (data_type <> 'wgs' OR reference_kind IN ('none','external_repo_pointer'))
);

CREATE FUNCTION portal.sync_attached_data() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE sid text := coalesce(NEW.sample_id, OLD.sample_id);
BEGIN
  UPDATE portal.samples s
     SET attached_data = coalesce((SELECT array_agg(a.data_type ORDER BY a.data_type)
                                   FROM portal.sample_attached_data a
                                   WHERE a.sample_id = sid AND a.is_available), '{}')
   WHERE s.id = sid;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_attached_sync AFTER INSERT OR UPDATE OR DELETE ON portal.sample_attached_data
  FOR EACH ROW EXECUTE FUNCTION portal.sync_attached_data();

-- ---------- staleness ----------
CREATE TABLE portal.staleness_policies (
  id          serial PRIMARY KEY,
  center_id   portal.ulid_text REFERENCES portal.centers(id),   -- NULL = default policy
  sla_days    int NOT NULL CHECK (sla_days BETWEEN 30 AND 730),
  warn_days   int NOT NULL CHECK (warn_days >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (warn_days < sla_days)
);
CREATE UNIQUE INDEX ux_staleness_scope ON portal.staleness_policies (coalesce(center_id,'*'));
INSERT INTO portal.staleness_policies (center_id, sla_days, warn_days) VALUES (NULL, 180, 30);

CREATE VIEW portal.v_sample_staleness AS
SELECT s.id AS sample_id,
       s.source_center_id,
       s.last_verified_at,
       p.sla_days,
       (s.last_verified_at + make_interval(days => p.sla_days)) AS due_at,
       CASE
         WHEN now() > s.last_verified_at + make_interval(days => p.sla_days) THEN 'stale'
         WHEN now() > s.last_verified_at + make_interval(days => p.sla_days - p.warn_days) THEN 'due_soon'
         ELSE 'fresh'
       END AS staleness
FROM portal.samples s
JOIN LATERAL (
  SELECT sla_days, warn_days FROM portal.staleness_policies sp
  WHERE sp.center_id = s.source_center_id OR sp.center_id IS NULL
  ORDER BY (sp.center_id IS NULL) LIMIT 1) p ON true
WHERE s.deleted_at IS NULL;

CREATE TABLE portal.staleness_reminders (
  id            bigserial PRIMARY KEY,
  center_id     portal.ulid_text NOT NULL REFERENCES portal.centers(id),
  generated_at  timestamptz NOT NULL DEFAULT now(),
  due_soon_count int NOT NULL,
  stale_count   int NOT NULL,
  acknowledged_by portal.ulid_text REFERENCES portal.users(id),
  acknowledged_at timestamptz
);
CREATE INDEX ix_stale_rem_center ON portal.staleness_reminders (center_id, generated_at DESC);

-- ---------- k-anonymity configuration (rules owned by A2; value is data) ----------
CREATE TABLE portal.k_policies (
  field_set   text PRIMARY KEY,              -- 'default', 'diagnosis', 'center', ...
  k           int NOT NULL CHECK (k >= 2),
  updated_by  portal.ulid_text REFERENCES portal.users(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO portal.k_policies (field_set, k) VALUES ('default', 5);   -- GATE-K default

-- ---------- requests ----------
CREATE TABLE portal.requests (
  id                 portal.ulid_text PRIMARY KEY CHECK (id LIKE 'req\_%'),
  applicant_user_id  portal.ulid_text NOT NULL REFERENCES portal.users(id),
  status             portal.request_status NOT NULL DEFAULT 'draft',
  research_question  text,          -- applicant text. Not patient data. Max 4000 chars. Scanned for identifiers on submit.
  applicant_ethics_ref text,        -- applicant IRB/Helsinki approval ID (REQ-035)
  planned_use        text,
  funding_sources    text,
  idempotency_key    text,
  submitted_at       timestamptz,
  decided_at         timestamptz,
  delivered_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (char_length(research_question) <= 4000),
  CHECK (char_length(planned_use) <= 4000),
  CHECK (status = 'draft' OR (research_question IS NOT NULL AND applicant_ethics_ref IS NOT NULL
                              AND planned_use IS NOT NULL AND funding_sources IS NOT NULL))
);
CREATE UNIQUE INDEX ux_req_idem ON portal.requests (applicant_user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX ix_req_status ON portal.requests (status, submitted_at);
CREATE INDEX ix_req_applicant ON portal.requests (applicant_user_id, created_at DESC);
CREATE TRIGGER trg_req_touch BEFORE UPDATE ON portal.requests
  FOR EACH ROW EXECUTE FUNCTION portal.touch_updated_at();

-- Cart items hold aggregate CRITERIA, not sample ids. The applicant never sees sample rows.
CREATE TABLE portal.request_items (
  id             portal.ulid_text PRIMARY KEY CHECK (id LIKE 'rit\_%'),
  request_id     portal.ulid_text NOT NULL REFERENCES portal.requests(id) ON DELETE CASCADE,
  criteria       jsonb NOT NULL,                 -- same filter object as the search API
  requested_count int CHECK (requested_count > 0),
  shown_count_bucket text,                       -- k-safe count text shown at add time, e.g. '10-19'
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_ritem_req ON portal.request_items (request_id);

-- Coordinator resolves criteria to concrete samples. Applicant has no access.
CREATE TABLE portal.request_item_samples (
  request_item_id portal.ulid_text NOT NULL REFERENCES portal.request_items(id) ON DELETE CASCADE,
  sample_id       portal.ulid_text NOT NULL REFERENCES portal.samples(id),
  resolved_by     portal.ulid_text REFERENCES portal.users(id),
  resolved_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_item_id, sample_id)
);
CREATE INDEX ix_ris_sample ON portal.request_item_samples (sample_id);

CREATE TABLE portal.request_steps (
  id             portal.ulid_text PRIMARY KEY CHECK (id LIKE 'stp\_%'),
  request_id     portal.ulid_text NOT NULL REFERENCES portal.requests(id) ON DELETE CASCADE,
  step_key       portal.step_key NOT NULL,
  center_id      portal.ulid_text REFERENCES portal.centers(id),   -- for center_coordination steps
  status         portal.step_status NOT NULL DEFAULT 'pending',
  actor_user_id  portal.ulid_text REFERENCES portal.users(id),
  public_note    text CHECK (char_length(public_note) <= 1000),    -- visible to applicant (REQ-036)
  internal_note  text CHECK (char_length(internal_note) <= 2000),  -- coordinator/committee only
  started_at     timestamptz,
  completed_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, step_key, center_id)
);
CREATE INDEX ix_rstep_req ON portal.request_steps (request_id);
CREATE INDEX ix_rstep_center ON portal.request_steps (center_id) WHERE center_id IS NOT NULL;

CREATE TABLE portal.committee_config (
  id          smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  votes_needed int NOT NULL DEFAULT 2 CHECK (votes_needed >= 1),   -- N  (ASSUMPTION-04)
  members_total int NOT NULL DEFAULT 3 CHECK (members_total >= votes_needed), -- M
  criteria_json jsonb NOT NULL DEFAULT '[]'::jsonb,   -- approval criteria are data (GATE-COMMITTEE)
  updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO portal.committee_config DEFAULT VALUES;

CREATE TABLE portal.request_decisions (
  id             portal.ulid_text PRIMARY KEY CHECK (id LIKE 'dec\_%'),
  request_id     portal.ulid_text NOT NULL REFERENCES portal.requests(id) ON DELETE CASCADE,
  outcome        portal.decision_outcome NOT NULL,
  rationale      text CHECK (char_length(rationale) <= 2000),
  criteria_snapshot jsonb,
  decided_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, decided_at)
);
CREATE INDEX ix_dec_req ON portal.request_decisions (request_id);

CREATE TABLE portal.request_votes (
  id             portal.ulid_text PRIMARY KEY CHECK (id LIKE 'vot\_%'),
  request_id     portal.ulid_text NOT NULL REFERENCES portal.requests(id) ON DELETE CASCADE,
  voter_user_id  portal.ulid_text NOT NULL REFERENCES portal.users(id),
  vote           portal.vote_value NOT NULL,
  comment        text CHECK (char_length(comment) <= 1000),
  voted_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, voter_user_id)
);
CREATE INDEX ix_vote_req ON portal.request_votes (request_id);

CREATE TABLE portal.idempotency_keys (
  user_id      portal.ulid_text NOT NULL REFERENCES portal.users(id),
  key          text NOT NULL CHECK (char_length(key) BETWEEN 8 AND 128),
  method_path  text NOT NULL,
  request_hash bytea NOT NULL,
  response_status int,
  response_ref text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

-- ---------- import jobs ----------
CREATE TABLE portal.import_jobs (
  id             portal.ulid_text PRIMARY KEY CHECK (id LIKE 'imp\_%'),
  created_by     portal.ulid_text NOT NULL REFERENCES portal.users(id),
  center_id      portal.ulid_text REFERENCES portal.centers(id),   -- NULL when file spans centers
  mode           portal.import_mode NOT NULL DEFAULT 'dry_run',
  format         portal.import_format NOT NULL,
  status         portal.import_status NOT NULL DEFAULT 'uploaded',
  schema_version text NOT NULL DEFAULT 'v1',
  file_name_safe text NOT NULL CHECK (file_name_safe ~ '^[A-Za-z0-9._-]{1,100}$'),
  staging_key    text,                         -- ObjectStorePort key. Purged at expires_at.
  file_sha256    bytea,
  parent_job_id  portal.ulid_text REFERENCES portal.import_jobs(id),  -- commit job points to its validated dry run
  total_rows     int,
  accepted_rows  int,
  warning_rows   int,
  rejected_rows  int,
  report_key     text,                         -- rejection report in object store
  result_map_key text,                         -- row_no -> sample_code mapping file (purged after 30 days)
  created_at     timestamptz NOT NULL DEFAULT now(),
  started_at     timestamptz,
  finished_at    timestamptz,
  expires_at     timestamptz NOT NULL DEFAULT now() + interval '30 days'
);
CREATE INDEX ix_imp_user ON portal.import_jobs (created_by, created_at DESC);
CREATE INDEX ix_imp_status ON portal.import_jobs (status) WHERE status IN ('uploaded','validating','committing');

-- Row results hold row number, field names and rule codes. NEVER raw cell values.
CREATE TABLE portal.import_job_rows (
  job_id     portal.ulid_text NOT NULL REFERENCES portal.import_jobs(id) ON DELETE CASCADE,
  row_no     int NOT NULL CHECK (row_no >= 1),
  outcome    portal.row_outcome NOT NULL,
  sample_id  portal.ulid_text REFERENCES portal.samples(id),
  action     text CHECK (action IN ('create','update','verify_only','none')),
  issues     jsonb NOT NULL DEFAULT '[]'::jsonb,    -- [{"field":"sex","rule":"VOCAB","severity":"error"}]
  PRIMARY KEY (job_id, row_no)
);
CREATE INDEX ix_impr_outcome ON portal.import_job_rows (job_id, outcome);

-- ---------- audit (hash chain) ----------
CREATE TABLE audit.chain_head (
  id        smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_seq  bigint NOT NULL DEFAULT 0,
  last_hash bytea NOT NULL DEFAULT '\x00'::bytea
);
INSERT INTO audit.chain_head DEFAULT VALUES;

CREATE TABLE audit.audit_events (
  seq          bigint PRIMARY KEY,
  id           portal.ulid_text NOT NULL UNIQUE CHECK (id LIKE 'aud\_%'),
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  actor_user_id text,                          -- plain text: survives user deletion
  actor_role   text,
  action       text NOT NULL CHECK (action ~ '^[a-z_]+\.[a-z_]+$'),   -- e.g. sample.view, export.download, request.approve
  object_type  text,
  object_id    text,
  center_id    text,
  outcome      text NOT NULL CHECK (outcome IN ('success','denied','error')),
  trace_id     text,
  details      jsonb NOT NULL DEFAULT '{}'::jsonb,   -- ids and codes only. No free text. No identifiers.
  prev_hash    bytea NOT NULL,
  hash         bytea NOT NULL
);
CREATE INDEX ix_aud_time   ON audit.audit_events (occurred_at DESC);
CREATE INDEX ix_aud_actor  ON audit.audit_events (actor_user_id, occurred_at DESC);
CREATE INDEX ix_aud_object ON audit.audit_events (object_type, object_id, occurred_at DESC);
CREATE INDEX ix_aud_action ON audit.audit_events (action, occurred_at DESC);

-- Append function: the only write path. Serialises on chain_head.
CREATE FUNCTION audit.append(
  p_id text, p_actor text, p_role text, p_action text, p_object_type text,
  p_object_id text, p_center text, p_outcome text, p_trace text, p_details jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = audit, pg_catalog AS $$
DECLARE h audit.chain_head%ROWTYPE; v_seq bigint; v_prev bytea; v_hash bytea; v_ts timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO h FROM audit.chain_head WHERE id = 1 FOR UPDATE;
  v_seq := h.last_seq + 1;
  v_prev := h.last_hash;
  v_hash := sha256(
    v_prev ||
    convert_to(concat_ws('|', v_seq, p_id, to_char(v_ts AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      coalesce(p_actor,''), coalesce(p_role,''), p_action, coalesce(p_object_type,''),
      coalesce(p_object_id,''), coalesce(p_center,''), p_outcome, coalesce(p_trace,''),
      coalesce(p_details::text,'{}')), 'UTF8'));
  INSERT INTO audit.audit_events (seq,id,occurred_at,actor_user_id,actor_role,action,object_type,object_id,
                                  center_id,outcome,trace_id,details,prev_hash,hash)
  VALUES (v_seq,p_id,v_ts,p_actor,p_role,p_action,p_object_type,p_object_id,p_center,p_outcome,p_trace,
          coalesce(p_details,'{}'::jsonb),v_prev,v_hash);
  UPDATE audit.chain_head SET last_seq = v_seq, last_hash = v_hash WHERE id = 1;
  RETURN v_seq;
END $$;

CREATE FUNCTION audit.block_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit_events is append-only' USING ERRCODE = '42501'; END $$;
CREATE TRIGGER trg_audit_no_update BEFORE UPDATE OR DELETE ON audit.audit_events
  FOR EACH ROW EXECUTE FUNCTION audit.block_mutation();
CREATE TRIGGER trg_audit_no_truncate BEFORE TRUNCATE ON audit.audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION audit.block_mutation();

-- Verification: returns first broken seq, or NULL when the chain is intact.
-- Note: jsonb text form is canonical in PG, so recomputation is stable.
CREATE FUNCTION audit.verify_chain(p_from bigint DEFAULT 1, p_to bigint DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = audit, pg_catalog AS $$
DECLARE r audit.audit_events%ROWTYPE; prev bytea; calc bytea; first boolean := true;
BEGIN
  FOR r IN SELECT * FROM audit.audit_events
           WHERE seq >= p_from AND (p_to IS NULL OR seq <= p_to) ORDER BY seq LOOP
    IF first THEN
      IF p_from > 1 THEN
        SELECT hash INTO prev FROM audit.audit_events WHERE seq = p_from - 1;
      ELSE prev := '\x00'::bytea; END IF;
      first := false;
    END IF;
    calc := sha256(prev || convert_to(concat_ws('|', r.seq, r.id,
      to_char(r.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      coalesce(r.actor_user_id,''), coalesce(r.actor_role,''), r.action, coalesce(r.object_type,''),
      coalesce(r.object_id,''), coalesce(r.center_id,''), r.outcome, coalesce(r.trace_id,''),
      coalesce(r.details::text,'{}')), 'UTF8'));
    IF r.prev_hash <> prev OR r.hash <> calc THEN RETURN r.seq; END IF;
    prev := r.hash;
  END LOOP;
  RETURN NULL;
END $$;
