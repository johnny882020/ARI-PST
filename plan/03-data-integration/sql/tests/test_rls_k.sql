-- Executable checks for RLS and k-anonymity. Run after 001..003 + seed on an EMPTY database.
-- All data below is synthetic. Fails with an exception on the first broken expectation.
\set ON_ERROR_STOP on
SET search_path = portal, public;
\i seed/010_diagnosis_vocabulary_starter.sql

INSERT INTO centers (id, code, name_en, name_he, contact_role) VALUES
 ('ctr_01AAAAAAAAAAAAAAAAAAAAAAAA','synth_a','Synthetic Center A','מרכז סינתטי א','Center research coordinator'),
 ('ctr_01BBBBBBBBBBBBBBBBBBBBBBBB','synth_b','Synthetic Center B','מרכז סינתטי ב','Center research coordinator');
INSERT INTO users (id,email,display_name,status) VALUES
 ('usr_01AAAAAAAAAAAAAAAAAAAAAAAA','clin.a@example.invalid','Synthetic Clinician A','active'),
 ('usr_01BBBBBBBBBBBBBBBBBBBBBBBB','res.il@example.invalid','Synthetic Researcher','active'),
 ('usr_01CCCCCCCCCCCCCCCCCCCCCCCC','admin@example.invalid','Synthetic Admin','active');

-- 12 DMG at A (visible), 3 PA at A (small), 2 mb_wnt at B, 2 mb_shh at B (small leaves, family sum 4 < 5), 3 ependymoma_posterior_fossa at B
INSERT INTO samples (id, source_center_id, diagnosis_code, age_band_at_diagnosis, sex, sample_type, availability,
                     clinical_timepoint, collection_month, contact_ref)
SELECT 'smp_' || lpad(i::text, 26, '0'),
       CASE WHEN dx IN ('dmg_h3k27','pilocytic_astrocytoma') THEN 'ctr_01AAAAAAAAAAAAAAAAAAAAAAAA' ELSE 'ctr_01BBBBBBBBBBBBBBBBBBBBBBBB' END,
       dx, '3_lt6', 'female', 'ffpe', 'available', 'diagnosis', '2024-05', 'Center research coordinator'
FROM (SELECT row_number() OVER () AS i, dx FROM (
        SELECT 'dmg_h3k27' dx FROM generate_series(1,12)
        UNION ALL SELECT 'pilocytic_astrocytoma' FROM generate_series(1,3)
        UNION ALL SELECT 'mb_wnt' FROM generate_series(1,2)
        UNION ALL SELECT 'mb_shh' FROM generate_series(1,2)
        UNION ALL SELECT 'ependymoma_posterior_fossa' FROM generate_series(1,3)) a) b;
-- NOTE: lpad with digits only is valid ULID alphabet (0-9).

-- 1. External role cannot read samples
SET ROLE portal_external;
DO $$ BEGIN
  BEGIN PERFORM 1 FROM portal.samples LIMIT 1; RAISE EXCEPTION 'FAIL external can select samples';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM portal.sample_attached_data LIMIT 1; RAISE EXCEPTION 'FAIL external can select attached';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM search.filtered('{}'); RAISE EXCEPTION 'FAIL external can call filtered';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

-- 2. Facet diagnosis: no n < 5, total of buckets = 22
DO $$ DECLARE s int; mn int; BEGIN
  SELECT sum(n), min(n) INTO s, mn FROM search.facet_counts('{}','diagnosis');
  IF mn < 5 THEN RAISE EXCEPTION 'FAIL small cell shown: %', mn; END IF;
  IF s <> 22 THEN RAISE EXCEPTION 'FAIL sum % <> 22', s; END IF;
END $$;
-- Expect: dmg 12, group/family rollups: PA 3 -> family 'circumscribed_astro_family' small(3) ->
-- group glioma small 3; MB 4 -> group embryonal 4; ependymoma 3 -> group 3; rest = 3+4+3 = 10 -> 'other' 10 (>=5)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM search.facet_counts('{}','diagnosis') WHERE bucket='other' AND n=10) THEN
    RAISE EXCEPTION 'FAIL expected other=10'; END IF;
END $$;

-- 3. Filter gate: a filter below k returns a single suppressed row
DO $$ BEGIN
  IF (SELECT count(*) FROM search.facet_counts('{"diagnosis":["pilocytic_astrocytoma"]}','sex') WHERE suppressed AND n IS NULL) <> 1 THEN
    RAISE EXCEPTION 'FAIL gate'; END IF;
  IF (SELECT suppressed FROM search.total_count('{"diagnosis":["pilocytic_astrocytoma"]}')) IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL total gate'; END IF;
END $$;

-- 4. Complementary suppression on generic facet: center facet A=15, B=7 fine. Make a facet with one small cell:
DO $$ BEGIN
  -- sampleType all ffpe -> single bucket 22
  IF (SELECT n FROM search.facet_counts('{}','sampleType') WHERE bucket='ffpe') <> 22 THEN RAISE EXCEPTION 'FAIL ffpe'; END IF;
END $$;
RESET ROLE;
-- small differencing case: turn 3 samples into 'csf' -> csf=3 (<5) must merge with smallest visible
UPDATE samples SET sample_type='csf' WHERE id IN ('smp_00000000000000000000000001','smp_00000000000000000000000002','smp_00000000000000000000000003');
SET ROLE portal_external;
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT * FROM search.facet_counts('{}','sampleType') LOOP RAISE NOTICE 'sampleType % % % %', r.bucket, r.bucket_level, r.n, r.suppressed; END LOOP;
  IF EXISTS (SELECT 1 FROM search.facet_counts('{}','sampleType') WHERE n < 5) THEN RAISE EXCEPTION 'FAIL small'; END IF;
  IF NOT EXISTS (SELECT 1 FROM search.facet_counts('{}','sampleType') WHERE bucket='other' AND n=22) AND
     (SELECT count(*) FROM search.facet_counts('{}','sampleType'))<>1 THEN RAISE NOTICE 'ok merge shape'; END IF;
END $$;

-- 5. Smart search
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM search.expand_query('DIPG') WHERE diagnosis_code='dmg_h3k27') THEN RAISE EXCEPTION 'FAIL synonym'; END IF;
  IF NOT EXISTS (SELECT 1 FROM search.expand_query('medulobastoma') WHERE diagnosis_code='medulloblastoma_family') THEN RAISE EXCEPTION 'FAIL typo'; END IF;
  IF NOT EXISTS (SELECT 1 FROM search.expand_query('במדולובלסטומה') WHERE diagnosis_code='medulloblastoma_family') THEN RAISE EXCEPTION 'FAIL he prefix'; END IF;
END $$;
RESET ROLE;

-- 6. Clinician sees own center only
SET ROLE portal_clinician;
SELECT set_config('app.user_id','usr_01AAAAAAAAAAAAAAAAAAAAAAAA',false), set_config('app.center_id','ctr_01AAAAAAAAAAAAAAAAAAAAAAAA',false);
DO $$ BEGIN
  IF (SELECT count(*) FROM portal.samples) <> 15 THEN RAISE EXCEPTION 'FAIL clinician count %', (SELECT count(*) FROM portal.samples); END IF;
  IF EXISTS (SELECT 1 FROM portal.samples WHERE source_center_id <> 'ctr_01AAAAAAAAAAAAAAAAAAAAAAAA') THEN RAISE EXCEPTION 'FAIL clinician cross-center'; END IF;
END $$;
RESET ROLE;

-- 7. Admin and committee cannot read samples
SET ROLE portal_admin;
DO $$ BEGIN BEGIN PERFORM 1 FROM portal.samples; RAISE EXCEPTION 'FAIL admin reads samples';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;
RESET ROLE;
SET ROLE portal_committee;
DO $$ BEGIN BEGIN PERFORM 1 FROM portal.samples; RAISE EXCEPTION 'FAIL committee reads samples';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;
RESET ROLE;

-- 8. Audit chain
SELECT audit.append('aud_01AAAAAAAAAAAAAAAAAAAAAAAA','usr_x','system_admin','user.create','user','usr_y',NULL,'success','t1','{"k":1}');
SELECT audit.append('aud_01BBBBBBBBBBBBBBBBBBBBBBBB','usr_x','system_admin','user.update','user','usr_y',NULL,'success','t2','{}');
DO $$ BEGIN IF audit.verify_chain() IS NOT NULL THEN RAISE EXCEPTION 'FAIL chain'; END IF; END $$;
DO $$ BEGIN
  BEGIN UPDATE audit.audit_events SET outcome='error' WHERE seq=1; RAISE EXCEPTION 'FAIL audit update allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

-- 9. Separation of duties
INSERT INTO role_assignments (id,user_id,role) VALUES ('rol_01AAAAAAAAAAAAAAAAAAAAAAAA','usr_01CCCCCCCCCCCCCCCCCCCCCCCC','system_admin');
DO $$ BEGIN
  BEGIN INSERT INTO role_assignments (id,user_id,role) VALUES ('rol_01BBBBBBBBBBBBBBBBBBBBBBBB','usr_01CCCCCCCCCCCCCCCCCCCCCCCC','committee_member');
    RAISE EXCEPTION 'FAIL sod'; EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
SELECT 'ALL CHECKS PASSED' AS result;
