-- ============================================================================
-- Reopen Completed Orders: Schema + RPCs
-- Allows reopening a completed picking list to add/remove/modify items,
-- then re-completing with inventory delta calculation.
-- ============================================================================

-- 1. New columns on picking_lists
ALTER TABLE picking_lists ADD COLUMN IF NOT EXISTS completed_snapshot jsonb;
ALTER TABLE picking_lists ADD COLUMN IF NOT EXISTS reopened_by uuid REFERENCES profiles(id);
ALTER TABLE picking_lists ADD COLUMN IF NOT EXISTS reopened_at timestamptz;
ALTER TABLE picking_lists ADD COLUMN IF NOT EXISTS reopen_count integer DEFAULT 0;

-- 2. Update CHECK constraint to include 'reopened'
ALTER TABLE picking_lists DROP CONSTRAINT IF EXISTS picking_lists_status_check;
ALTER TABLE picking_lists ADD CONSTRAINT picking_lists_status_check
  CHECK (status = ANY (ARRAY[
    'active'::text, 'ready_to_double_check'::text, 'double_checking'::text,
    'needs_correction'::text, 'completed'::text, 'cancelled'::text, 'reopened'::text
  ]));

-- 3. Index for reopened orders
CREATE INDEX IF NOT EXISTS idx_picking_lists_reopened
  ON picking_lists(status) WHERE status = 'reopened';

-- ============================================================================
-- RPC: reopen_picking_list
-- Transitions a completed order to 'reopened', saving a snapshot of items.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.reopen_picking_list(
  p_list_id uuid,
  p_reopened_by uuid,
  p_reason text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_list RECORD;
BEGIN
  -- Lock the row
  SELECT * INTO v_list FROM picking_lists
  WHERE id = p_list_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Picking list % not found', p_list_id;
  END IF;

  -- Only completed orders can be reopened
  IF v_list.status != 'completed' THEN
    RAISE EXCEPTION 'Cannot reopen: status is %, expected completed', v_list.status;
  END IF;

  -- Save snapshot and transition to reopened
  UPDATE picking_lists SET
    status = 'reopened',
    completed_snapshot = items,
    reopened_by = p_reopened_by,
    reopened_at = NOW(),
    reopen_count = COALESCE(reopen_count, 0) + 1,
    updated_at = NOW()
  WHERE id = p_list_id;

  -- Log the reopen action
  INSERT INTO picking_list_notes (list_id, user_id, message)
  VALUES (
    p_list_id,
    p_reopened_by,
    'Order reopened for editing. Reason: ' || COALESCE(p_reason, 'Not specified')
  );

  RETURN TRUE;
END;
$$;

-- ============================================================================
-- RPC: recomplete_picking_list
-- Re-completes a reopened order, calculating and applying inventory deltas.
-- Only adjusts the DIFFERENCE between snapshot and current items.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.recomplete_picking_list(
  p_list_id uuid,
  p_performed_by text,
  p_user_id uuid,
  p_pallets_qty integer DEFAULT NULL,
  p_total_units integer DEFAULT NULL,
  p_user_role text DEFAULT 'staff'
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_list RECORD;
  v_snap_item jsonb;
  v_curr_item jsonb;
  v_key text;
  v_snap_qty integer;
  v_curr_qty integer;
  v_delta integer;
  v_sku text;
  v_warehouse text;
  v_location text;
  v_order_number text;
  v_reopen_count integer;
  -- Use temporary tables for the maps
  v_snap_keys text[];
  v_curr_keys text[];
  v_sku_not_found boolean;
BEGIN
  -- Lock and validate
  SELECT * INTO v_list FROM picking_lists
  WHERE id = p_list_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Picking list % not found', p_list_id;
  END IF;

  IF v_list.status != 'reopened' THEN
    RAISE EXCEPTION 'Cannot recomplete: status is %, expected reopened', v_list.status;
  END IF;

  IF v_list.completed_snapshot IS NULL THEN
    RAISE EXCEPTION 'No snapshot found for reopened order %', p_list_id;
  END IF;

  -- Must have at least one item
  IF jsonb_array_length(v_list.items) = 0 THEN
    RAISE EXCEPTION 'Cannot recomplete with zero items';
  END IF;

  v_order_number := v_list.order_number;
  v_reopen_count := COALESCE(v_list.reopen_count, 1);

  -- ========================================================================
  -- Build snapshot map using a temp table
  -- Key = sku::warehouse::location for unique identification
  -- ========================================================================
  CREATE TEMP TABLE IF NOT EXISTS _snap_map (
    item_key text PRIMARY KEY,
    sku text,
    warehouse text,
    location text,
    qty integer
  ) ON COMMIT DROP;
  TRUNCATE _snap_map;

  CREATE TEMP TABLE IF NOT EXISTS _curr_map (
    item_key text PRIMARY KEY,
    sku text,
    warehouse text,
    location text,
    qty integer
  ) ON COMMIT DROP;
  TRUNCATE _curr_map;

  -- Populate snapshot map
  FOR v_snap_item IN SELECT * FROM jsonb_array_elements(v_list.completed_snapshot) LOOP
    v_sku_not_found := COALESCE((v_snap_item->>'sku_not_found')::boolean, false);
    IF v_sku_not_found THEN CONTINUE; END IF;

    v_sku := v_snap_item->>'sku';
    v_warehouse := v_snap_item->>'warehouse';
    v_location := COALESCE(v_snap_item->>'location', '');
    v_snap_qty := COALESCE((v_snap_item->>'pickingQty')::integer, 0);

    IF v_snap_qty <= 0 THEN CONTINUE; END IF;

    v_key := v_sku || '::' || v_warehouse || '::' || v_location;

    INSERT INTO _snap_map (item_key, sku, warehouse, location, qty)
    VALUES (v_key, v_sku, v_warehouse, v_location, v_snap_qty)
    ON CONFLICT (item_key) DO UPDATE SET qty = _snap_map.qty + v_snap_qty;
  END LOOP;

  -- Populate current items map
  FOR v_curr_item IN SELECT * FROM jsonb_array_elements(v_list.items) LOOP
    v_sku_not_found := COALESCE((v_curr_item->>'sku_not_found')::boolean, false);
    IF v_sku_not_found THEN CONTINUE; END IF;

    v_sku := v_curr_item->>'sku';
    v_warehouse := v_curr_item->>'warehouse';
    v_location := COALESCE(v_curr_item->>'location', '');
    v_curr_qty := COALESCE((v_curr_item->>'pickingQty')::integer, 0);

    IF v_curr_qty <= 0 THEN CONTINUE; END IF;

    v_key := v_sku || '::' || v_warehouse || '::' || v_location;

    INSERT INTO _curr_map (item_key, sku, warehouse, location, qty)
    VALUES (v_key, v_sku, v_warehouse, v_location, v_curr_qty)
    ON CONFLICT (item_key) DO UPDATE SET qty = _curr_map.qty + v_curr_qty;
  END LOOP;

  -- ========================================================================
  -- Process deltas
  -- ========================================================================

  -- Items in snapshot: check if removed or qty changed
  FOR v_key, v_sku, v_warehouse, v_location, v_snap_qty IN
    SELECT s.item_key, s.sku, s.warehouse, s.location, s.qty FROM _snap_map s
  LOOP
    SELECT c.qty INTO v_curr_qty FROM _curr_map c WHERE c.item_key = v_key;

    IF v_curr_qty IS NULL THEN
      -- Item was REMOVED: return full qty to inventory
      v_delta := v_snap_qty;
    ELSE
      -- Item exists in both: delta = snapshot - current
      -- positive = return to inventory, negative = deduct more
      v_delta := v_snap_qty - v_curr_qty;
    END IF;

    IF v_delta != 0 THEN
      PERFORM public.adjust_inventory_quantity(
        v_sku, v_warehouse, v_location,
        v_delta,  -- positive = add back, negative = deduct
        p_performed_by, p_user_id, p_user_role,
        p_list_id, v_order_number,
        'Reopen delta #' || v_reopen_count
      );
    END IF;
  END LOOP;

  -- Items in current but NOT in snapshot: newly added, need to deduct
  FOR v_key, v_sku, v_warehouse, v_location, v_curr_qty IN
    SELECT c.item_key, c.sku, c.warehouse, c.location, c.qty
    FROM _curr_map c
    WHERE NOT EXISTS (SELECT 1 FROM _snap_map s WHERE s.item_key = c.item_key)
  LOOP
    IF v_curr_qty > 0 THEN
      PERFORM public.adjust_inventory_quantity(
        v_sku, v_warehouse, v_location,
        -v_curr_qty,  -- negative = deduct
        p_performed_by, p_user_id, p_user_role,
        p_list_id, v_order_number,
        'Reopen new item #' || v_reopen_count
      );
    END IF;
  END LOOP;

  -- ========================================================================
  -- Finalize: mark as completed, clear snapshot
  -- ========================================================================
  UPDATE picking_lists SET
    status = 'completed',
    completed_snapshot = NULL,
    reopened_by = NULL,
    reopened_at = NULL,
    pallets_qty = COALESCE(p_pallets_qty, pallets_qty),
    total_units = COALESCE(p_total_units, total_units),
    checked_by = p_user_id,
    updated_at = NOW()
  WHERE id = p_list_id;

  -- Log the re-completion
  INSERT INTO picking_list_notes (list_id, user_id, message)
  VALUES (
    p_list_id,
    p_user_id,
    'Order re-completed after reopen #' || v_reopen_count
  );

  -- Cleanup temp tables
  DROP TABLE IF EXISTS _snap_map;
  DROP TABLE IF EXISTS _curr_map;

  RETURN TRUE;
END;
$$;

-- ============================================================================
-- RPC: cancel_reopen
-- Cancels a reopen, restoring items from snapshot. Zero inventory impact.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.cancel_reopen(
  p_list_id uuid,
  p_user_id uuid
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_list RECORD;
BEGIN
  SELECT * INTO v_list FROM picking_lists
  WHERE id = p_list_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Picking list % not found', p_list_id;
  END IF;

  IF v_list.status != 'reopened' THEN
    RAISE EXCEPTION 'Cannot cancel reopen: status is %, expected reopened', v_list.status;
  END IF;

  IF v_list.completed_snapshot IS NULL THEN
    RAISE EXCEPTION 'No snapshot found for order %', p_list_id;
  END IF;

  -- Restore items from snapshot and return to completed
  UPDATE picking_lists SET
    items = completed_snapshot,
    status = 'completed',
    completed_snapshot = NULL,
    reopened_by = NULL,
    reopened_at = NULL,
    updated_at = NOW()
  WHERE id = p_list_id;

  INSERT INTO picking_list_notes (list_id, user_id, message)
  VALUES (p_list_id, p_user_id, 'Reopen cancelled — items restored to original completed state');

  RETURN TRUE;
END;
$$;

-- ============================================================================
-- Update auto_cancel_stale_orders to handle stuck reopened orders (2h timeout)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.auto_cancel_stale_orders()
RETURNS TABLE(id uuid, order_number text, status text)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_stale_building RECORD;
  v_expired_verification RECORD;
  v_stale_reopen RECORD;
  v_item jsonb;
  v_sku text;
  v_warehouse text;
  v_location text;
  v_qty integer;
BEGIN
  -- 1. Handle 'building' orders (No inventory to release)
  -- Just cancel them if inactive for > 15 mins
  RETURN QUERY
  WITH cancelled_building AS (
    UPDATE picking_lists pl
    SET status = 'cancelled', updated_at = NOW()
    FROM user_presence up
    WHERE pl.user_id = up.user_id
      AND pl.status = 'building'
      AND pl.last_activity_at < NOW() - INTERVAL '15 minutes'
      AND (up.last_seen_at IS NULL OR up.last_seen_at < NOW() - INTERVAL '2 minutes')
    RETURNING pl.id, pl.order_number, 'cancelled_building'::text as status
  )
  SELECT * FROM cancelled_building;

  -- 2. Handle 'ready_to_double_check'/'double_checking' orders > 24 hours
  -- THESE HAVE DEDUCTED INVENTORY. Must release via adjust_inventory_quantity.
  FOR v_expired_verification IN
    SELECT * FROM picking_lists
    WHERE picking_lists.status IN ('ready_to_double_check', 'double_checking')
    AND updated_at < NOW() - INTERVAL '24 hours'
    FOR UPDATE
  LOOP
    IF v_expired_verification.items IS NOT NULL THEN
      FOR v_item IN SELECT * FROM jsonb_array_elements(v_expired_verification.items) LOOP
        v_sku := v_item->>'sku';
        v_warehouse := v_item->>'warehouse';
        v_location := v_item->>'location';
        v_qty := (v_item->>'pickingQty')::integer;

        IF v_qty IS NULL THEN
          v_qty := (v_item->>'qty')::integer;
        END IF;

        IF v_qty IS NOT NULL AND v_qty > 0 THEN
          BEGIN
            PERFORM public.adjust_inventory_quantity(
              v_sku, v_warehouse, v_location, v_qty,
              'System Auto-Cancel', NULL, 'system',
              v_expired_verification.id, v_expired_verification.order_number,
              'Auto-cancel verification timeout'
            );
          EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Error restoring inventory for order % SKU %: %',
              v_expired_verification.order_number, v_sku, SQLERRM;
            RAISE;
          END;
        END IF;
      END LOOP;
    END IF;

    UPDATE picking_lists
    SET status = 'cancelled',
        updated_at = NOW(),
        notes = COALESCE(notes, '') || ' [System: Auto-cancelled due to 24h verification timeout]'
    WHERE picking_lists.id = v_expired_verification.id;

    id := v_expired_verification.id;
    order_number := v_expired_verification.order_number;
    status := 'cancelled_verification_timeout';
    RETURN NEXT;
  END LOOP;

  -- 3. Handle stuck 'reopened' orders > 2 hours
  -- No inventory adjustment needed — just restore snapshot and return to completed
  FOR v_stale_reopen IN
    SELECT * FROM picking_lists
    WHERE picking_lists.status = 'reopened'
    AND reopened_at < NOW() - INTERVAL '2 hours'
    FOR UPDATE
  LOOP
    UPDATE picking_lists SET
      items = COALESCE(completed_snapshot, items),
      status = 'completed',
      completed_snapshot = NULL,
      reopened_by = NULL,
      reopened_at = NULL,
      updated_at = NOW(),
      notes = COALESCE(notes, '') || ' [System: Auto-closed reopen after 2h timeout]'
    WHERE picking_lists.id = v_stale_reopen.id;

    id := v_stale_reopen.id;
    order_number := v_stale_reopen.order_number;
    status := 'cancelled_reopen_timeout';
    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$$;

-- ============================================================================
-- Grant permissions for new RPCs
-- ============================================================================
GRANT EXECUTE ON FUNCTION public.reopen_picking_list(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_picking_list(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.recomplete_picking_list(uuid, text, uuid, integer, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recomplete_picking_list(uuid, text, uuid, integer, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_reopen(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_reopen(uuid, uuid) TO service_role;
