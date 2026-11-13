-- 0007 privacy engine (RT-01, RT-02, RT-28; canonical C-08, C-09). kind: expand
-- * Unit of counting: DISTINCT DONORS (donor_ref). All samples of one donor agree on diagnosis, sex, age band, center (trigger), so
--   donor counts of those facets are additive.
-- * Reads only agg.snapshot (epoch swap). New samples appear in the next epoch.
-- * Cell rule: a cell is shown only if donors >= k AND for every neighbour query q' (drop a filter, remove one OR value, replace a
--   diagnosis by its parent) the remainder rest = n(q') - n(q) is NOT in [1, k-1]. Small / unsafe cells are merged up the hierarchy,
--   then into one 'other' cell; if 'other' is small or unsafe, the smallest shown cell is pulled into it (complementary suppression).
-- * Counts under 10 are returned as band 'lt10' with n = NULL. Masked cells carry no number. The threshold is never returned.
CREATE TABLE agg.snapshot (
  donor_ref text NOT NULL, diagnosis_code text NOT NULL, family_code text NOT NULL, group_code text NOT NULL,
  sample_type text NOT NULL, age_band text NOT NULL, sex text NOT NULL, center_id text NOT NULL,
  timepoint text NOT NULL, availability text NOT NULL, attached_data text[] NOT NULL);
CREATE INDEX ix_snap_dx ON agg.snapshot (diagnosis_code);
CREATE INDEX ix_snap_center ON agg.snapshot (center_id);
CREATE INDEX ix_snap_donor ON agg.snapshot (donor_ref);
-- one row per donor with the donor-level (single-valued) attributes: count(*) instead of count(DISTINCT) when a query only uses them
CREATE TABLE agg.donor_snapshot (donor_ref text PRIMARY KEY, diagnosis_code text NOT NULL, family_code text NOT NULL, group_code text NOT NULL,
  age_band text NOT NULL, sex text NOT NULL, center_id text NOT NULL);
CREATE TABLE agg.dim_counts (dim text NOT NULL, val text NOT NULL, n int NOT NULL, PRIMARY KEY (dim, val));
CREATE TABLE agg.epoch_state (id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1), epoch int NOT NULL DEFAULT 0, built_at timestamptz, row_count int, donor_count int);
INSERT INTO agg.epoch_state DEFAULT VALUES;
GRANT SELECT, INSERT, UPDATE, DELETE ON agg.snapshot, agg.donor_snapshot, agg.epoch_state, agg.dim_counts TO app_agg;
GRANT SELECT ON agg.epoch_state TO app_runtime;
CREATE POLICY agg_read ON portal.diagnosis_terms FOR SELECT TO app_agg USING (true);
CREATE POLICY agg_read ON portal.k_policies FOR SELECT TO app_agg USING (true);

CREATE TYPE agg.cell AS (label text, lvl text, vec int[], members text[]);

CREATE FUNCTION agg.refresh_snapshot() RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, portal, agg, pg_temp AS $$
DECLARE n int; d int;
BEGIN
  IF session_user NOT IN ('app_readonly_bg','app_migrator') AND portal.cur_role() IS DISTINCT FROM 'national_coordinator' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  DELETE FROM agg.snapshot;
  INSERT INTO agg.snapshot
    SELECT s.donor_ref, s.diagnosis_code,
           CASE t.level WHEN 'type' THEN p.diagnosis_code ELSE t.diagnosis_code END,
           CASE t.level WHEN 'type' THEN g.diagnosis_code WHEN 'family' THEN p.diagnosis_code ELSE t.diagnosis_code END,
           s.sample_type::text, s.age_band_at_diagnosis::text, s.sex::text, s.source_center_id, s.clinical_timepoint::text,
           s.availability::text, s.attached_data::text[]
    FROM portal.samples s JOIN portal.diagnosis_terms t ON t.diagnosis_code = s.diagnosis_code
    LEFT JOIN portal.diagnosis_terms p ON p.diagnosis_code = t.parent_code
    LEFT JOIN portal.diagnosis_terms g ON g.diagnosis_code = p.parent_code
    WHERE s.deleted_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  DELETE FROM agg.donor_snapshot;
  INSERT INTO agg.donor_snapshot SELECT DISTINCT ON (donor_ref) donor_ref, diagnosis_code, family_code, group_code, age_band, sex, center_id FROM agg.snapshot ORDER BY donor_ref;
  DELETE FROM agg.dim_counts;
  INSERT INTO agg.dim_counts SELECT 'sex', sex, count(DISTINCT donor_ref) FROM agg.snapshot GROUP BY sex;
  INSERT INTO agg.dim_counts SELECT 'ageBand', age_band, count(DISTINCT donor_ref) FROM agg.snapshot GROUP BY age_band;
  INSERT INTO agg.dim_counts SELECT 'centerId', center_id, count(DISTINCT donor_ref) FROM agg.snapshot GROUP BY center_id;
  INSERT INTO agg.dim_counts SELECT 'diagnosis', c, count(DISTINCT donor_ref) FROM agg.snapshot s CROSS JOIN LATERAL unnest(ARRAY[s.diagnosis_code, s.family_code, s.group_code]) c GROUP BY c;
  SELECT count(DISTINCT donor_ref) INTO d FROM agg.snapshot;
  UPDATE agg.epoch_state SET epoch = epoch + 1, built_at = now(), row_count = n, donor_count = d WHERE id = 1;
  RETURN (SELECT epoch FROM agg.epoch_state WHERE id = 1);
END $$;
CREATE FUNCTION agg.current_epoch() RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, agg, pg_temp AS $$ SELECT epoch FROM agg.epoch_state WHERE id = 1 $$;

CREATE FUNCTION agg._jarr(p jsonb, k text) RETURNS text[] LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN jsonb_typeof(p -> k) = 'array' THEN (SELECT array_agg(v) FROM jsonb_array_elements_text(p -> k) v) END $$;
CREATE FUNCTION agg.k_for(p_field_set text) RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, portal, pg_temp AS $$
  SELECT greatest(5, coalesce((SELECT k FROM portal.k_policies WHERE field_set = p_field_set), (SELECT k FROM portal.k_policies WHERE field_set = 'default'), 5)) $$;

-- vec[1] = donors of the cell; vec[2..] = donors of neighbour queries (broader: drop a filter / parent / cover; narrower: one OR value removed).
-- Unsafe when a displayable neighbour differs by 1..k-1 donors (nested sets, so the difference is a group smaller than k).
-- Two banded answers (both < 10) show no numbers, so their difference is not observable and is ignored.
CREATE FUNCTION agg._safe(vec int[], k int) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT vec[1] >= k AND NOT EXISTS (SELECT 1 FROM generate_subscripts(vec, 1) i
    WHERE i >= 2 AND NOT (vec[1] < 10 AND vec[i] < 10)
      AND ((vec[i] - vec[1] BETWEEN 1 AND k - 1) OR (vec[1] - vec[i] BETWEEN 1 AND k - 1 AND vec[i] >= 10))) $$;
CREATE FUNCTION agg._vadd(a int[], b int[]) RETURNS int[] LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN a IS NULL THEN b ELSE ARRAY(SELECT a[i] + b[i] FROM generate_subscripts(a, 1) i ORDER BY i) END $$;

-- Input validation. Limits: <= 4 filter keys, <= 3 values per key. Errors never reveal k.
CREATE FUNCTION agg._validate(p_filters jsonb, p_facet text) RETURNS void LANGUAGE plpgsql STABLE SET search_path = pg_catalog, portal, pg_temp AS $$
DECLARE kk text; v jsonb;
BEGIN
  IF portal.cur_role() IS NULL OR portal.cur_role() NOT IN ('researcher_il','researcher_intl','center_clinician','national_coordinator','committee_member') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p_filters IS NULL OR jsonb_typeof(p_filters) <> 'object' THEN RAISE EXCEPTION 'invalid_filters' USING ERRCODE = '22023'; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_filters)) > 4 THEN RAISE EXCEPTION 'filter_limit' USING ERRCODE = '22023'; END IF;
  FOR kk, v IN SELECT * FROM jsonb_each(p_filters) LOOP
    IF kk NOT IN ('diagnosis','sampleType','ageBand','sex','centerId','timepoint','availability','attachedData') THEN
      RAISE EXCEPTION 'filter_limit' USING ERRCODE = '22023'; END IF;
    IF jsonb_typeof(v) <> 'array' OR jsonb_array_length(v) NOT BETWEEN 1 AND 3 THEN RAISE EXCEPTION 'filter_limit' USING ERRCODE = '22023'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v) e WHERE jsonb_typeof(e) <> 'string' OR e #>> '{}' !~ '^[A-Za-z0-9_]{1,64}$') THEN
      RAISE EXCEPTION 'filter_limit' USING ERRCODE = '22023'; END IF;
  END LOOP;
  IF p_facet IS NOT NULL AND p_facet NOT IN ('diagnosis','sampleType','ageBand','sex','center','timepoint','availability','attachedData') THEN
    RAISE EXCEPTION 'unknown_facet' USING ERRCODE = '22023'; END IF;
END $$;

CREATE FUNCTION agg._neighbours(p_filters jsonb) RETURNS jsonb[] LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, portal, agg, pg_temp AS $$
DECLARE out jsonb[] := '{}'; kk text; v jsonb; i int; par text; res jsonb[];
BEGIN
  FOR kk, v IN SELECT * FROM jsonb_each(p_filters) LOOP
    out := out || (p_filters - kk);
    IF jsonb_array_length(v) > 1 THEN
      FOR i IN 0 .. jsonb_array_length(v) - 1 LOOP out := out || jsonb_set(p_filters, ARRAY[kk], v - i); END LOOP;
    END IF;
    IF kk = 'diagnosis' THEN
      FOR i IN 0 .. jsonb_array_length(v) - 1 LOOP
        SELECT parent_code INTO par FROM portal.diagnosis_terms WHERE diagnosis_code = v ->> i;
        IF par IS NOT NULL THEN out := out || jsonb_set(p_filters, ARRAY[kk], (v - i) || to_jsonb(par)); END IF;
      END LOOP;
    END IF;
  END LOOP;
  SELECT coalesce(array_agg(DISTINCT x), '{}') INTO res FROM unnest(out) x WHERE x <> p_filters;
  RETURN res;
END $$;

CREATE FUNCTION agg._total(p_filters jsonb) RETURNS int LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, agg, pg_temp AS $$
DECLARE dx text[] := agg._jarr(p_filters,'diagnosis'); st text[] := agg._jarr(p_filters,'sampleType'); ab text[] := agg._jarr(p_filters,'ageBand');
  sx text[] := agg._jarr(p_filters,'sex'); ce text[] := agg._jarr(p_filters,'centerId'); tp text[] := agg._jarr(p_filters,'timepoint');
  av text[] := agg._jarr(p_filters,'availability'); ad text[] := agg._jarr(p_filters,'attachedData'); n int;
BEGIN
  IF NOT (p_filters ?| ARRAY['sampleType','timepoint','availability','attachedData']) THEN
    SELECT count(*) INTO n FROM agg.donor_snapshot s
     WHERE (dx IS NULL OR dx && ARRAY[s.diagnosis_code, s.family_code, s.group_code]) AND (ab IS NULL OR s.age_band = ANY (ab))
       AND (sx IS NULL OR s.sex = ANY (sx)) AND (ce IS NULL OR s.center_id = ANY (ce));
    RETURN n;
  END IF;
  SELECT count(DISTINCT donor_ref) INTO n FROM agg.snapshot s
   WHERE (dx IS NULL OR dx && ARRAY[s.diagnosis_code, s.family_code, s.group_code]) AND (st IS NULL OR s.sample_type = ANY (st))
     AND (ab IS NULL OR s.age_band = ANY (ab)) AND (sx IS NULL OR s.sex = ANY (sx)) AND (ce IS NULL OR s.center_id = ANY (ce))
     AND (tp IS NULL OR s.timepoint = ANY (tp)) AND (av IS NULL OR s.availability = ANY (av)) AND (ad IS NULL OR s.attached_data @> ad);
  RETURN n;
END $$;

CREATE FUNCTION agg._leaf(p_filters jsonb, p_facet text) RETURNS TABLE (leaf text, n int) LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, agg, pg_temp AS $$
DECLARE dx text[] := agg._jarr(p_filters,'diagnosis'); st text[] := agg._jarr(p_filters,'sampleType'); ab text[] := agg._jarr(p_filters,'ageBand');
  sx text[] := agg._jarr(p_filters,'sex'); ce text[] := agg._jarr(p_filters,'centerId'); tp text[] := agg._jarr(p_filters,'timepoint');
  av text[] := agg._jarr(p_filters,'availability'); ad text[] := agg._jarr(p_filters,'attachedData');
BEGIN
  IF p_facet IN ('diagnosis','ageBand','sex','center') AND NOT (p_filters ?| ARRAY['sampleType','timepoint','availability','attachedData']) THEN
    RETURN QUERY SELECT CASE p_facet WHEN 'diagnosis' THEN s.diagnosis_code WHEN 'ageBand' THEN s.age_band WHEN 'sex' THEN s.sex ELSE s.center_id END, count(*)::int
      FROM agg.donor_snapshot s
     WHERE (dx IS NULL OR dx && ARRAY[s.diagnosis_code, s.family_code, s.group_code]) AND (ab IS NULL OR s.age_band = ANY (ab))
       AND (sx IS NULL OR s.sex = ANY (sx)) AND (ce IS NULL OR s.center_id = ANY (ce))
     GROUP BY 1;
    RETURN;
  END IF;
  IF p_facet = 'attachedData' THEN
    RETURN QUERY SELECT u.v, count(DISTINCT s.donor_ref)::int FROM agg.snapshot s, unnest(s.attached_data) u(v)
     WHERE (dx IS NULL OR dx && ARRAY[s.diagnosis_code, s.family_code, s.group_code]) AND (st IS NULL OR s.sample_type = ANY (st))
       AND (ab IS NULL OR s.age_band = ANY (ab)) AND (sx IS NULL OR s.sex = ANY (sx)) AND (ce IS NULL OR s.center_id = ANY (ce))
       AND (tp IS NULL OR s.timepoint = ANY (tp)) AND (av IS NULL OR s.availability = ANY (av)) AND (ad IS NULL OR s.attached_data @> ad)
     GROUP BY u.v;
  ELSE
    RETURN QUERY SELECT CASE p_facet WHEN 'diagnosis' THEN s.diagnosis_code WHEN 'sampleType' THEN s.sample_type WHEN 'ageBand' THEN s.age_band
                   WHEN 'sex' THEN s.sex WHEN 'center' THEN s.center_id WHEN 'timepoint' THEN s.timepoint ELSE s.availability END,
                 count(DISTINCT s.donor_ref)::int
      FROM agg.snapshot s
     WHERE (dx IS NULL OR dx && ARRAY[s.diagnosis_code, s.family_code, s.group_code]) AND (st IS NULL OR s.sample_type = ANY (st))
       AND (ab IS NULL OR s.age_band = ANY (ab)) AND (sx IS NULL OR s.sex = ANY (sx)) AND (ce IS NULL OR s.center_id = ANY (ce))
       AND (tp IS NULL OR s.timepoint = ANY (tp)) AND (av IS NULL OR s.availability = ANY (av)) AND (ad IS NULL OR s.attached_data @> ad)
     GROUP BY 1;
  END IF;
END $$;

-- cover material for every leaf of a facet in ONE scan (donor-level path when the query is donor-level only)
CREATE FUNCTION agg._leaf_cov(p_filters jsonb, p_facet text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, agg, pg_temp AS $$
DECLARE dx text[] := agg._jarr(p_filters,'diagnosis'); st text[] := agg._jarr(p_filters,'sampleType'); ab text[] := agg._jarr(p_filters,'ageBand');
  sx text[] := agg._jarr(p_filters,'sex'); ce text[] := agg._jarr(p_filters,'centerId'); tp text[] := agg._jarr(p_filters,'timepoint');
  av text[] := agg._jarr(p_filters,'availability'); ad text[] := agg._jarr(p_filters,'attachedData'); r jsonb;
BEGIN
  IF p_facet IN ('diagnosis','ageBand','sex','center') AND NOT (p_filters ?| ARRAY['sampleType','timepoint','availability','attachedData']) THEN
    SELECT jsonb_object_agg(g.leaf, jsonb_build_object('s', g.vs, 'a', g.va, 'c', g.vc, 'l', g.vl, 'f', g.vf, 'g', g.vg)) INTO r FROM (
      SELECT CASE p_facet WHEN 'diagnosis' THEN s.diagnosis_code WHEN 'ageBand' THEN s.age_band WHEN 'sex' THEN s.sex ELSE s.center_id END AS leaf,
             array_agg(DISTINCT s.sex) vs, array_agg(DISTINCT s.age_band) va, array_agg(DISTINCT s.center_id) vc, array_agg(DISTINCT s.diagnosis_code) vl,
             array_agg(DISTINCT s.family_code) vf, array_agg(DISTINCT s.group_code) vg
        FROM agg.donor_snapshot s
       WHERE (dx IS NULL OR dx && ARRAY[s.diagnosis_code, s.family_code, s.group_code]) AND (ab IS NULL OR s.age_band = ANY (ab))
         AND (sx IS NULL OR s.sex = ANY (sx)) AND (ce IS NULL OR s.center_id = ANY (ce)) GROUP BY 1) g;
  ELSIF p_facet = 'attachedData' THEN
    SELECT jsonb_object_agg(g.leaf, jsonb_build_object('s', g.vs, 'a', g.va, 'c', g.vc, 'l', g.vl, 'f', g.vf, 'g', g.vg)) INTO r FROM (
      SELECT u.v AS leaf, array_agg(DISTINCT s.sex) vs, array_agg(DISTINCT s.age_band) va, array_agg(DISTINCT s.center_id) vc, array_agg(DISTINCT s.diagnosis_code) vl,
             array_agg(DISTINCT s.family_code) vf, array_agg(DISTINCT s.group_code) vg
        FROM agg.snapshot s, unnest(s.attached_data) u(v)
       WHERE (dx IS NULL OR dx && ARRAY[s.diagnosis_code, s.family_code, s.group_code]) AND (st IS NULL OR s.sample_type = ANY (st))
         AND (ab IS NULL OR s.age_band = ANY (ab)) AND (sx IS NULL OR s.sex = ANY (sx)) AND (ce IS NULL OR s.center_id = ANY (ce))
         AND (tp IS NULL OR s.timepoint = ANY (tp)) AND (av IS NULL OR s.availability = ANY (av)) AND (ad IS NULL OR s.attached_data @> ad) GROUP BY 1) g;
  ELSE
    SELECT jsonb_object_agg(g.leaf, jsonb_build_object('s', g.vs, 'a', g.va, 'c', g.vc, 'l', g.vl, 'f', g.vf, 'g', g.vg)) INTO r FROM (
      SELECT CASE p_facet WHEN 'diagnosis' THEN s.diagnosis_code WHEN 'sampleType' THEN s.sample_type WHEN 'ageBand' THEN s.age_band WHEN 'sex' THEN s.sex
                          WHEN 'center' THEN s.center_id WHEN 'timepoint' THEN s.timepoint ELSE s.availability END AS leaf,
             array_agg(DISTINCT s.sex) vs, array_agg(DISTINCT s.age_band) va, array_agg(DISTINCT s.center_id) vc, array_agg(DISTINCT s.diagnosis_code) vl,
             array_agg(DISTINCT s.family_code) vf, array_agg(DISTINCT s.group_code) vg
        FROM agg.snapshot s
       WHERE (dx IS NULL OR dx && ARRAY[s.diagnosis_code, s.family_code, s.group_code]) AND (st IS NULL OR s.sample_type = ANY (st))
         AND (ab IS NULL OR s.age_band = ANY (ab)) AND (sx IS NULL OR s.sex = ANY (sx)) AND (ce IS NULL OR s.center_id = ANY (ce))
         AND (tp IS NULL OR s.timepoint = ANY (tp)) AND (av IS NULL OR s.availability = ANY (av)) AND (ad IS NULL OR s.attached_data @> ad) GROUP BY 1) g;
  END IF;
  RETURN coalesce(r, '{}'::jsonb);
END $$;
CREATE FUNCTION agg._cover_union(p_cov jsonb, p_members text[], p_key text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT array_agg(DISTINCT e) FROM jsonb_each(p_cov) j, jsonb_array_elements_text(j.value -> p_key) e WHERE j.key = ANY (p_members) $$;

-- Semantic supersets (cross-dimension differencing). A cell Q is also compared with the tightest single-dimension cover of its donors:
-- for sex, age band, center and diagnosis (leaf, else family, else group node, <= 3 values) we count the donors of (a) the cover alone and
-- (b) the cover combined with the query's own filters. Example: if every dmg donor sits in center A, total(center A) - cell(dmg) is a
-- superset difference that no syntactic neighbour rule sees. Residual risk (deeper multi-predicate combinations) is documented in db/README.md.
CREATE FUNCTION agg._extra(p_filters jsonb, p_facet text, p_members text[], p_n int, p_k int, p_cov jsonb DEFAULT NULL) RETURNS int[] LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, agg, pg_temp AS $$
DECLARE dx text[] := agg._jarr(p_filters,'diagnosis'); st text[] := agg._jarr(p_filters,'sampleType'); ab text[] := agg._jarr(p_filters,'ageBand');
  sx text[] := agg._jarr(p_filters,'sex'); ce text[] := agg._jarr(p_filters,'centerId'); tp text[] := agg._jarr(p_filters,'timepoint');
  av text[] := agg._jarr(p_filters,'availability'); ad text[] := agg._jarr(p_filters,'attachedData');
  vs text[]; va text[]; vc text[]; vl text[]; vf text[]; vg text[]; res int[] := '{}'; vd text[]; has_q boolean := p_filters <> '{}'::jsonb;
  bk text := CASE p_facet WHEN 'diagnosis' THEN 'diagnosis' WHEN 'sampleType' THEN 'sampleType' WHEN 'ageBand' THEN 'ageBand' WHEN 'sex' THEN 'sex'
                          WHEN 'center' THEN 'centerId' WHEN 'timepoint' THEN 'timepoint' WHEN 'availability' THEN 'availability' WHEN 'attachedData' THEN 'attachedData' END;
  qb jsonb := p_filters; bonly jsonb := '{}'; dim text; cov record; cj jsonb;
BEGIN
  IF p_facet IS NOT NULL THEN qb := p_filters || jsonb_build_object(bk, to_jsonb(p_members)); bonly := jsonb_build_object(bk, to_jsonb(p_members)); END IF;
  IF p_cov IS NOT NULL THEN
    vs := agg._cover_union(p_cov, p_members, 's'); va := agg._cover_union(p_cov, p_members, 'a'); vc := agg._cover_union(p_cov, p_members, 'c');
    vl := agg._cover_union(p_cov, p_members, 'l'); vf := agg._cover_union(p_cov, p_members, 'f'); vg := agg._cover_union(p_cov, p_members, 'g');
  ELSIF NOT (p_filters ?| ARRAY['sampleType','timepoint','availability','attachedData']) AND (p_facet IS NULL OR p_facet IN ('diagnosis','ageBand','sex','center')) THEN
    SELECT array_agg(DISTINCT s.sex), array_agg(DISTINCT s.age_band), array_agg(DISTINCT s.center_id), array_agg(DISTINCT s.diagnosis_code),
           array_agg(DISTINCT s.family_code), array_agg(DISTINCT s.group_code)
      INTO vs, va, vc, vl, vf, vg
      FROM agg.donor_snapshot s
     WHERE (dx IS NULL OR dx && ARRAY[s.diagnosis_code, s.family_code, s.group_code]) AND (ab IS NULL OR s.age_band = ANY (ab))
       AND (sx IS NULL OR s.sex = ANY (sx)) AND (ce IS NULL OR s.center_id = ANY (ce))
       AND (p_facet IS NULL OR CASE p_facet WHEN 'diagnosis' THEN s.diagnosis_code = ANY (p_members) WHEN 'ageBand' THEN s.age_band = ANY (p_members)
              WHEN 'sex' THEN s.sex = ANY (p_members) ELSE s.center_id = ANY (p_members) END);
  ELSE
  SELECT array_agg(DISTINCT s.sex), array_agg(DISTINCT s.age_band), array_agg(DISTINCT s.center_id), array_agg(DISTINCT s.diagnosis_code),
         array_agg(DISTINCT s.family_code), array_agg(DISTINCT s.group_code)
    INTO vs, va, vc, vl, vf, vg
    FROM agg.snapshot s
   WHERE (dx IS NULL OR dx && ARRAY[s.diagnosis_code, s.family_code, s.group_code]) AND (st IS NULL OR s.sample_type = ANY (st))
     AND (ab IS NULL OR s.age_band = ANY (ab)) AND (sx IS NULL OR s.sex = ANY (sx)) AND (ce IS NULL OR s.center_id = ANY (ce))
     AND (tp IS NULL OR s.timepoint = ANY (tp)) AND (av IS NULL OR s.availability = ANY (av)) AND (ad IS NULL OR s.attached_data @> ad)
     AND (p_facet IS NULL OR CASE p_facet WHEN 'diagnosis' THEN s.diagnosis_code = ANY (p_members) WHEN 'sampleType' THEN s.sample_type = ANY (p_members)
            WHEN 'ageBand' THEN s.age_band = ANY (p_members) WHEN 'sex' THEN s.sex = ANY (p_members) WHEN 'center' THEN s.center_id = ANY (p_members)
            WHEN 'timepoint' THEN s.timepoint = ANY (p_members) WHEN 'availability' THEN s.availability = ANY (p_members)
            ELSE s.attached_data && p_members END);
  END IF;
  FOR cov IN SELECT * FROM (VALUES ('sex', vs), ('ageBand', va), ('centerId', vc), ('diagnosis', vl), ('diagnosis', vf), ('diagnosis', vg)) t(dim, vals) LOOP
    CONTINUE WHEN cardinality(cov.vals) NOT BETWEEN 1 AND 3;
    dim := cov.dim; cj := jsonb_build_object(dim, to_jsonb(cov.vals));
    -- T1: the cover alone (cheap: precomputed donor counts per value)
    res := res || coalesce((SELECT sum(c.n)::int FROM agg.dim_counts c WHERE c.dim = cov.dim AND c.val = ANY (cov.vals)), 0);
    -- T2: own filters with the cover (replacing the same key); useful when it drops the bucket or replaces a filter on this key
    IF has_q AND (p_facet IS NOT NULL OR p_filters ? dim) THEN res := res || agg._total(p_filters || cj); END IF;
    -- T3: the bucket alone with the cover (drops the query's filters)
    IF p_facet IS NOT NULL AND has_q AND bk <> dim THEN res := res || agg._total(bonly || cj); END IF;
    -- T4: own filters + bucket with the cover replacing a filter on this key
    IF p_facet IS NOT NULL AND p_filters ? dim AND bk <> dim THEN res := res || agg._total(qb || cj); END IF;
  END LOOP;
  RETURN res;
END $$;
CREATE FUNCTION agg._cellvec(p_filters jsonb, p_facet text, p_members text[], p_base int[], p_k int, p_cov jsonb DEFAULT NULL) RETURNS int[] LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, agg, pg_temp AS $$ SELECT p_base || agg._extra(p_filters, p_facet, p_members, p_base[1], p_k, p_cov) $$;
-- narrower neighbours of a merged cell: the same cell with one member removed (additive facets only)
CREATE FUNCTION agg._member_minus(h agg.cell[], p_members text[]) RETURNS int[] LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN coalesce(array_length(p_members, 1), 0) NOT BETWEEN 2 AND 4 THEN '{}'::int[] ELSE
    coalesce((SELECT array_agg((SELECT sum(((z).vec[1])) FROM unnest(h) z WHERE (z).label = ANY (p_members)) - (y).vec[1]) FROM unnest(h) y WHERE (y).label = ANY (p_members)), '{}') END $$;
CREATE FUNCTION agg._hsum(h agg.cell[], only_labels text[], m int) RETURNS agg.cell LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN count(*) = 0 THEN NULL ELSE ROW('', '', ARRAY(SELECT (SELECT sum((y).vec[g])::int FROM unnest(h) y WHERE only_labels IS NULL OR (y).label = ANY (only_labels))
         FROM generate_series(1, m + 1) g ORDER BY g), array_agg((x).label))::agg.cell END
  FROM unnest(h) x WHERE only_labels IS NULL OR (x).label = ANY (only_labels) $$;

CREATE FUNCTION agg.total_count(p_filters jsonb DEFAULT '{}') RETURNS TABLE (n int, band text, masked boolean) LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, agg, portal, pg_temp AS $$
DECLARE k int := agg.k_for('default'); nb jsonb[]; vec int[]; x jsonb;
BEGIN
  PERFORM agg._validate(p_filters, NULL);
  nb := agg._neighbours(p_filters);
  vec := ARRAY[agg._total(p_filters)];
  FOREACH x IN ARRAY nb LOOP vec := vec || agg._total(x); END LOOP;
  vec := vec || agg._extra(p_filters, NULL, NULL, vec[1], k);
  IF NOT agg._safe(vec, k) THEN RETURN QUERY SELECT NULL::int, NULL::text, true; RETURN; END IF;
  RETURN QUERY SELECT CASE WHEN vec[1] >= 10 THEN vec[1] END, CASE WHEN vec[1] < 10 THEN 'lt10' END, false;
END $$;

CREATE FUNCTION agg.facet_counts(p_filters jsonb, p_facet text) RETURNS TABLE (bucket text, bucket_level text, n int, band text, masked boolean, merged boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, agg, portal, pg_temp AS $$
DECLARE
  k int; nb jsonb[]; m int; x jsonb; tv int[]; additive boolean; cells agg.cell[] := '{}'; hidden agg.cell[] := '{}';
  hv agg.cell; ev int[]; pull int; lf record; leaves agg.cell[] := '{}'; cov jsonb; fam record; masked_other boolean := false; pc agg.cell;
BEGIN
  PERFORM agg._validate(p_filters, p_facet);
  k := greatest(agg.k_for(CASE p_facet WHEN 'diagnosis' THEN 'diagnosis' WHEN 'center' THEN 'center' ELSE 'default' END), agg.k_for('default'));
  additive := p_facet IN ('diagnosis','ageBand','sex','center');
  nb := agg._neighbours(p_filters); m := coalesce(array_length(nb, 1), 0);
  -- leaf vectors: [n(q), n(q'_1) ... n(q'_m)]
  FOR lf IN
    WITH src AS (
      SELECT 1 AS idx, l.leaf, l.n FROM agg._leaf(p_filters, p_facet) l
      UNION ALL SELECT gi + 1, l.leaf, l.n FROM generate_series(1, m) gi, LATERAL agg._leaf(nb[gi], p_facet) l)
    SELECT y.leaf, ARRAY(SELECT coalesce((SELECT s.n FROM src s WHERE s.leaf = y.leaf AND s.idx = g), 0) FROM generate_series(1, m + 1) g ORDER BY g) AS vec
      FROM (SELECT DISTINCT src.leaf FROM src) y ORDER BY y.leaf LOOP
    leaves := leaves || ROW(lf.leaf, 'value', lf.vec, ARRAY[lf.leaf])::agg.cell;
  END LOOP;

  cov := agg._leaf_cov(p_filters, p_facet);
  -- totals of q and its neighbours: additive facets partition the donors, so the leaf counts sum to the total
  IF additive THEN tv := (SELECT (agg._hsum(leaves, NULL, m)).vec); END IF;
  IF tv IS NULL THEN
    tv := ARRAY[agg._total(p_filters)];
    FOREACH x IN ARRAY nb LOOP tv := tv || agg._total(x); END LOOP;
  END IF;
  tv := tv || agg._extra(p_filters, NULL, NULL, tv[1], k);
  IF NOT agg._safe(tv, k) THEN RETURN QUERY SELECT 'all'::text, 'other'::text, NULL::int, NULL::text, true, false; RETURN; END IF;

  FOREACH pc IN ARRAY leaves LOOP
    ev := NULL;
    IF (pc).vec[1] >= k THEN ev := agg._cellvec(p_filters, p_facet, (pc).members, (pc).vec, k, cov); END IF;
    IF ev IS NOT NULL AND agg._safe(ev, k) THEN cells := cells || ROW((pc).label, 'value', ev, (pc).members)::agg.cell;
    ELSE hidden := hidden || pc; END IF;
  END LOOP;

  IF p_facet = 'attachedData' THEN   -- overlapping flags: every flag shown alone or masked. Zero and small look identical.
    RETURN QUERY
      SELECT e::text, 'value'::text, (SELECT CASE WHEN (cc).vec[1] >= 10 THEN (cc).vec[1] END FROM unnest(cells) cc WHERE (cc).label = e::text),
             (SELECT CASE WHEN (cc).vec[1] < 10 THEN 'lt10' END FROM unnest(cells) cc WHERE (cc).label = e::text),
             NOT EXISTS (SELECT 1 FROM unnest(cells) cc WHERE (cc).label = e::text), false
        FROM unnest(enum_range(NULL::portal.attached_data_type)) e ORDER BY 1;
    RETURN;
  END IF;

  IF p_facet = 'diagnosis' AND array_length(hidden, 1) > 0 THEN
    -- tier 2: remaining types of one family; tier 3: remaining families of one group
    FOR fam IN SELECT f.fcode, array_agg((h).label) AS members
               FROM unnest(hidden) h JOIN LATERAL (SELECT CASE t.level WHEN 'type' THEN t.parent_code ELSE t.diagnosis_code END AS fcode
                    FROM portal.diagnosis_terms t WHERE t.diagnosis_code = (h).label) f ON true GROUP BY f.fcode LOOP
      hv := agg._hsum(hidden, fam.members, m);
      IF hv IS NOT NULL AND (hv).vec[1] >= k THEN
        ev := agg._cellvec(p_filters, p_facet, (hv).members, (hv).vec, k, cov) || agg._member_minus(hidden, (hv).members);
        IF agg._safe(ev, k) THEN
          cells := cells || ROW(fam.fcode, 'family_other', ev, (hv).members)::agg.cell;
          hidden := ARRAY(SELECT h FROM unnest(hidden) h WHERE NOT ((h).label = ANY (fam.members)));
        END IF;
      END IF;
    END LOOP;
    FOR fam IN SELECT g.gcode, array_agg((h).label) AS members
               FROM unnest(hidden) h JOIN LATERAL (SELECT CASE t.level WHEN 'type' THEN p.parent_code WHEN 'family' THEN t.parent_code ELSE t.diagnosis_code END AS gcode
                    FROM portal.diagnosis_terms t LEFT JOIN portal.diagnosis_terms p ON p.diagnosis_code = t.parent_code
                   WHERE t.diagnosis_code = (h).label) g ON true GROUP BY g.gcode LOOP
      hv := agg._hsum(hidden, fam.members, m);
      IF hv IS NOT NULL AND (hv).vec[1] >= k THEN
        ev := agg._cellvec(p_filters, p_facet, (hv).members, (hv).vec, k, cov) || agg._member_minus(hidden, (hv).members);
        IF agg._safe(ev, k) THEN
          cells := cells || ROW(fam.gcode, 'group_other', ev, (hv).members)::agg.cell;
          hidden := ARRAY(SELECT h FROM unnest(hidden) h WHERE NOT ((h).label = ANY (fam.members)));
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- remainder 'other' with complementary suppression (fixpoint): pull the smallest shown cell into the hidden set until safe
  LOOP
    hv := agg._hsum(hidden, NULL, m);
    EXIT WHEN hv IS NULL OR (hv).vec[1] = 0;
    IF (hv).vec[1] >= k THEN
      IF additive THEN
        ev := agg._cellvec(p_filters, p_facet, (hv).members, (hv).vec, k, cov) || agg._member_minus(hidden, (hv).members);
        IF agg._safe(ev, k) THEN cells := cells || ROW('other', 'other', ev, (hv).members)::agg.cell; EXIT; END IF;
      ELSE masked_other := true; EXIT; END IF;
    END IF;
    IF coalesce(array_length(cells, 1), 0) = 0 THEN masked_other := true; EXIT; END IF;
    SELECT z.ix INTO pull FROM (SELECT ix, ((cells)[ix]).vec[1] v FROM generate_subscripts(cells, 1) ix ORDER BY v, ix LIMIT 1) z;
    pc := cells[pull];
    hidden := hidden || ROW(CASE WHEN (pc).lvl = 'value' THEN (pc).label ELSE (pc).label || '#' || pull END, 'value', (pc).vec[1:m + 1], (pc).members)::agg.cell;
    cells := cells[1:pull - 1] || cells[pull + 1:coalesce(array_length(cells, 1), 0)];
  END LOOP;

  RETURN QUERY
    SELECT (cc).label, (cc).lvl, CASE WHEN (cc).vec[1] >= 10 THEN (cc).vec[1] END, CASE WHEN (cc).vec[1] < 10 THEN 'lt10' END, false,
           (cc).lvl <> 'value'
      FROM unnest(cells) cc ORDER BY (cc).vec[1] DESC, (cc).label;
  IF masked_other THEN RETURN QUERY SELECT 'other'::text, 'other'::text, NULL::int, NULL::text, true, true; END IF;
END $$;

GRANT EXECUTE ON FUNCTION agg._jarr(jsonb,text), agg._safe(int[],int), agg._vadd(int[],int[]), agg._hsum(agg.cell[],text[],int), agg._member_minus(agg.cell[],text[]) TO PUBLIC;
GRANT EXECUTE ON FUNCTION agg._validate(jsonb,text) TO app_agg;
GRANT EXECUTE ON FUNCTION agg.k_for(text) TO app_agg;
GRANT EXECUTE ON FUNCTION agg.total_count(jsonb), agg.facet_counts(jsonb,text), agg.current_epoch() TO app_runtime;
GRANT EXECUTE ON FUNCTION agg.refresh_snapshot() TO app_readonly_bg, app_migrator, app_runtime;
GRANT EXECUTE ON FUNCTION portal.cur_user_id(), portal.cur_role(), portal.cur_center_id() TO app_agg;
SELECT portal._assign_owners();
