-- ============================================================================
-- RPC: restore_cancelled_order
-- Reverts a 'cancelled' picking_list back to 'active' (e.g. when an order was
-- cancelled by mistake). Mirror of reopen_picking_list for cancelled orders.
--
-- Inventory-neutral by design: the UI cancel path (usePickingActions deleteList)
-- flips status to 'cancelled' WITHOUT crediting inventory back, so restoring
-- the status alone leaves stock counters consistent with where the order left
-- off. If picking had progressed, the user simply continues from there.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.restore_cancelled_order(
  p_list_id uuid,
  p_restored_by uuid,
  p_reason text DEFAULT NULL
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

  IF v_list.status != 'cancelled' THEN
    RAISE EXCEPTION 'Cannot restore: status is %, expected cancelled', v_list.status;
  END IF;

  UPDATE picking_lists SET
    status = 'active',
    updated_at = NOW(),
    last_activity_at = NOW()
  WHERE id = p_list_id;

  INSERT INTO picking_list_notes (list_id, user_id, message)
  VALUES (
    p_list_id,
    p_restored_by,
    'Order restored from cancelled to active. Reason: ' || COALESCE(p_reason, 'Not specified')
  );

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.restore_cancelled_order(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_cancelled_order(uuid, uuid, text) TO service_role;
