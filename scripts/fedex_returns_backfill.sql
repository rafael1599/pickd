-- One-shot backfill: creates placeholder inventory rows + sku_metadata +
-- fedex_return_items for every fedex_returns row that has no items yet.
-- Idempotent — safe to re-run.
--
-- Run AFTER applying migration 20260430120000_search_inventory_fedex_returns.sql
-- AND AFTER deploying the new useAddFedExReturn (otherwise old returns and
-- new returns will both fight for the placeholder).
--
-- Usage:
--   npx supabase db query --linked < scripts/fedex_returns_backfill.sql
-- (or paste into Supabase SQL editor)

DO $$
DECLARE
  ret RECORD;
  v_location_id uuid;
BEGIN
  FOR ret IN
    SELECT fr.id, fr.tracking_number
    FROM public.fedex_returns fr
    WHERE NOT EXISTS (SELECT 1 FROM public.fedex_return_items fri WHERE fri.return_id = fr.id)
  LOOP
    -- 1. Ensure sku_metadata exists with is_bike=true (returns are always bikes).
    INSERT INTO public.sku_metadata (sku, is_bike)
    VALUES (ret.tracking_number, true)
    ON CONFLICT (sku) DO UPDATE SET is_bike = true
      WHERE sku_metadata.is_bike IS DISTINCT FROM true;

    -- 2. Resolve LUDLOW.FDX location.
    v_location_id := public.resolve_location('LUDLOW', 'FDX', 'admin');

    -- 3. Create inventory row at LUDLOW.FDX with qty=1, is_active=true.
    INSERT INTO public.inventory (sku, warehouse, location, location_id, quantity, is_active, item_name)
    VALUES (
      ret.tracking_number,
      'LUDLOW',
      'FDX',
      v_location_id,
      1,
      true,
      'FedEx Return ' || ret.tracking_number
    )
    ON CONFLICT (warehouse, sku, location) DO UPDATE
      SET quantity = GREATEST(inventory.quantity, 1),
          is_active = true;

    -- 4. Link via fedex_return_items so search-by-tracking + badge work.
    INSERT INTO public.fedex_return_items (return_id, sku, item_name, quantity, condition, target_warehouse)
    VALUES (
      ret.id,
      ret.tracking_number,
      'FedEx Return ' || ret.tracking_number,
      1,
      'unknown',
      'LUDLOW'
    );
  END LOOP;
END$$;
