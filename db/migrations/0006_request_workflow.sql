-- 0006 access-request state machine and N-of-M voting, enforced in the database (RT-03, RT-20, RT-26). kind: expand
CREATE TABLE portal.request_transition_rules (
  from_state portal.request_status NOT NULL, to_state portal.request_status NOT NULL, actor_role text NOT NULL,
  PRIMARY KEY (from_state, to_state, actor_role));
INSERT INTO portal.request_transition_rules VALUES
 ('draft','submitted','researcher_il'),
 ('submitted','precheck','national_coordinator'),('submitted','precheck','system'),
 ('precheck','needs_info','national_coordinator'),('precheck','committee_review','national_coordinator'),
 ('needs_info','precheck','researcher_il'),
 ('committee_review','needs_info','committee_member'),
 ('committee_review','approved','system'),('committee_review','rejected','system'),
 ('rejected','appeal_review','researcher_il'),
 ('appeal_review','approved','system'),
 ('approved','center_coordination','national_coordinator'),
 ('center_coordination','agreements','system'),
 ('agreements','delivery','national_coordinator'),
 ('precheck','closed','national_coordinator'),
 ('appeal_review','closed','system'),('center_coordination','closed','system'),('delivery','closed','system');
-- withdraw (applicant), expire / window end (system), policy cancel (coordinator, admin) from every non-terminal state
INSERT INTO portal.request_transition_rules
SELECT s, 'closed', a FROM unnest(enum_range(NULL::portal.request_status)) s,
       unnest(ARRAY['researcher_il','system','national_coordinator','system_admin']) a
WHERE s <> 'closed' ON CONFLICT DO NOTHING;
GRANT SELECT ON portal.request_transition_rules TO app_core, app_runtime;

CREATE FUNCTION portal.guard_requests() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF current_user <> 'app_core' OR NEW.status <> 'draft' THEN RAISE EXCEPTION 'requests_created_via_function_only' USING ERRCODE = '42501'; END IF;
    RETURN NEW;
  END IF;
  IF current_user <> 'app_core' THEN
    IF (NEW.status, NEW.close_reason, NEW.close_detail, NEW.applicant_user_id, NEW.submitted_at, NEW.decided_at, NEW.delivered_at, NEW.closed_at,
        NEW.state_entered_at, NEW.reached_committee, NEW.appeal_count, NEW.info_rounds, NEW.on_hold, NEW.text_wiped_at, NEW.id, NEW.idempotency_key)
       IS DISTINCT FROM
       (OLD.status, OLD.close_reason, OLD.close_detail, OLD.applicant_user_id, OLD.submitted_at, OLD.decided_at, OLD.delivered_at, OLD.closed_at,
        OLD.state_entered_at, OLD.reached_committee, OLD.appeal_count, OLD.info_rounds, OLD.on_hold, OLD.text_wiped_at, OLD.id, OLD.idempotency_key) THEN
      RAISE EXCEPTION 'state_change_via_functions_only' USING ERRCODE = '42501'; END IF;
    IF OLD.status NOT IN ('draft','needs_info') AND
       (NEW.research_question, NEW.applicant_ethics_ref, NEW.planned_use, NEW.funding_sources) IS DISTINCT FROM
       (OLD.research_question, OLD.applicant_ethics_ref, OLD.planned_use, OLD.funding_sources) THEN
      RAISE EXCEPTION 'request_form_locked' USING ERRCODE = '42501'; END IF;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status = 'closed' THEN RAISE EXCEPTION 'closed_is_terminal' USING ERRCODE = '42501'; END IF;
    IF NOT EXISTS (SELECT 1 FROM portal.request_transition_rules r WHERE r.from_state = OLD.status AND r.to_state = NEW.status) THEN
      RAISE EXCEPTION 'invalid_transition' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_requests_guard BEFORE INSERT OR UPDATE ON portal.requests FOR EACH ROW EXECUTE FUNCTION portal.guard_requests();
CREATE FUNCTION portal.block_delete_except_core() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user <> 'app_core' THEN RAISE EXCEPTION 'append_only' USING ERRCODE = '42501'; END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER trg_votes_ro BEFORE UPDATE OR DELETE ON portal.request_votes FOR EACH ROW EXECUTE FUNCTION portal.block_delete_except_core();
CREATE TRIGGER trg_events_ro BEFORE UPDATE OR DELETE ON portal.request_events FOR EACH ROW EXECUTE FUNCTION portal.block_delete_except_core();
CREATE TRIGGER trg_decisions_ro BEFORE UPDATE OR DELETE ON portal.request_decisions FOR EACH ROW EXECUTE FUNCTION portal.block_delete_except_core();

-- single internal path for every state change
CREATE FUNCTION portal._transition(p_id text, p_to portal.request_status, p_actor_role text, p_reason text DEFAULT NULL,
  p_note text DEFAULT NULL, p_close portal.close_reason DEFAULT NULL, p_detail text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, portal, pg_temp AS $$
DECLARE r portal.requests%ROWTYPE;
BEGIN
  SELECT * INTO r FROM portal.requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  IF NOT EXISTS (SELECT 1 FROM portal.request_transition_rules x WHERE x.from_state = r.status AND x.to_state = p_to AND x.actor_role = p_actor_role) THEN
    RAISE EXCEPTION 'invalid_transition' USING ERRCODE = '23514'; END IF;
  UPDATE portal.requests SET status = p_to, state_entered_at = now(),
    close_reason = CASE WHEN p_to = 'closed' THEN p_close END, close_detail = CASE WHEN p_to = 'closed' THEN p_detail END,
    submitted_at = CASE WHEN p_to = 'submitted' THEN now() ELSE submitted_at END,
    decided_at = CASE WHEN p_to IN ('approved','rejected') THEN now() ELSE decided_at END,
    delivered_at = CASE WHEN p_to = 'closed' AND p_close = 'delivered' THEN now() ELSE delivered_at END,
    closed_at = CASE WHEN p_to = 'closed' THEN now() ELSE closed_at END,
    reached_committee = reached_committee OR p_to = 'committee_review',
    appeal_count = appeal_count + CASE WHEN p_to = 'appeal_review' THEN 1 ELSE 0 END,
    info_rounds = info_rounds + CASE WHEN p_to = 'needs_info' THEN 1 ELSE 0 END
   WHERE id = p_id;
  INSERT INTO portal.request_events (request_id, from_state, to_state, actor_user_id, actor_role, reason_code, public_note)
    VALUES (p_id, r.status, p_to, portal.cur_user_id(), p_actor_role, p_reason, p_note);
  PERFORM audit.record('request.state_changed', 'request', p_id, 'allow',
     jsonb_build_object('from', r.status, 'to', p_to, 'actor_role', p_actor_role, 'close_reason', p_close));
END $$;

CREATE FUNCTION portal._own_request(p_id text, OUT r portal.requests) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, portal, pg_temp AS $$
BEGIN
  PERFORM portal._require_role('researcher_il');
  SELECT * INTO r FROM portal.requests WHERE id = p_id AND applicant_user_id = portal.cur_user_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
END $$;

CREATE FUNCTION portal.request_create(p_idempotency_key text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, portal, pg_temp AS $$
DECLARE v_id text; me text := portal.cur_user_id();
BEGIN
  PERFORM portal._require_role('researcher_il');
  SELECT id INTO v_id FROM portal.requests WHERE applicant_user_id = me AND idempotency_key = p_idempotency_key;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  v_id := portal.new_id('req');
  INSERT INTO portal.requests (id, applicant_user_id, idempotency_key) VALUES (v_id, me, p_idempotency_key);
  INSERT INTO portal.request_events (request_id, to_state, actor_user_id, actor_role) VALUES (v_id, 'draft', me, 'researcher_il');
  PERFORM audit.record('request.create', 'request', v_id);
  RETURN v_id;
END $$;

CREATE FUNCTION portal.request_submit(p_id text, p_idempotency_key text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, portal, pg_temp AS $$
DECLARE r portal.requests;
BEGIN
  r := portal._own_request(p_id);
  IF p_idempotency_key IS NULL OR char_length(p_idempotency_key) < 8 THEN RAISE EXCEPTION 'idempotency_key_required' USING ERRCODE = '22023'; END IF;
  IF r.status <> 'draft' THEN RETURN r.status::text; END IF;   -- duplicate submit returns the current state
  IF r.research_question IS NULL OR r.applicant_ethics_ref IS NULL OR r.planned_use IS NULL OR r.funding_sources IS NULL
     OR NOT EXISTS (SELECT 1 FROM portal.request_items WHERE request_id = p_id) THEN RAISE EXCEPTION 'form_incomplete' USING ERRCODE = '23514'; END IF;
  PERFORM portal._transition(p_id, 'submitted', 'researcher_il');
  IF EXISTS (SELECT 1 FROM portal.role_assignments WHERE role = 'national_coordinator' AND revoked_at IS NULL) THEN
    PERFORM portal._transition(p_id, 'precheck', 'system'); RETURN 'precheck';
  END IF;
  RETURN 'submitted';
END $$;
CREATE FUNCTION portal.request_start_precheck(p_id text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, portal, pg_temp AS $$
BEGIN
  PERFORM portal._require_role('national_coordinator');
  PERFORM portal._transition(p_id, 'precheck', 'national_coordinator');
END $$;

CREATE FUNCTION portal.request_ask_info(p_id text, p_reason_code text, p_public_note text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, portal, pg_temp AS $$
DECLARE role_ text := portal._require_role('national_coordinator','committee_member'); r portal.requests; maxr int;
BEGIN
  SELECT * INTO r FROM portal.requests WHERE id = p_id;
  IF r.applicant_user_id = portal.cur_user_id() THEN RAISE EXCEPTION 'conflict_own_request' USING ERRCODE = '42501'; END IF;
  SELECT (value #>> '{}')::int INTO maxr FROM portal.workflow_config WHERE key = 'request.info_rounds_max' AND scope = 'global';
  IF r.info_rounds >= coalesce(maxr, 3) THEN RAISE EXCEPTION 'info_rounds_exhausted' USING ERRCODE = '23514'; END IF;
  PERFORM portal._transition(p_id, 'needs_info', role_, p_reason_code, p_public_note);
END $$;
CREATE FUNCTION portal.request_respond_info(p_id text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, portal, pg_temp AS $$
DECLARE r portal.requests;
BEGIN
  r := portal._own_request(p_id);
  PERFORM portal._transition(p_id, 'precheck', 'researcher_il', 'info_provided');
END $$;
CREATE FUNCTION portal.request_precheck_pass(p_id text, p_checklist jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, portal, pg_temp AS $$
DECLARE k text; r portal.requests;
BEGIN
  PERFORM portal._require_role('national_coordinator');
  SELECT * INTO r FROM portal.requests WHERE id = p_id;
  IF r.applicant_user_id = portal.cur_user_id() THEN RAISE EXCEPTION 'conflict_own_request' USING ERRCODE = '42501'; END IF;
  FOREACH k IN ARRAY ARRAY['form_complete','irb_ref_plausible','consent_scope_ok','no_identifier_requested','items_exist'] LOOP
    IF coalesce(p_checklist ->> k, 'false') <> 'true' THEN RAISE EXCEPTION 'checklist_incomplete' USING ERRCODE = '23514'; END IF;
  END LOOP;
  PERFORM portal._transition(p_id, 'committee_review', 'national_coordinator', 'precheck_passed');
  PERFORM audit.record('request.precheck', 'request', p_id);
END $$;
CREATE FUNCTION portal.request_precheck_reject(p_id text, p_reason_code text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, portal, pg_temp AS $$
BEGIN
  PERFORM portal._require_role('national_coordinator');
  IF p_reason_code IS NULL THEN RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023'; END IF;
  IF (SELECT status FROM portal.requests WHERE id = p_id) <> 'precheck' THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE = '23514'; END IF;
  PERFORM portal._transition(p_id, 'closed', 'national_coordinator', p_reason_code, NULL, 'rejected', 'precheck_failed');
END $$;
CREATE FUNCTION portal.request_withdraw(p_id text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, portal, pg_temp AS $$
DECLARE r portal.requests;
BEGIN
  r := portal._own_request(p_id);
  PERFORM portal._transition(p_id, 'closed', 'researcher_il', 'withdrawn', NULL, 'withdrawn');
END $$;
CREATE FUNCTION portal.request_cancel_policy(p_id text, p_detail text DEFAULT 'policy') RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, portal, pg_temp AS $$
DECLARE role_ text := portal._require_role('national_coordinator','system_admin');
BEGIN
  PERFORM portal._transition(p_id, 'closed', role_, 'policy_cancelled', NULL, 'policy_cancelled', left(coalesce(p_detail,'policy'),40));
END $$;

-- Committee voting. One vote per member per round. Quorum evaluated inside the vote transaction under a row lock.
CREATE FUNCTION portal.request_declare_conflict(p_id text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, portal, pg_temp AS $$
BEGIN
  PERFORM portal._require_role('committee_member');
  INSERT INTO portal.request_recusals (request_id, user_id) VALUES (p_id, portal.cur_user_id()) ON CONFLICT DO NOTHING;
END $$;
CREATE FUNCTION portal.request_cast_vote(p_id text, p_vote text, p_rationale_code text DEFAULT NULL, p_comment text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, portal, pg_temp AS $$
DECLARE r portal.requests; me text := portal.cur_user_id(); v_round portal.vote_round; cfg portal.committee_config%ROWTYPE;
        n_app int; n_rej int; eligible int; initial_voters int; me_voted_initial boolean; v_dec text;
BEGIN
  PERFORM portal._require_role('committee_member');
  SELECT * INTO r FROM portal.requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  IF r.status = 'committee_review' THEN v_round := 'initial'; ELSIF r.status = 'appeal_review' THEN v_round := 'appeal';
  ELSE RAISE EXCEPTION 'voting_closed' USING ERRCODE = '23514'; END IF;
  IF r.applicant_user_id = me OR EXISTS (SELECT 1 FROM portal.request_recusals WHERE request_id = p_id AND user_id = me) THEN
    RAISE EXCEPTION 'conflict_of_interest' USING ERRCODE = '42501'; END IF;
  SELECT * INTO cfg FROM portal.committee_config WHERE id = 1;
  IF v_round = 'appeal' THEN   -- G14: members who voted on the first decision are excluded if enough others remain
    SELECT count(*) INTO eligible FROM portal.role_assignments ra WHERE ra.role = 'committee_member' AND ra.revoked_at IS NULL
      AND ra.user_id <> r.applicant_user_id AND NOT EXISTS (SELECT 1 FROM portal.request_recusals c WHERE c.request_id = p_id AND c.user_id = ra.user_id);
    SELECT count(*) INTO initial_voters FROM portal.request_votes WHERE request_id = p_id AND round = 'initial';
    SELECT EXISTS (SELECT 1 FROM portal.request_votes WHERE request_id = p_id AND round = 'initial' AND voter_user_id = me) INTO me_voted_initial;
    IF me_voted_initial AND (eligible - initial_voters) >= cfg.votes_needed THEN RAISE EXCEPTION 'ineligible_appeal_voter' USING ERRCODE = '42501'; END IF;
  END IF;
  BEGIN
    INSERT INTO portal.request_votes (id, request_id, round, voter_user_id, vote, rationale_code, comment)
      VALUES (portal.new_id('vot'), p_id, v_round, me, p_vote::portal.vote_value, p_rationale_code, p_comment);
  EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'already_voted' USING ERRCODE = '23505'; END;
  PERFORM audit.record('request.vote', 'request', p_id, 'allow', jsonb_build_object('round', v_round));
  SELECT count(*) FILTER (WHERE vote = 'approve'), count(*) FILTER (WHERE vote = 'reject') INTO n_app, n_rej
    FROM portal.request_votes WHERE request_id = p_id AND round = v_round;
  IF n_app >= cfg.votes_needed OR n_rej >= cfg.votes_needed THEN
    v_dec := CASE WHEN n_app >= cfg.votes_needed THEN 'approved' ELSE 'rejected' END;
    INSERT INTO portal.request_decisions (id, request_id, round, outcome, rationale_codes, criteria_snapshot)
      VALUES (portal.new_id('dec'), p_id, v_round, v_dec::portal.decision_outcome,
        coalesce((SELECT array_agg(DISTINCT rationale_code) FROM portal.request_votes WHERE request_id = p_id AND round = v_round AND vote = 'reject'), '{}'),
        jsonb_build_object('votes_needed', cfg.votes_needed, 'members_total', cfg.members_total, 'approve', n_app, 'reject', n_rej));
    IF v_round = 'initial' THEN PERFORM portal._transition(p_id, v_dec::portal.request_status, 'system', 'quorum_reached');
    ELSIF v_dec = 'approved' THEN PERFORM portal._transition(p_id, 'approved', 'system', 'appeal_upheld');
    ELSE PERFORM portal._transition(p_id, 'closed', 'system', 'appeal_rejected', NULL, 'rejected', 'appeal_rejected'); END IF;
    PERFORM audit.record('request.decide', 'request', p_id, 'allow', jsonb_build_object('outcome', v_dec, 'round', v_round));
    RETURN v_dec;
  END IF;
  RETURN 'recorded';
END $$;
CREATE FUNCTION portal.request_start_appeal(p_id text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, portal, pg_temp AS $$
DECLARE r portal.requests; win int;
BEGIN
  r := portal._own_request(p_id);
  SELECT coalesce((value #>> '{}')::int, 30) INTO win FROM portal.workflow_config WHERE key = 'request.appeal_window_days' AND scope = 'global';
  IF r.status <> 'rejected' OR r.appeal_count >= 1 OR r.state_entered_at < now() - make_interval(days => win) THEN
    RAISE EXCEPTION 'appeal_not_allowed' USING ERRCODE = '23514'; END IF;
  PERFORM portal._transition(p_id, 'appeal_review', 'researcher_il', 'appeal_filed');
END $$;

-- Center coordination, agreements, delivery
CREATE FUNCTION portal.request_start_center_coordination(p_id text) RETURNS int LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, portal, pg_temp AS $$
DECLARE n int;
BEGIN
  PERFORM portal._require_role('national_coordinator');
  IF NOT EXISTS (SELECT 1 FROM portal.request_item_samples ris JOIN portal.request_items i ON i.id = ris.request_item_id WHERE i.request_id = p_id) THEN
    RAISE EXCEPTION 'no_resolved_samples' USING ERRCODE = '23514'; END IF;
  PERFORM portal._transition(p_id, 'center_coordination', 'national_coordinator');
  INSERT INTO portal.request_steps (id, request_id, step_key, center_id, started_at)
    SELECT portal.new_id('stp'), p_id, 'center_coordination', c, now() FROM (SELECT DISTINCT ris.center_id c FROM portal.request_item_samples ris
      JOIN portal.request_items i ON i.id = ris.request_item_id WHERE i.request_id = p_id) x;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
CREATE FUNCTION portal.request_center_respond(p_id text, p_center_id text, p_accept boolean, p_public_note text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, portal, pg_temp AS $$
DECLARE role_ text := portal._require_role('center_clinician','national_coordinator');
BEGIN
  IF role_ = 'center_clinician' AND p_center_id IS DISTINCT FROM portal.cur_center_id() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF (SELECT status FROM portal.requests WHERE id = p_id) <> 'center_coordination' THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE = '23514'; END IF;
  UPDATE portal.request_steps SET accepted = p_accept, status = 'done', completed_at = now(), actor_user_id = portal.cur_user_id(), public_note = p_public_note
   WHERE request_id = p_id AND step_key = 'center_coordination' AND center_id = p_center_id AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM audit.record('request.center_response', 'request', p_id, 'allow', jsonb_build_object('center', p_center_id, 'accepted', p_accept));
  IF NOT EXISTS (SELECT 1 FROM portal.request_steps WHERE request_id = p_id AND step_key = 'center_coordination' AND status = 'pending') THEN
    IF EXISTS (SELECT 1 FROM portal.request_steps WHERE request_id = p_id AND step_key = 'center_coordination' AND accepted) THEN
      PERFORM portal._transition(p_id, 'agreements', 'system', 'centers_responded');
    ELSE PERFORM portal._transition(p_id, 'closed', 'system', 'center_declined', NULL, 'rejected', 'center_declined'); END IF;
  END IF;
END $$;
CREATE FUNCTION portal.request_record_agreement(p_id text, p_center_id text, p_kind text, p_doc_ref text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, portal, pg_temp AS $$
BEGIN
  PERFORM portal._require_role('national_coordinator');
  IF (SELECT status FROM portal.requests WHERE id = p_id) <> 'agreements' THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE = '23514'; END IF;
  IF NOT EXISTS (SELECT 1 FROM portal.request_steps WHERE request_id = p_id AND step_key = 'center_coordination' AND center_id = p_center_id AND accepted) THEN
    RAISE EXCEPTION 'center_not_involved' USING ERRCODE = '23514'; END IF;
  INSERT INTO portal.request_agreements (request_id, center_id, kind, doc_ref, recorded_by) VALUES (p_id, p_center_id, p_kind, p_doc_ref, portal.cur_user_id())
    ON CONFLICT (request_id, center_id, kind) DO UPDATE SET doc_ref = EXCLUDED.doc_ref, signed_at = now(), recorded_by = EXCLUDED.recorded_by;
  PERFORM audit.record('request.mta_status', 'request', p_id, 'allow', jsonb_build_object('center', p_center_id, 'kind', p_kind));
END $$;
CREATE FUNCTION portal.request_start_delivery(p_id text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, portal, pg_temp AS $$
BEGIN
  PERFORM portal._require_role('national_coordinator');
  IF EXISTS (SELECT 1 FROM portal.request_steps s WHERE s.request_id = p_id AND s.step_key = 'center_coordination' AND s.accepted
             AND NOT EXISTS (SELECT 1 FROM portal.request_agreements a WHERE a.request_id = p_id AND a.center_id = s.center_id)) THEN
    RAISE EXCEPTION 'agreements_missing' USING ERRCODE = '23514'; END IF;
  PERFORM portal._transition(p_id, 'delivery', 'national_coordinator');
  INSERT INTO portal.request_steps (id, request_id, step_key, center_id, started_at)
    SELECT portal.new_id('stp'), p_id, 'delivery', s.center_id, now() FROM portal.request_steps s
     WHERE s.request_id = p_id AND s.step_key = 'center_coordination' AND s.accepted;
END $$;
-- Only the holding center confirms shipment. The coordinator CANNOT mark delivered. Closing as delivered happens when every center did.
CREATE FUNCTION portal.request_center_delivered(p_id text, p_center_id text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, portal, pg_temp AS $$
BEGIN
  PERFORM portal._require_role('center_clinician');
  IF p_center_id IS DISTINCT FROM portal.cur_center_id() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF (SELECT status FROM portal.requests WHERE id = p_id) <> 'delivery' THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE = '23514'; END IF;
  UPDATE portal.request_steps SET status = 'done', completed_at = now(), actor_user_id = portal.cur_user_id()
   WHERE request_id = p_id AND step_key = 'delivery' AND center_id = p_center_id AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM audit.record('request.deliver', 'request', p_id, 'allow', jsonb_build_object('center', p_center_id));
  IF NOT EXISTS (SELECT 1 FROM portal.request_steps WHERE request_id = p_id AND step_key = 'delivery' AND status = 'pending') THEN
    PERFORM portal._transition(p_id, 'closed', 'system', 'delivered', NULL, 'delivered');
  END IF;
END $$;

-- Background expiry (app_readonly_bg): timers come from workflow_config.
CREATE FUNCTION portal.request_expire_overdue(p_now timestamptz DEFAULT now()) RETURNS int LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, portal, pg_temp AS $$
DECLARE r record; n int := 0; d int;
BEGIN
  IF session_user NOT IN ('app_readonly_bg','app_migrator') AND portal.cur_role() IS DISTINCT FROM 'system_admin' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  FOR r IN SELECT q.id, q.status, q.state_entered_at, q.created_at FROM portal.requests q
           WHERE q.status IN ('draft','needs_info','rejected','center_coordination','agreements','delivery') ORDER BY q.id LOOP
    SELECT (value #>> '{}')::int INTO d FROM portal.workflow_config WHERE scope = 'global' AND key = CASE r.status
      WHEN 'draft' THEN 'request.cart_idle_expiry_days' WHEN 'needs_info' THEN 'request.info_response_days'
      WHEN 'rejected' THEN 'request.appeal_window_days' WHEN 'center_coordination' THEN 'request.center_coordination_max_days'
      WHEN 'agreements' THEN 'request.agreements_max_days' ELSE 'request.delivery_max_days' END;
    IF p_now - (CASE WHEN r.status = 'draft' THEN r.created_at ELSE r.state_entered_at END) > make_interval(days => d) THEN
      IF r.status = 'rejected' THEN PERFORM portal._transition(r.id, 'closed', 'system', 'appeal_window_ended', NULL, 'rejected', 'appeal_window_ended');
      ELSE PERFORM portal._transition(r.id, 'closed', 'system', 'timeout', NULL, 'expired', 'timeout'); END IF;
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END $$;

-- Applicant projection (REQ-036): public notes only, no votes, no internal notes.
CREATE FUNCTION portal.request_timeline(p_id text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, portal, pg_temp AS $$
DECLARE r portal.requests;
BEGIN
  r := portal._own_request(p_id);
  RETURN jsonb_build_object('id', r.id, 'status', r.status, 'closeReason', r.close_reason,
    'events', coalesce((SELECT jsonb_agg(jsonb_build_object('at', e.at, 'from', e.from_state, 'to', e.to_state, 'actorRole', e.actor_role,
         'reasonCode', e.reason_code, 'publicNote', e.public_note) ORDER BY e.id) FROM portal.request_events e WHERE e.request_id = p_id), '[]'),
    'decision', (SELECT jsonb_build_object('round', d.round, 'outcome', d.outcome, 'rationaleCodes', d.rationale_codes, 'rationale', d.rationale)
                   FROM portal.request_decisions d WHERE d.request_id = p_id ORDER BY d.decided_at DESC LIMIT 1),
    'centers', coalesce((SELECT jsonb_agg(jsonb_build_object('centerCode', c.code, 'step', s.step_key, 'status', s.status, 'publicNote', s.public_note))
                   FROM portal.request_steps s JOIN portal.centers c ON c.id = s.center_id WHERE s.request_id = p_id), '[]'));
END $$;
-- Admin: metadata only
CREATE FUNCTION portal.request_metadata(p_limit int DEFAULT 100) RETURNS TABLE (id text, status text, close_reason text, created_at timestamptz,
  submitted_at timestamptz, state_entered_at timestamptz) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, portal, pg_temp AS $$
BEGIN
  PERFORM portal._require_role('system_admin');
  RETURN QUERY SELECT q.id::text, q.status::text, q.close_reason::text, q.created_at, q.submitted_at, q.state_entered_at
    FROM portal.requests q ORDER BY q.created_at DESC LIMIT least(p_limit, 500);
END $$;

GRANT EXECUTE ON FUNCTION portal.guard_requests(), portal.block_delete_except_core() TO PUBLIC;
GRANT EXECUTE ON FUNCTION portal._transition(text,portal.request_status,text,text,text,portal.close_reason,text), portal._own_request(text) TO app_core;
GRANT EXECUTE ON FUNCTION portal.request_create(text), portal.request_submit(text,text), portal.request_start_precheck(text),
  portal.request_ask_info(text,text,text), portal.request_respond_info(text), portal.request_precheck_pass(text,jsonb),
  portal.request_precheck_reject(text,text), portal.request_withdraw(text), portal.request_cancel_policy(text,text),
  portal.request_declare_conflict(text), portal.request_cast_vote(text,text,text,text), portal.request_start_appeal(text),
  portal.request_start_center_coordination(text), portal.request_center_respond(text,text,boolean,text),
  portal.request_record_agreement(text,text,text,text), portal.request_start_delivery(text), portal.request_center_delivered(text,text),
  portal.request_timeline(text), portal.request_metadata(int) TO app_runtime;
GRANT EXECUTE ON FUNCTION portal.request_expire_overdue(timestamptz) TO app_readonly_bg, app_migrator, app_runtime;
SELECT portal._assign_owners();
