-- 0008 vocabulary search, import guard, staleness, retention/purge. kind: expand
SET LOCAL search_path = portal, ext, pg_catalog;
-- ---------- Text normalisation (he + en) ----------
-- unaccent is STABLE. We wrap it as IMMUTABLE for expression indexes. The dictionary is fixed, so this is safe.
CREATE FUNCTION search.norm(t text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = ext, pg_catalog AS $$
  SELECT btrim(regexp_replace(
           lower(ext.unaccent('ext.unaccent', regexp_replace(coalesce(t,''), '[֑-ׇ]', '', 'g'))),
           '[^[:alnum:]א-ת]+', ' ', 'g'))
$$;

CREATE INDEX ix_dx_label_en_trgm ON portal.diagnosis_terms USING gin (search.norm(label_en) gin_trgm_ops);
CREATE INDEX ix_dx_label_he_trgm ON portal.diagnosis_terms USING gin (search.norm(label_he) gin_trgm_ops);
CREATE INDEX ix_dx_syn_trgm      ON portal.diagnosis_synonyms USING gin (search.norm(term) gin_trgm_ops);
CREATE INDEX ix_dx_syn_fts       ON portal.diagnosis_synonyms USING gin (to_tsvector('simple', search.norm(term)));
CREATE INDEX ix_dx_label_fts     ON portal.diagnosis_terms
  USING gin (to_tsvector('simple', search.norm(label_en || ' ' || label_he)));

-- ---------- Smart search: free text -> diagnosis codes (vocabulary only; samples hold no free text) ----------
CREATE FUNCTION search.expand_query(p_q text, p_limit int DEFAULT 10)
RETURNS TABLE (diagnosis_code text, score real, matched_via text)
LANGUAGE sql STABLE SET search_path = pg_catalog, ext, portal, search, pg_temp AS $$
  WITH q AS (
    SELECT search.norm(left(p_q, 200)) AS n,
           -- Hebrew one-letter prefixes (ה ב ל ו מ ש כ): also try the word without the prefix.
           regexp_replace(search.norm(left(p_q, 200)), '(^| )[הבלומשכ]([א-ת]{3,})', '\1\2', 'g') AS n2
  ), cand AS (
    -- 1 exact synonym or label
    SELECT s.diagnosis_code, 1.0::real AS score, 'exact' AS via
      FROM portal.diagnosis_synonyms s, q WHERE search.norm(s.term) IN (q.n, q.n2)
    UNION ALL
    SELECT t.diagnosis_code, 1.0, 'exact' FROM portal.diagnosis_terms t, q
      WHERE search.norm(t.label_en) IN (q.n, q.n2) OR search.norm(t.label_he) IN (q.n, q.n2)
    UNION ALL
    -- 2 full-text prefix match on every query word
    SELECT t.diagnosis_code, 0.8, 'fts' FROM portal.diagnosis_terms t, q
      WHERE length(q.n) > 1 AND to_tsvector('simple', search.norm(t.label_en || ' ' || t.label_he))
            @@ to_tsquery('simple', (SELECT string_agg(w || ':*', ' & ') FROM unnest(string_to_array(q.n2, ' ')) w WHERE w <> ''))
    UNION ALL
    SELECT s.diagnosis_code, 0.8, 'fts' FROM portal.diagnosis_synonyms s, q
      WHERE length(q.n) > 1 AND to_tsvector('simple', search.norm(s.term))
            @@ to_tsquery('simple', (SELECT string_agg(w || ':*', ' & ') FROM unnest(string_to_array(q.n2, ' ')) w WHERE w <> ''))
    UNION ALL
    -- 3 trigram typo tolerance
    SELECT t.diagnosis_code, greatest(similarity(search.norm(t.label_en), q.n), similarity(search.norm(t.label_he), q.n2)), 'trgm'
      FROM portal.diagnosis_terms t, q
      WHERE length(q.n) >= 3 AND (search.norm(t.label_en) % q.n OR search.norm(t.label_he) % q.n2)
    UNION ALL
    SELECT s.diagnosis_code, similarity(search.norm(s.term), q.n2), 'trgm'
      FROM portal.diagnosis_synonyms s, q
      WHERE length(q.n) >= 3 AND search.norm(s.term) % q.n2
  )
  SELECT c.diagnosis_code, max(c.score)::real, (array_agg(c.via ORDER BY c.score DESC))[1]
  FROM cand c JOIN portal.diagnosis_terms t ON t.diagnosis_code = c.diagnosis_code AND t.is_selectable
  GROUP BY c.diagnosis_code
  ORDER BY max(c.score) DESC, c.diagnosis_code
  LIMIT greatest(1, least(p_limit, 25))
$$;

GRANT EXECUTE ON FUNCTION search.norm(text), search.expand_query(text, int) TO app_runtime;

-- ---------- import jobs: status machine ----------
CREATE FUNCTION portal.guard_import_jobs() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p portal.import_jobs%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.mode = 'commit' THEN
      SELECT * INTO p FROM portal.import_jobs WHERE id = NEW.parent_job_id;
      IF NOT FOUND OR p.mode <> 'dry_run' OR p.status <> 'validated' OR p.file_sha256 IS DISTINCT FROM NEW.file_sha256 OR p.created_by <> NEW.created_by THEN
        RAISE EXCEPTION 'commit_requires_validated_dry_run' USING ERRCODE = '23514'; END IF;
    END IF;
    IF NEW.status <> 'uploaded' THEN RAISE EXCEPTION 'invalid_import_status' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'uploaded'   AND NEW.status IN ('validating','cancelled','expired')) OR
       (OLD.status = 'validating' AND NEW.status IN ('validated','rejected','failed')) OR
       (OLD.status = 'validated'  AND NEW.status IN ('committing','cancelled','expired')) OR
       (OLD.status = 'committing' AND NEW.status IN ('committed','failed'))) THEN
    RAISE EXCEPTION 'invalid_import_transition' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_import_guard BEFORE INSERT OR UPDATE ON portal.import_jobs FOR EACH ROW EXECUTE FUNCTION portal.guard_import_jobs();

-- ---------- staleness (REQ-067, C-14) ----------
CREATE FUNCTION portal.staleness_run() RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, portal, pg_temp AS $$
DECLARE n int; digest int;
BEGIN
  IF session_user NOT IN ('app_readonly_bg','app_migrator') AND portal.cur_role() IS DISTINCT FROM 'national_coordinator' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT coalesce((value #>> '{}')::int, 7) INTO digest FROM portal.workflow_config WHERE key = 'staleness.digest_days' AND scope = 'global';
  INSERT INTO portal.staleness_reminders (center_id, due_soon_count, stale_count)
    SELECT v.source_center_id, count(*) FILTER (WHERE v.staleness = 'due_soon'), count(*) FILTER (WHERE v.staleness = 'stale')
      FROM portal.v_sample_staleness v GROUP BY v.source_center_id
     HAVING count(*) FILTER (WHERE v.staleness <> 'fresh') > 0
        AND NOT EXISTS (SELECT 1 FROM portal.staleness_reminders r WHERE r.center_id = v.source_center_id AND r.generated_at > now() - make_interval(days => digest));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- ---------- retention / purge (RT-05, RT-21). Values are proposals: needs legal review (C-07). ----------
CREATE FUNCTION portal._cfg_int(p_key text, p_default int) RETURNS int LANGUAGE sql STABLE SET search_path = pg_catalog, portal, pg_temp AS $$
  SELECT coalesce((SELECT (value #>> '{}')::int FROM portal.workflow_config WHERE key = p_key AND scope = 'global'), p_default) $$;
CREATE FUNCTION portal.retention_run(p_now timestamptz DEFAULT now()) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, portal, audit, pg_temp AS $$
DECLARE res jsonb := '{}'; n bigint;
BEGIN
  IF session_user NOT IN ('app_readonly_bg','app_migrator') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  DELETE FROM portal.idempotency_keys WHERE created_at < p_now - make_interval(hours => portal._cfg_int('retention.idempotency_hours', 24));
  GET DIAGNOSTICS n = ROW_COUNT; res := res || jsonb_build_object('idempotency_keys', n);
  UPDATE portal.import_jobs SET status = 'expired', staging_key = NULL, report_key = NULL, result_map_key = NULL
   WHERE expires_at < p_now AND status IN ('uploaded','validated');
  DELETE FROM portal.import_jobs WHERE created_at < p_now - make_interval(months => portal._cfg_int('retention.import_rows_months', 12))
     AND status IN ('committed','failed','rejected','cancelled','expired') AND NOT EXISTS (SELECT 1 FROM portal.import_jobs c WHERE c.parent_job_id = import_jobs.id);
  GET DIAGNOSTICS n = ROW_COUNT; res := res || jsonb_build_object('import_jobs', n);
  -- free text first (24 months after close), then the structured record (7 years)
  UPDATE portal.requests SET research_question = NULL, planned_use = NULL, funding_sources = NULL, applicant_ethics_ref = NULL, text_wiped_at = p_now
   WHERE status = 'closed' AND text_wiped_at IS NULL AND closed_at < p_now - make_interval(months => portal._cfg_int('retention.request_text_months', 24));
  GET DIAGNOSTICS n = ROW_COUNT; res := res || jsonb_build_object('request_text_wiped', n);
  UPDATE portal.request_steps SET public_note = NULL, internal_note = NULL WHERE request_id IN (SELECT id FROM portal.requests WHERE text_wiped_at IS NOT NULL) AND (public_note IS NOT NULL OR internal_note IS NOT NULL);
  UPDATE portal.request_votes SET comment = NULL WHERE request_id IN (SELECT id FROM portal.requests WHERE text_wiped_at IS NOT NULL) AND comment IS NOT NULL;
  UPDATE portal.request_decisions SET rationale = NULL WHERE request_id IN (SELECT id FROM portal.requests WHERE text_wiped_at IS NOT NULL) AND rationale IS NOT NULL;
  UPDATE portal.request_events SET public_note = NULL WHERE request_id IN (SELECT id FROM portal.requests WHERE text_wiped_at IS NOT NULL) AND public_note IS NOT NULL;
  DELETE FROM portal.requests WHERE status = 'closed' AND closed_at < p_now - make_interval(years => portal._cfg_int('retention.request_years', 7));
  GET DIAGNOSTICS n = ROW_COUNT; res := res || jsonb_build_object('requests', n);
  -- samples: links are set to NULL by FK (tombstone code + center stay in request_item_samples)
  DELETE FROM portal.samples WHERE deleted_at < p_now - make_interval(months => portal._cfg_int('retention.sample_deleted_months', 24));
  GET DIAGNOSTICS n = ROW_COUNT; res := res || jsonb_build_object('samples', n);
  DELETE FROM portal.ethics_approvals e WHERE e.updated_at < p_now - make_interval(months => portal._cfg_int('retention.sample_deleted_months', 24))
     AND NOT EXISTS (SELECT 1 FROM portal.samples s WHERE s.ethics_approval_id = e.id);
  GET DIAGNOSTICS n = ROW_COUNT; res := res || jsonb_build_object('ethics_approvals', n);
  UPDATE portal.users SET email = 'deleted+' || substr(encode(sha256(convert_to(id,'UTF8')),'hex'), 1, 16) || '@users.invalid', display_name = 'Deleted user', external_idp_subject = NULL
   WHERE status = 'closed' AND closed_at < p_now - make_interval(months => portal._cfg_int('retention.user_closed_months', 12)) AND email NOT LIKE 'deleted+%';
  GET DIAGNOSTICS n = ROW_COUNT; res := res || jsonb_build_object('users_anonymised', n);
  IF to_regclass('ops.query_log') IS NOT NULL THEN DELETE FROM ops.query_log WHERE at < p_now - interval '13 months'; GET DIAGNOSTICS n = ROW_COUNT; res := res || jsonb_build_object('query_log', n); END IF;
  n := audit.purge_before(p_now - make_interval(years => portal._cfg_int('retention.audit_years', 7)));
  res := res || jsonb_build_object('audit_events', n);
  PERFORM audit.record_internal('system:retention', 'system', NULL, 'retention.purge', 'retention', NULL, 'allow', NULL, res);
  RETURN res;
END $$;

GRANT EXECUTE ON FUNCTION portal.guard_import_jobs(), portal._cfg_int(text,int) TO PUBLIC;
GRANT EXECUTE ON FUNCTION portal.staleness_run() TO app_readonly_bg, app_migrator, app_runtime;
GRANT EXECUTE ON FUNCTION portal.retention_run(timestamptz) TO app_readonly_bg, app_migrator;
SELECT portal._assign_owners();
