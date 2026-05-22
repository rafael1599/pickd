-- ============================================================================
-- Fix: cancel_reopen must undo inventory changes made during the reopen window;
--      Delete Order must work on completed/reopened orders (restore + cancel).
--
-- Background (real incident, 2026-05-22, order #879837):
--   1. User reopened a completed order, modified items, then clicked the modal
--      "Delete" expecting status -> 'cancelled' AND stock returned.
--   2. The Delete handler silently no-op'd for any non-active status (UI bug),
--      and cancel_reopen only restored items from snapshot, leaving inventory
--      changes made during the reopen orphaned (RPC bug).
--   3. Net result: order stayed `completed`, stock not restored, user confused.
--
-- This migration:
--   (a) cancel_reopen — replay inventory_logs created during the reopen window
--       in reverse so the inventory matches the pre-reopen state. Status goes
--       back to 'completed' (the pre-reopen state — that's what "pretend the
--       reopen never happened" means).
--   (b) cancel_completed_order — new RPC. Restores picked qtys to inventory
--       and sets status = 'cancelled'. Idempotent. Chains cancel_reopen first
--       if the order is currently 'reopened'.
--   (c) auto_cancel_stale_orders — its stale-reopen branch (2h timeout) now
--       also reverts inventory using the same replay logic.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helper: replay inventory_logs for a list during a window in reverse,
-- generating offsetting inventory_logs entries tagged 'system: <reason>'.
-- Uses adjust_inventory_quantity so each undo also gets its own log row,
-- preserving the audit trail. Skips rows already marked is_reversed=true
-- (idempotency in case of double-call).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revert_inventory_logs_for_list(
  p_list_id uuid,
  p_since timestamptz,
  p_reason text
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_log RECORD;
  v_undone integer := 0;
  v_order_number text;
BEGIN
  SELECT order_number INTO v_order_number FROM picking_lists WHERE id = p_list_id;

  -- Reverse-time scan so dependent rows undo last-in-first-out. Lock the
  -- log rows so concurrent reverts can't race.
  FOR v_log IN
    SELECT l.id, l.sku, l.to_warehouse, l.to_location, l.quantity_change,
           l.previous_quantity, l.new_quantity
    FROM inventory_logs l
    WHERE l.list_id = p_list_id
      AND l.created_at >= p_since
      AND COALESCE(l.is_reversed, false) = false
      AND l.action_type IN ('ADD', 'DEDUCT')
      AND l.quantity_change IS NOT NULL
      AND l.to_location IS NOT NULL
    ORDER BY l.created_at DESC
    FOR UPDATE
  LOOP
    -- Apply the inverse delta. adjust_inventory_quantity writes its own
    -- log entry tagged with `p_performed_by`, so the trail reads:
    --   ADD  +1  (system: pick)            <- original
    --   DEDUCT -1 (system: cancel-reopen-revert) <- this undo
    PERFORM public.adjust_inventory_quantity(
      p_sku          := v_log.sku,
      p_warehouse    := v_log.to_warehouse,
      p_location     := v_log.to_location,
      p_delta        := -v_log.quantity_change,
      p_performed_by := 'system: ' || p_reason,
      p_user_id      := NULL,
      p_list_id      := p_list_id,
      p_order_number := v_order_number,
      p_merge_note   := 'revert of log ' || v_log.id::text
    );

    -- Mark the original log as reversed so a second call is a no-op.
    UPDATE inventory_logs SET is_reversed = true WHERE id = v_log.id;
    v_undone := v_undone + 1;
  END LOOP;

  RETURN v_undone;
END;
$$;

GRANT EXECUTE ON FUNCTION public.revert_inventory_logs_for_list(uuid, timestamptz, text) TO service_role;

-- ---------------------------------------------------------------------------
-- cancel_reopen — replaces the original migration's definition. Now reverts
-- inventory changes that happened during the reopen window before restoring
-- items from snapshot. Net effect: pretend the reopen never happened.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_reopen(
  p_list_id uuid,
  p_user_id uuid
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_list RECORD;
  v_reverted integer;
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

  IF v_list.reopened_at IS NULL THEN
    RAISE EXCEPTION 'No reopened_at timestamp for order %', p_list_id;
  END IF;

  -- Revert any inventory writes made during the reopen window.
  v_reverted := public.revert_inventory_logs_for_list(
    p_list_id,
    v_list.reopened_at,
    'cancel-reopen-revert'
  );

  -- Restore items from snapshot and return to completed.
  UPDATE picking_lists SET
    items = completed_snapshot,
    status = 'completed',
    completed_snapshot = NULL,
    reopened_by = NULL,
    reopened_at = NULL,
    updated_at = NOW()
  WHERE id = p_list_id;

  INSERT INTO picking_list_notes (list_id, user_id, message)
  VALUES (
    p_list_id, p_user_id,
    'Reopen cancelled — items restored and ' || v_reverted::text || ' inventory change(s) reverted'
  );

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_reopen(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_reopen(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- cancel_completed_order — new RPC backing the UI "Delete Order" action for
-- completed or reopened orders.
--   * If reopened: cancel the reopen first (revert inventory + restore items),
--     leaving status='completed' temporarily.
--   * Then restore each picked item's qty to inventory and mark status='cancelled'.
--   * Idempotent: if already cancelled, returns false without writes.
--   * Group cleanup mirrors the in-progress cancel path.
--
-- Returns jsonb { restored_units, items_restored, status, was_reopened }.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_completed_order(
  p_list_id uuid,
  p_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_list RECORD;
  v_item jsonb;
  v_qty integer;
  v_picked boolean;
  v_total_restored integer := 0;
  v_items_restored integer := 0;
  v_was_reopened boolean := false;
  v_remaining_in_group integer;
BEGIN
  SELECT * INTO v_list FROM picking_lists
  WHERE id = p_list_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Picking list % not found', p_list_id;
  END IF;

  -- Idempotency: already cancelled => no-op.
  IF v_list.status = 'cancelled' THEN
    RETURN jsonb_build_object(
      'restored_units', 0,
      'items_restored', 0,
      'status', 'cancelled',
      'was_reopened', false,
      'already_cancelled', true
    );
  END IF;

  -- Only completed and reopened are eligible for "delete" here. Active states
  -- have their own cancel path via the existing trigger.
  IF v_list.status NOT IN ('completed', 'reopened') THEN
    RAISE EXCEPTION
      'cancel_completed_order only valid for completed/reopened orders, got %',
      v_list.status;
  END IF;

  -- If reopened, fold back to the pre-reopen completed state first. This
  -- reverts any inventory writes done during the reopen window so the
  -- subsequent restore-loop sees a clean "picked" snapshot.
  IF v_list.status = 'reopened' THEN
    v_was_reopened := true;
    PERFORM public.cancel_reopen(p_list_id, p_user_id);
    -- Re-read the row — items + status were rewritten by cancel_reopen.
    SELECT * INTO v_list FROM picking_lists WHERE id = p_list_id FOR UPDATE;
  END IF;

  -- Restore each picked item to inventory. adjust_inventory_quantity writes
  -- its own audit row tagged 'system: order-deleted'.
  IF v_list.items IS NOT NULL THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_list.items) LOOP
      v_picked := COALESCE((v_item->>'picked')::boolean, false);
      IF NOT v_picked THEN CONTINUE; END IF;

      v_qty := COALESCE((v_item->>'pickingQty')::integer, NULLIF(v_item->>'qty','')::integer);
      IF v_qty IS NULL OR v_qty <= 0 THEN CONTINUE; END IF;
      IF (v_item->>'location') IS NULL OR TRIM(v_item->>'location') = '' THEN CONTINUE; END IF;

      PERFORM public.adjust_inventory_quantity(
        p_sku          := v_item->>'sku',
        p_warehouse    := v_item->>'warehouse',
        p_location     := v_item->>'location',
        p_delta        := v_qty,
        p_performed_by := 'system: order-deleted',
        p_user_id      := p_user_id,
        p_list_id      := p_list_id,
        p_order_number := v_list.order_number,
        p_merge_note   := 'auto-restore on order delete'
      );

      v_total_restored := v_total_restored + v_qty;
      v_items_restored := v_items_restored + 1;
    END LOOP;
  END IF;

  -- Mark cancelled with audit note in `notes` (preserves history) and
  -- structured note row.
  UPDATE picking_lists SET
    status = 'cancelled',
    updated_at = NOW(),
    last_activity_at = NOW(),
    notes = COALESCE(notes, '') ||
      ' [User Deleted Order — ' || v_total_restored::text || ' units restored to inventory]'
  WHERE id = p_list_id;

  INSERT INTO picking_list_notes (list_id, user_id, message)
  VALUES (
    p_list_id, p_user_id,
    'Order deleted from completed state. Restored ' || v_total_restored::text ||
    ' units across ' || v_items_restored::text || ' line item(s).' ||
    CASE WHEN v_was_reopened THEN ' Reopen was cancelled first.' ELSE '' END
  );

  -- Group cleanup: if this was the last live order in the group, dissolve.
  IF v_list.group_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_remaining_in_group
    FROM picking_lists
    WHERE group_id = v_list.group_id
      AND status NOT IN ('cancelled')
      AND id != p_list_id;

    IF v_remaining_in_group = 0 THEN
      DELETE FROM order_groups WHERE id = v_list.group_id;
    ELSIF v_remaining_in_group = 1 THEN
      UPDATE picking_lists SET group_id = NULL
      WHERE group_id = v_list.group_id AND id != p_list_id;
      DELETE FROM order_groups WHERE id = v_list.group_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'restored_units', v_total_restored,
    'items_restored', v_items_restored,
    'status', 'cancelled',
    'was_reopened', v_was_reopened,
    'already_cancelled', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_completed_order(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_completed_order(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- auto_cancel_stale_orders — branch 3 (stuck reopened > 2h) was previously
-- restoring items from snapshot without touching inventory, leaving the same
-- orphan-changes bug we just fixed for cancel_reopen. Apply the replay there
-- too so timeouts behave consistently with manual cancel-reopen.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auto_cancel_stale_orders()
RETURNS TABLE(id uuid, order_number text, status text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_expired_verification RECORD;
  v_stale_reopen RECORD;
  v_item jsonb;
  v_sku text;
  v_warehouse text;
  v_location text;
  v_qty integer;
BEGIN
  -- 1. 'building' orders: cancel after 15 min idle. No inventory impact.
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

  -- 2. ready_to_double_check / double_checking > 24h: restore inventory + cancel.
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

  -- 3. Stuck 'reopened' > 2h: revert inventory writes from the reopen window
  --    and restore the pre-reopen completed snapshot.
  FOR v_stale_reopen IN
    SELECT * FROM picking_lists
    WHERE picking_lists.status = 'reopened'
    AND reopened_at < NOW() - INTERVAL '2 hours'
    FOR UPDATE
  LOOP
    IF v_stale_reopen.reopened_at IS NOT NULL THEN
      PERFORM public.revert_inventory_logs_for_list(
        v_stale_reopen.id,
        v_stale_reopen.reopened_at,
        'cancel-reopen-revert'
      );
    END IF;

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
