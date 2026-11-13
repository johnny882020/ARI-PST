-- Migration 0003: search + k-anonymous aggregate functions.
-- External roles have no SELECT on samples. They call these SECURITY DEFINER functions.
-- The functions are owned by portal_agg. portal_agg can read samples (policy samples_agg_read) and nothing else of value.
SET search_path = portal, public;

GRANT CREATE ON SCHEMA search TO portal_agg;   -- revoked at the end of this file

-- ---------- Text normalisation (he + en) ----------
-- unaccent is STABLE. We wrap it as IMMUTABLE for expression indexes. The dictionary is fixed, so this is safe.
CREATE FUNCTION search.norm(t text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT btrim(regexp_replace(
           lower(public.unaccent('public.unaccent', regexp_replace(coalesce(t,''), '[֑-ׇ]', '', 'g'))),
           '[^[:alnum:]א-ת]+', ' ', 'g'))
$$;

CREATE INDEX ix_dx_label_en_trgm ON portal.diagnosis_terms USING gin (search.norm(label_en) gin_trgm_ops);
CREATE INDEX ix_dx_label_he_trgm ON portal.diagnosis_terms USING gin (search.norm(label_he) gin_trgm_ops);
CREATE INDEX ix_dx_syn_trgm      ON portal.diagnosis_synonyms USING gin (search.norm(term) gin_trgm_ops);
CREATE INDEX ix_dx_syn_fts       ON portal.diagnosis_synonyms USING gin (to_tsvector('simple', search.norm(term)));
CREATE INDEX ix_dx_label_fts     ON portal.diagnosis_terms
  USING gin (to_tsvector('simple', search.norm(label_en || ' ' || label_he)));

-- ---------- Types and small helpers ----------
CREATE TYPE search.bucket_row AS (bucket text, bucket_level text, n int);

CREATE FUNCTION search.jarr(p jsonb, k text) RETURNS text[]
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN jsonb_typeof(p -> k) = 'array'
              THEN (SELECT array_agg(v) FROM jsonb_array_elements_text(p -> k) v) END
$$;

CREATE FUNCTION search.k_for(p_field_set text) RETURNS int
  LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT k FROM portal.k_policies WHERE field_set = p_field_set),
                  (SELECT k FROM portal.k_policies WHERE field_set = 'default'), 5)
$$;

-- Banded display for small counts. Option for A2: hides exact values in [k,10).
CREATE FUNCTION search.count_label(n int, k int) RETURNS text
  LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN n IS NULL OR n < k THEN '<' || k::text
              WHEN n < 10 THEN k::text || '-9'
              ELSE n::text END
$$;

-- ---------- Filtered row set. Internal. Runs as portal_agg. NOT granted to anyone else. ----------
CREATE FUNCTION search.filtered(p_filters jsonb)
RETURNS TABLE (sample_id text, diagnosis_code text, family_code text, group_code text,
               sample_type text, age_band text, sex text, center_id text,
               timepoint text, availability text, attached_data text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = portal, search, pg_catalog AS $$
  SELECT s.id, s.diagnosis_code,
         CASE t.level WHEN 'type' THEN p.diagnosis_code ELSE t.diagnosis_code END,
         CASE t.level WHEN 'type' THEN g.diagnosis_code WHEN 'family' THEN p.diagnosis_code ELSE t.diagnosis_code END,
         s.sample_type::text, s.age_band_at_diagnosis::text, s.sex::text, s.source_center_id,
         s.clinical_timepoint::text, s.availability::text, s.attached_data::text[]
  FROM portal.samples s
  JOIN portal.diagnosis_terms t ON t.diagnosis_code = s.diagnosis_code
  LEFT JOIN portal.diagnosis_terms p ON p.diagnosis_code = t.parent_code
  LEFT JOIN portal.diagnosis_terms g ON g.diagnosis_code = p.parent_code
  WHERE s.deleted_at IS NULL
    AND (search.jarr(p_filters,'diagnosis')    IS NULL OR search.jarr(p_filters,'diagnosis') && ARRAY[t.diagnosis_code, p.diagnosis_code, g.diagnosis_code])
    AND (search.jarr(p_filters,'sampleType')   IS NULL OR s.sample_type::text = ANY (search.jarr(p_filters,'sampleType')))
    AND (search.jarr(p_filters,'ageBand')      IS NULL OR s.age_band_at_diagnosis::text = ANY (search.jarr(p_filters,'ageBand')))
    AND (search.jarr(p_filters,'sex')          IS NULL OR s.sex::text = ANY (search.jarr(p_filters,'sex')))
    AND (search.jarr(p_filters,'centerId')     IS NULL OR s.source_center_id = ANY (search.jarr(p_filters,'centerId')))
    AND (search.jarr(p_filters,'timepoint')    IS NULL OR s.clinical_timepoint::text = ANY (search.jarr(p_filters,'timepoint')))
    AND (search.jarr(p_filters,'availability') IS NULL OR s.availability::text = ANY (search.jarr(p_filters,'availability')))
    AND (search.jarr(p_filters,'attachedData') IS NULL OR s.attached_data::text[] @> search.jarr(p_filters,'attachedData'))
$$;
REVOKE ALL ON FUNCTION search.filtered(jsonb) FROM PUBLIC;

-- ---------- k-rule: merge candidates and the rest ----------
-- p_cands: buckets that already have n >= k. p_rest: summed count of all merged small cells.
-- Rule: if 0 < rest < k, pull the smallest candidate into rest (complementary suppression).
-- If rest is still < k, the rest is suppressed (n = NULL). Result never reveals a count < k,
-- and never lets (total - visible) reveal a count < k.
CREATE FUNCTION search._apply_k(p_cands search.bucket_row[], p_rest int, p_k int)
RETURNS TABLE (bucket text, bucket_level text, n int, suppressed boolean)
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE c search.bucket_row[] := coalesce(p_cands, '{}'); rest int := coalesce(p_rest, 0);
        i int; min_i int := NULL; min_n int;
BEGIN
  IF rest > 0 AND rest < p_k AND coalesce(array_length(c,1),0) > 0 THEN
    FOR i IN 1 .. array_length(c,1) LOOP
      IF min_n IS NULL OR c[i].n < min_n THEN min_n := c[i].n; min_i := i; END IF;
    END LOOP;
    rest := rest + min_n;
    c := c[1:min_i-1] || c[min_i+1:array_length(c,1)];
  END IF;
  RETURN QUERY SELECT x.bucket, x.bucket_level, x.n, false
               FROM unnest(c) x ORDER BY x.n DESC, x.bucket;
  IF rest >= p_k THEN
    RETURN QUERY SELECT 'other'::text, 'other'::text, rest, false;
  ELSIF rest > 0 THEN
    RETURN QUERY SELECT 'other'::text, 'other'::text, NULL::int, true;
  END IF;
END $$;

-- ---------- Total ----------
CREATE FUNCTION search.total_count(p_filters jsonb DEFAULT '{}')
RETURNS TABLE (n int, suppressed boolean, label text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = portal, search, pg_catalog AS $$
DECLARE v int; k int := search.k_for('default');
BEGIN
  SELECT count(*) INTO v FROM search.filtered(p_filters);
  IF v < k THEN RETURN QUERY SELECT NULL::int, true, search.count_label(v, k);
  ELSE RETURN QUERY SELECT v, false, search.count_label(v, k); END IF;
END $$;

-- ---------- Facet counts ----------
-- p_facet: diagnosis | sampleType | ageBand | sex | center | timepoint | availability | attachedData
-- Output rows are safe for external roles.
CREATE FUNCTION search.facet_counts(p_filters jsonb, p_facet text)
RETURNS TABLE (bucket text, bucket_level text, n int, suppressed boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = portal, search, pg_catalog AS $$
DECLARE
  k int := search.k_for(CASE p_facet WHEN 'diagnosis' THEN 'diagnosis' WHEN 'center' THEN 'center' ELSE 'default' END);
  total int; cands search.bucket_row[]; rest int;
BEGIN
  IF p_facet NOT IN ('diagnosis','sampleType','ageBand','sex','center','timepoint','availability','attachedData') THEN
    RAISE EXCEPTION 'unknown_facet' USING ERRCODE = '22023';
  END IF;

  -- Gate: if the filtered set itself is below k, return nothing.
  SELECT count(*) INTO total FROM search.filtered(p_filters);
  IF total < k THEN
    RETURN QUERY SELECT 'all'::text, 'other'::text, NULL::int, true;
    RETURN;
  END IF;

  IF p_facet = 'attachedData' THEN
    -- Overlapping buckets. Each bucket is shown alone or suppressed. No merge possible.
    RETURN QUERY
      SELECT a.v, 'value'::text,
             CASE WHEN a.c >= k THEN a.c END,
             a.c < k
      FROM (SELECT u.v, count(*)::int AS c FROM search.filtered(p_filters) f, unnest(f.attached_data) u(v) GROUP BY u.v) a
      ORDER BY a.c DESC, a.v;
    RETURN;
  END IF;

  IF p_facet = 'diagnosis' THEN
    -- Roll small leaf cells up: type -> family -> group -> other.
    WITH leaf AS (
      SELECT f.diagnosis_code AS code, f.family_code, f.group_code, count(*)::int AS c
      FROM search.filtered(p_filters) f GROUP BY 1,2,3),
    vis AS (SELECT code, c FROM leaf WHERE c >= k),
    small AS (SELECT family_code, group_code, sum(c)::int AS c FROM leaf WHERE c < k GROUP BY 1,2),
    fam AS (SELECT family_code, group_code, c FROM small WHERE c >= k),
    grp_in AS (SELECT group_code, sum(c)::int AS c FROM small WHERE family_code NOT IN (SELECT family_code FROM fam) GROUP BY 1),
    grp AS (SELECT group_code, c FROM grp_in WHERE c >= k),
    rest_q AS (SELECT coalesce(sum(c),0)::int AS c FROM grp_in WHERE group_code NOT IN (SELECT group_code FROM grp))
    SELECT (SELECT array_agg(row(b,l,c)::search.bucket_row) FROM (
              SELECT code AS b, 'type'::text AS l, c FROM vis
              UNION ALL SELECT family_code, 'family_other', c FROM fam
              UNION ALL SELECT group_code, 'group_other', c FROM grp) z),
           (SELECT c FROM rest_q)
    INTO cands, rest;
  ELSE
    SELECT array_agg(row(q.b,'value',q.c)::search.bucket_row) FILTER (WHERE q.c >= k),
           coalesce(sum(q.c) FILTER (WHERE q.c < k), 0)::int
    INTO cands, rest
    FROM (SELECT x.b, count(*)::int AS c
          FROM search.filtered(p_filters) f
          CROSS JOIN LATERAL (SELECT CASE p_facet
               WHEN 'sampleType' THEN f.sample_type WHEN 'ageBand' THEN f.age_band
               WHEN 'sex' THEN f.sex WHEN 'center' THEN f.center_id
               WHEN 'timepoint' THEN f.timepoint WHEN 'availability' THEN f.availability END AS b) x
          GROUP BY x.b) q;
  END IF;

  RETURN QUERY SELECT * FROM search._apply_k(cands, rest, k);
END $$;

-- ---------- Smart search: free text -> diagnosis codes (vocabulary only; samples hold no free text) ----------
CREATE FUNCTION search.expand_query(p_q text, p_limit int DEFAULT 10)
RETURNS TABLE (diagnosis_code text, score real, matched_via text)
LANGUAGE sql STABLE AS $$
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

-- ---------- Ownership and grants ----------
ALTER FUNCTION search.filtered(jsonb) OWNER TO portal_agg;
ALTER FUNCTION search.total_count(jsonb) OWNER TO portal_agg;
ALTER FUNCTION search.facet_counts(jsonb, text) OWNER TO portal_agg;
REVOKE ALL ON FUNCTION search.total_count(jsonb), search.facet_counts(jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION search.total_count(jsonb), search.facet_counts(jsonb, text)
  TO portal_external, portal_clinician, portal_coordinator, portal_committee;
GRANT EXECUTE ON FUNCTION search.expand_query(text, int), search.norm(text), search.count_label(int,int)
  TO portal_external, portal_clinician, portal_coordinator, portal_committee, portal_admin;
-- search.filtered needs these helpers when it runs as portal_agg:
GRANT EXECUTE ON FUNCTION search.jarr(jsonb, text), search.k_for(text) TO portal_agg;
GRANT EXECUTE ON FUNCTION search._apply_k(search.bucket_row[], int, int) TO portal_agg;
GRANT SELECT ON portal.diagnosis_terms, portal.k_policies TO portal_agg;
GRANT USAGE ON TYPE search.bucket_row TO portal_agg;
REVOKE CREATE ON SCHEMA search FROM portal_agg;
