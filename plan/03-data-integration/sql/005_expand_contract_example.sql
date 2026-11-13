-- ILLUSTRATIVE (not applied in v1). Example of an expand/contract change: rename samples.quantity_class -> quantity_band.
-- Each numbered step is its own migration and its own release. Forward-only. No down scripts.

-- ===== Release N (EXPAND): add the new column, dual-write by trigger, backfill in batches =====
-- 0101_expand_quantity_band.sql
ALTER TABLE portal.samples ADD COLUMN quantity_band portal.quantity_class;
CREATE FUNCTION portal.samples_sync_quantity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.quantity_band IS DISTINCT FROM OLD.quantity_band OR TG_OP = 'INSERT' AND NEW.quantity_band IS NOT NULL THEN
    NEW.quantity_class := NEW.quantity_band;
  ELSIF NEW.quantity_class IS DISTINCT FROM OLD.quantity_class OR TG_OP = 'INSERT' THEN
    NEW.quantity_band := NEW.quantity_class;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_samples_sync_quantity BEFORE INSERT OR UPDATE ON portal.samples
  FOR EACH ROW EXECUTE FUNCTION portal.samples_sync_quantity();

-- 0102_backfill_quantity_band.sql (run by the migration job in batches of 1000, idempotent)
-- UPDATE portal.samples SET quantity_band = quantity_class
--  WHERE id IN (SELECT id FROM portal.samples WHERE quantity_band IS DISTINCT FROM quantity_class LIMIT 1000);

-- ===== Release N+1: code reads and writes ONLY quantity_band. Old code is gone from production. =====

-- ===== Release N+2 (CONTRACT): after one full release cycle and a verified export/import round trip =====
-- 0201_contract_quantity_class.sql
-- DROP TRIGGER trg_samples_sync_quantity ON portal.samples;
-- DROP FUNCTION portal.samples_sync_quantity();
-- ALTER TABLE portal.samples DROP COLUMN quantity_class;
-- Dependent views and the OpenAPI field name change must ship in release N+1, not here.
