-- ============================================================================
-- idea-055: Verification Queue Redesign — shipping_type column
--
-- Adds explicit shipping classification to picking_lists. NULL means the
-- frontend auto-classifies using weight/item-count rules:
--   1. Any item > 50 lbs → 'regular'
--   2. Total items >= 5   → 'regular'
--   3. Otherwise          → 'fedex'
--
-- The value is persisted when:
--   - Admin drag-reclassifies in the Verification Board
--   - Order is completed (auto-calculated value saved)
--
-- No CHECK constraint — left open for future types ('pickup', 'express', etc.)
-- ============================================================================

ALTER TABLE public.picking_lists
  ADD COLUMN IF NOT EXISTS shipping_type text DEFAULT NULL;

COMMENT ON COLUMN public.picking_lists.shipping_type IS
  'idea-055: shipping classification. NULL = auto-calculated by frontend (weight/count rules). Explicitly set on drag reclassify or on completion. Values: fedex, regular (extensible).';

-- Smoke test
DO $smoke$
DECLARE
  v_col_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'picking_lists'
      AND column_name = 'shipping_type'
  ) INTO v_col_exists;

  ASSERT v_col_exists, 'shipping_type column not found on picking_lists';
  RAISE NOTICE 'idea-055 smoke: shipping_type column exists ✓';
END $smoke$;
