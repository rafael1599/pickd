-- ============================================================================
-- Fix create_daily_snapshot — exclude inventory rows with NULL location
--
-- Bug: create_daily_snapshot did `INSERT INTO daily_inventory_snapshots
--      SELECT FROM inventory WHERE is_active AND quantity > 0` without
--      filtering NULL location. The destination column `location` is NOT NULL,
--      so the INSERT failed with "null value in column location violates
--      not-null constraint", and the cron stopped producing snapshots.
--
-- How orphaned rows get created (separate bug, tracked as bug-017 in backlog):
--   The auto_cancel_stale_orders function calls adjust_inventory_quantity
--   with v_location pulled from picking_lists.items[].location, which is NULL
--   for items that were never assigned a location during picking. When such
--   orders are auto-cancelled and inventory is "restored", a row with
--   location = NULL gets created in inventory.
--
-- This migration only fixes the snapshot RPC. The orphaned-row bug is
-- tracked separately and requires deciding whether those rows should exist
-- at all (they currently look like artifacts: item_name = "Auto-cancel
-- verification timeout", quantity = 1, location = NULL).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_daily_snapshot(
  p_snapshot_date date DEFAULT (public.current_ny_date() - 1)
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_count INTEGER;
BEGIN
  DELETE FROM daily_inventory_snapshots
  WHERE snapshot_date = p_snapshot_date;

  INSERT INTO daily_inventory_snapshots
    (snapshot_date, warehouse, location, sku, quantity, location_id, sku_note)
  SELECT
    p_snapshot_date,
    warehouse,
    location,
    sku,
    quantity,
    location_id,
    item_name
  FROM inventory
  WHERE is_active = TRUE
    AND quantity > 0
    AND location IS NOT NULL;  -- exclude orphaned rows from auto-cancel restore bug

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'success',       true,
    'snapshot_date', p_snapshot_date,
    'items_saved',   v_count,
    'created_at',    NOW()
  );
END;
$function$;

COMMENT ON FUNCTION public.create_daily_snapshot(date) IS
  'Creates a snapshot of current inventory for the specified date. Idempotent (overwrites existing snapshot). Default p_snapshot_date is current_ny_date() - 1 (the NY day that just closed). Excludes inventory rows with NULL location, which are artifacts of the auto-cancel restore bug (bug-017).';
