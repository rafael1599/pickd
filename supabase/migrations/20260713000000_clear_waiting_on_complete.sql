-- ============================================================================
-- idea-053 (follow-up): Clear waiting state on complete or cancel
--
-- Ensures that any picking list that moves to 'completed' or 'cancelled'
-- has its is_waiting_inventory set to FALSE and waiting_reason set to NULL.
-- This prevents completed/cancelled orders from staying marked as waiting
-- in the database, which blocks watchdogs and corrupts state metrics.
-- ============================================================================

-- 1. Retroactive cleanup of existing inconsistent rows
UPDATE public.picking_lists
SET is_waiting_inventory = FALSE,
    waiting_reason = NULL
WHERE status IN ('completed', 'cancelled')
  AND is_waiting_inventory = TRUE;

-- 2. Trigger function to clear waiting status automatically
CREATE OR REPLACE FUNCTION public.clear_waiting_on_complete_or_cancel()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IN ('completed', 'cancelled') THEN
    NEW.is_waiting_inventory := FALSE;
    NEW.waiting_reason := NULL;
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.clear_waiting_on_complete_or_cancel() OWNER TO postgres;

-- 3. Create before-update trigger
DROP TRIGGER IF EXISTS trg_clear_waiting_on_complete_or_cancel ON public.picking_lists;
CREATE TRIGGER trg_clear_waiting_on_complete_or_cancel
  BEFORE INSERT OR UPDATE OF status ON public.picking_lists
  FOR EACH ROW
  EXECUTE FUNCTION public.clear_waiting_on_complete_or_cancel();

-- ============================================================================
-- Enforce unique active orders
--
-- Ensures that at any given time, there can be at most ONE active picking list 
-- (not in 'completed' or 'cancelled' status) for a given order number.
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_picking_lists_unique_active_order_number
  ON public.picking_lists (order_number)
  WHERE status NOT IN ('completed', 'cancelled')
    AND order_number IS NOT NULL
    AND order_number <> '';

-- ============================================================================
-- Redefine auto_cancel_stale_orders with waiting-orders safeguard
--
-- Ensures that any order marked as waiting for inventory (is_waiting_inventory = TRUE)
-- is explicitly excluded from the 24h verification timeout cancellation.
-- ============================================================================

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

  -- 2. ready_to_double_check / double_checking > 24h (EXCLUDING waiting orders): restore inventory + cancel.
  FOR v_expired_verification IN
    SELECT * FROM picking_lists
    WHERE picking_lists.status IN ('ready_to_double_check', 'double_checking')
      AND picking_lists.is_waiting_inventory = FALSE
      AND updated_at < NOW() - INTERVAL '24 hours'
    FOR UPDATE
  -- ... (retaining the rest of the loop exactly as defined)
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
