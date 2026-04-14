-- ─────────────────────────────────────────────────────────────────────────────
-- Fix is_bike classification: prefix-only rule replaces regex
-- 2026-04-14
--
-- Old rule: regex ^\d{2}-\d{4}[A-Za-z]{2,}$ OR prefix IN (01,03,05,06,07)
-- Problem: matched parts like 12-0506BK (tape), 66-0110BK (stems), etc.
--
-- New rule: prefix IN (01, 02, 03, 06, 07) = bike. Everything else = part.
-- 09- (framesets) intentionally excluded.
--
-- Manual overrides (is_bike set explicitly by user) are PRESERVED.
-- The trigger is updated to use the new rule for new SKUs.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Reclassify all existing SKUs using prefix-only rule.
--    This overwrites the broken regex-based classification.
UPDATE sku_metadata
SET is_bike = CASE
  WHEN LEFT(sku, 2) IN ('01','02','03','06','07') THEN true
  ELSE false
END;

-- 2. Update the trigger function to use the new rule for new SKUs.
--    Only fires when is_bike IS NULL (manual overrides respected).
CREATE OR REPLACE FUNCTION set_is_bike_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.is_bike IS NULL THEN
    NEW.is_bike := LEFT(NEW.sku, 2) IN ('01','02','03','06','07');
  END IF;
  RETURN NEW;
END;
$$;

-- Recreate trigger (idempotent)
DROP TRIGGER IF EXISTS tr_sku_metadata_set_is_bike ON sku_metadata;
CREATE TRIGGER tr_sku_metadata_set_is_bike
  BEFORE INSERT ON sku_metadata
  FOR EACH ROW
  EXECUTE FUNCTION set_is_bike_on_insert();
