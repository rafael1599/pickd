-- Guard auto_cancel_stale_orders against cancelling orders that are
-- legitimately waiting for inventory (is_waiting_inventory = true).
-- These orders can stay open for days while stock is replenished.

CREATE OR REPLACE FUNCTION public.auto_cancel_stale_orders()
 RETURNS TABLE(id uuid, order_number text, status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  --    SKIP orders marked as waiting for inventory (they can legitimately stay open for days).
  FOR v_expired_verification IN
    SELECT * FROM picking_lists
    WHERE picking_lists.status IN ('ready_to_double_check', 'double_checking')
    AND updated_at < NOW() - INTERVAL '24 hours'
    AND (is_waiting_inventory IS NOT TRUE)
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
$function$;
