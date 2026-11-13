-- Migration 0004: repeat-value views (REQ-068, REQ-066). security_invoker: RLS of the caller applies.
-- Clinician sees own center only. Coordinator sees all centers. External roles get no grant.
SET search_path = portal, ext, public;

CREATE VIEW portal.v_center_summary WITH (security_invoker = true) AS
SELECT s.source_center_id AS center_id,
       count(*)                                         AS samples_total,
       count(*) FILTER (WHERE s.availability = 'available') AS samples_available,
       count(*) FILTER (WHERE s.availability = 'limited')   AS samples_limited,
       count(*) FILTER (WHERE s.availability = 'depleted')  AS samples_depleted,
       count(*) FILTER (WHERE st.staleness = 'stale')       AS stale_count,
       count(*) FILTER (WHERE st.staleness = 'due_soon')    AS due_soon_count,
       count(*) FILTER (WHERE s.ethics_approval_id IS NULL) AS missing_ethics_link,
       max(s.updated_at)                                AS last_update_at
FROM portal.samples s
JOIN portal.v_sample_staleness st ON st.sample_id = s.id
GROUP BY s.source_center_id;

-- Field completeness per center. Optional fields only. Used for REQ-066 and the clinician value screen.
CREATE VIEW portal.v_center_completeness WITH (security_invoker = true) AS
SELECT s.source_center_id AS center_id,
       count(*) AS samples_total,
       round(100.0 * count(*) FILTER (WHERE s.quantity_class IS NOT NULL) / count(*), 1) AS pct_quantity_class,
       round(100.0 * count(*) FILTER (WHERE s.ethics_approval_id IS NOT NULL) / count(*), 1) AS pct_ethics_linked,
       round(100.0 * count(*) FILTER (WHERE s.consent_status <> 'unknown') / count(*), 1) AS pct_consent_known,
       round(100.0 * count(*) FILTER (WHERE cardinality(s.attached_data) > 0) / count(*), 1) AS pct_with_attached_data
FROM portal.samples s
WHERE s.deleted_at IS NULL
GROUP BY s.source_center_id;

-- Requests that touched this center's samples (counts only). Shows the clinician the value of feeding the index.
-- Reads request_item_samples through a definer function so the clinician needs no grant on that table.
CREATE FUNCTION portal.center_request_activity(p_center text)
RETURNS TABLE (requests_total int, requests_delivered int, samples_requested int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = portal, pg_catalog AS $$
  SELECT count(DISTINCT r.id)::int,
         count(DISTINCT r.id) FILTER (WHERE r.status = 'delivered')::int,
         count(DISTINCT ris.sample_id)::int
  FROM portal.request_item_samples ris
  JOIN portal.samples s ON s.id = ris.sample_id AND s.source_center_id = p_center
  JOIN portal.request_items ri ON ri.id = ris.request_item_id
  JOIN portal.requests r ON r.id = ri.request_id
  WHERE p_center = portal.cur_center_id() OR current_setting('role') = 'portal_coordinator'
$$;
REVOKE ALL ON FUNCTION portal.center_request_activity(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION portal.center_request_activity(text) TO portal_clinician, portal_coordinator;

GRANT SELECT ON portal.v_center_summary, portal.v_center_completeness TO portal_clinician, portal_coordinator;
