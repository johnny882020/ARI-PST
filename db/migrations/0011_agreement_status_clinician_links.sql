-- 0011 MTA/DTA status with a month-level signed date, and the holding center's read of its own linked samples. kind: expand
-- * request_agreements gets status (draft | sent | signed) and signed_month (YYYY-MM only, never an exact date).
--   Existing rows and the old 4-argument call stay valid: they mean "signed" in the month the row was recorded.
-- * request_start_delivery now needs a SIGNED agreement for every accepted center (a draft or sent one is not enough).
-- * center_clinician may read request_item_samples of its own center only (to prepare the delivery). No other change in reach.
ALTER TABLE portal.request_agreements
  ADD COLUMN status text NOT NULL DEFAULT 'signed' CHECK (status IN ('draft','sent','signed')),
  ADD COLUMN signed_month text CHECK (signed_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
-- The table has FORCE ROW LEVEL SECURITY and app_migrator has no policy on it: as app_migrator this UPDATE would change 0 rows and the
-- CHECK below would fail on any existing agreement. Backfill as app_core (policy core_all).
SET LOCAL ROLE app_core;
UPDATE portal.request_agreements SET signed_month = to_char(signed_at AT TIME ZONE 'UTC', 'YYYY-MM') WHERE signed_month IS NULL;
RESET ROLE;
ALTER TABLE portal.request_agreements ADD CONSTRAINT agr_signed_needs_month CHECK (status <> 'signed' OR signed_month IS NOT NULL);

CREATE FUNCTION portal.request_record_agreement(p_id text, p_center_id text, p_kind text, p_doc_ref text, p_status text, p_signed_month text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, portal, pg_temp AS $$
BEGIN
  PERFORM portal._require_role('national_coordinator');
  IF (SELECT status FROM portal.requests WHERE id = p_id) <> 'agreements' THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE = '23514'; END IF;
  IF NOT EXISTS (SELECT 1 FROM portal.request_steps WHERE request_id = p_id AND step_key = 'center_coordination' AND center_id = p_center_id AND accepted) THEN
    RAISE EXCEPTION 'center_not_involved' USING ERRCODE = '23514'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('draft','sent','signed') THEN RAISE EXCEPTION 'invalid_agreement_status' USING ERRCODE = '22023'; END IF;
  IF p_status = 'signed' AND p_signed_month IS NULL THEN RAISE EXCEPTION 'signed_month_required' USING ERRCODE = '23514'; END IF;
  IF p_signed_month IS NOT NULL AND p_signed_month > to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM') THEN
    RAISE EXCEPTION 'signed_month_in_future' USING ERRCODE = '23514'; END IF;
  INSERT INTO portal.request_agreements (request_id, center_id, kind, doc_ref, recorded_by, status, signed_month)
    VALUES (p_id, p_center_id, p_kind, p_doc_ref, portal.cur_user_id(), p_status, p_signed_month)
    ON CONFLICT (request_id, center_id, kind) DO UPDATE SET doc_ref = EXCLUDED.doc_ref, signed_at = now(), recorded_by = EXCLUDED.recorded_by,
      status = EXCLUDED.status, signed_month = EXCLUDED.signed_month;
  PERFORM audit.record('request.mta_status', 'request', p_id, 'allow', jsonb_build_object('center', p_center_id, 'kind', p_kind, 'status', p_status));
END $$;

-- Replacing definer functions: as their owner (0001 pattern), with temporary CREATE on the schema.
GRANT CREATE ON SCHEMA portal TO app_core;
SET LOCAL ROLE app_core;
CREATE OR REPLACE FUNCTION portal.request_record_agreement(p_id text, p_center_id text, p_kind text, p_doc_ref text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, portal, pg_temp AS $$
BEGIN
  PERFORM portal.request_record_agreement(p_id, p_center_id, p_kind, p_doc_ref, 'signed', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM'));
END $$;
CREATE OR REPLACE FUNCTION portal.request_start_delivery(p_id text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, portal, pg_temp AS $$
BEGIN
  PERFORM portal._require_role('national_coordinator');
  IF EXISTS (SELECT 1 FROM portal.request_steps s WHERE s.request_id = p_id AND s.step_key = 'center_coordination' AND s.accepted
             AND NOT EXISTS (SELECT 1 FROM portal.request_agreements a WHERE a.request_id = p_id AND a.center_id = s.center_id AND a.status = 'signed')) THEN
    RAISE EXCEPTION 'agreements_missing' USING ERRCODE = '23514'; END IF;
  PERFORM portal._transition(p_id, 'delivery', 'national_coordinator');
  INSERT INTO portal.request_steps (id, request_id, step_key, center_id, started_at)
    SELECT portal.new_id('stp'), p_id, 'delivery', s.center_id, now() FROM portal.request_steps s
     WHERE s.request_id = p_id AND s.step_key = 'center_coordination' AND s.accepted;
END $$;
RESET ROLE;
REVOKE CREATE ON SCHEMA portal FROM app_core;

CREATE POLICY ris_clin_r ON portal.request_item_samples FOR SELECT TO app_runtime
  USING ((SELECT portal.cur_role()) = 'center_clinician' AND center_id = (SELECT portal.cur_center_id()));

SELECT portal._assign_owners();
SET LOCAL ROLE app_core;
GRANT EXECUTE ON FUNCTION portal.request_record_agreement(text,text,text,text,text,text) TO app_runtime;
RESET ROLE;
