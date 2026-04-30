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
  v_existing_inventory_count int;
BEGIN
  FOR ret IN
    SELECT fr.id, fr.tracking_number
    FROM public.fedex_returns fr
    WHERE NOT EXISTS (SELECT 1 FROM public.fedex_return_items fri WHERE fri.return_id = fr.id)
  LOOP
    -- Step 1: Ensure sku_metadata exists with is_bike=true. Forces the flag
    -- to TRUE even if the row already existed with NULL/false (legacy).
    INSERT INTO public.sku_metadata (sku, is_bike)
    VALUES (ret.tracking_number, true)
    ON CONFLICT (sku) DO UPDATE SET is_bike = true
      WHERE sku_metadata.is_bike IS DISTINCT FROM true;

    -- Step 2: If ANY inventory row already exists for this tracking (in any
    -- location — FDX, FDX 1, FDX RETURNS, CAGE, etc., legacy data), DO NOT
    -- create a new placeholder. The legacy row already represents this bike;
    -- creating another would double-count physical stock. Consolidation of
    -- legacy FDX-like locations into the canonical "FDX" is tracked under
    -- idea-100 in BACKLOG.md.
    SELECT COUNT(*) INTO v_existing_inventory_count
    FROM public.inventory i
    WHERE i.sku = ret.tracking_number;

    IF v_existing_inventory_count = 0 THEN
      v_location_id := public.resolve_location('LUDLOW', 'FDX', 'admin');
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
    END IF;

    -- Step 3: Always link via fedex_return_items so search-by-tracking + badge
    -- find the row (whether canonical or legacy).
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
