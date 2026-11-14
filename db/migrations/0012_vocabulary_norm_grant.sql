-- 0012 app_core may execute search.norm(). kind: expand
-- The trigram and full-text indexes on portal.diagnosis_terms and portal.diagnosis_synonyms call search.norm(). app_core (the definer
-- role that owns the vocabulary write path) had no EXECUTE on it, so the pre-deploy step could not load the vocabulary without the
-- synthetic seed. On a real-data deployment the vocabulary stayed empty and no sample could be created or imported (review R-13).
-- search.norm() is owned by app_agg (0001 _assign_owners). Grant as the owner. No other change in reach.
SET LOCAL ROLE app_agg;
GRANT EXECUTE ON FUNCTION search.norm(text) TO app_core;
RESET ROLE;
