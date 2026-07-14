-- idea-053 follow-up (temporary): remove admin-only guard from waiting RPCs.
-- Goal: stop 403s in operational flows while roles are not being used.
-- Scope intentionally minimal: only the waiting-order RPCs are relaxed.

BEGIN;

CREATE OR REPLACE FUNCTION public.mark_picking_list_waiting(
  p_list_id uuid,
  p_reason text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller_id uuid := public.current_user_id();
  v_existing record;
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'waiting_reason is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT id, status, is_waiting_inventory
    INTO v_existing
    FROM public.picking_lists
   WHERE id = p_list_id
     FOR UPDATE;

  IF v_existing.id IS NULL THEN
    RAISE EXCEPTION 'picking_list not found: %', p_list_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_existing.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'cannot mark a % order as waiting', v_existing.status
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.picking_lists
     SET is_waiting_inventory = TRUE,
         waiting_since        = COALESCE(waiting_since, NOW()),
         waiting_reason       = p_reason,
         status               = CASE
                                  WHEN status = 'reopened' THEN status
                                  ELSE 'needs_correction'
                                END,
         updated_at           = NOW()
   WHERE id = p_list_id;

  INSERT INTO public.picking_list_notes (list_id, user_id, message)
  VALUES (p_list_id, v_caller_id, '[Waiting]: ' || p_reason);
END;
$$;

ALTER FUNCTION public.mark_picking_list_waiting(uuid, text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.mark_picking_list_waiting(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_picking_list_waiting(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.mark_picking_list_waiting(uuid, text) IS
  'Mark a picking_list as waiting for inventory. Temporarily available to any authenticated user. Transitions status to needs_correction unless already in reopened. Preserves waiting_since across re-marks.';

CREATE OR REPLACE FUNCTION public.unmark_picking_list_waiting(
  p_list_id uuid,
  p_action  text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller_id uuid := public.current_user_id();
  v_new_status text;
  v_message text;
  v_updated int;
BEGIN
  IF p_action NOT IN ('resume', 'cancel') THEN
    RAISE EXCEPTION 'p_action must be ''resume'' or ''cancel'', got: %', p_action
      USING ERRCODE = '22023';
  END IF;

  v_new_status := CASE WHEN p_action = 'resume' THEN 'ready_to_double_check' ELSE 'cancelled' END;
  v_message    := CASE WHEN p_action = 'resume' THEN '[Resumed from waiting]' ELSE '[Cancelled from waiting]' END;

  UPDATE public.picking_lists
     SET is_waiting_inventory = FALSE,
         waiting_since        = NULL,
         waiting_reason       = NULL,
         status               = v_new_status,
         updated_at           = NOW()
   WHERE id = p_list_id
     AND is_waiting_inventory = TRUE;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RAISE EXCEPTION 'picking_list not found or not in waiting state: %', p_list_id
      USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.picking_list_notes (list_id, user_id, message)
  VALUES (p_list_id, v_caller_id, v_message);
END;
$$;

ALTER FUNCTION public.unmark_picking_list_waiting(uuid, text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.unmark_picking_list_waiting(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unmark_picking_list_waiting(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.unmark_picking_list_waiting(uuid, text) IS
  'Resume (back to ready_to_double_check) or cancel a waiting picking_list. Temporarily available to any authenticated user. Defensive: only acts on rows that are actually waiting.';

CREATE OR REPLACE FUNCTION public.take_over_sku_from_waiting(
  p_waiting_list_id uuid,
  p_target_list_id  uuid,
  p_sku             text,
  p_qty             integer
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller_id            uuid := public.current_user_id();
  v_waiting_items        jsonb;
  v_waiting_order_number text;
  v_target_order_number  text;
  v_item_idx             int;
  v_item                 jsonb;
  v_current_qty          int;
  v_new_items            jsonb;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'p_qty must be a positive integer, got: %', p_qty
      USING ERRCODE = '22023';
  END IF;

  IF p_waiting_list_id = p_target_list_id THEN
    RAISE EXCEPTION 'cannot take over a SKU from a list onto itself'
      USING ERRCODE = '22023';
  END IF;

  SELECT items, order_number
    INTO v_waiting_items, v_waiting_order_number
    FROM public.picking_lists
   WHERE id = p_waiting_list_id
     AND is_waiting_inventory = TRUE
     FOR UPDATE;

  IF v_waiting_order_number IS NULL THEN
    RAISE EXCEPTION 'waiting picking_list not found or not in waiting state: %', p_waiting_list_id
      USING ERRCODE = 'P0002';
  END IF;

  SELECT order_number
    INTO v_target_order_number
    FROM public.picking_lists
   WHERE id = p_target_list_id;

  IF v_target_order_number IS NULL THEN
    RAISE EXCEPTION 'target picking_list not found: %', p_target_list_id
      USING ERRCODE = 'P0002';
  END IF;

  SELECT (ord - 1)::int, elem
    INTO v_item_idx, v_item
    FROM jsonb_array_elements(COALESCE(v_waiting_items, '[]'::jsonb)) WITH ORDINALITY AS arr(elem, ord)
   WHERE elem->>'sku' = p_sku
   LIMIT 1;

  IF v_item IS NULL THEN
    RAISE EXCEPTION 'sku % not found in waiting list %', p_sku, p_waiting_list_id
      USING ERRCODE = 'P0002';
  END IF;

  v_current_qty := COALESCE((v_item->>'pickingQty')::int, 0);

  IF v_current_qty < p_qty THEN
    RAISE EXCEPTION 'cannot take over % units of % — only % available in waiting list',
                    p_qty, p_sku, v_current_qty
      USING ERRCODE = '22023';
  END IF;

  IF v_current_qty - p_qty = 0 THEN
    v_new_items := v_waiting_items - v_item_idx;
  ELSE
    v_new_items := jsonb_set(
      v_waiting_items,
      ARRAY[v_item_idx::text, 'pickingQty'],
      to_jsonb(v_current_qty - p_qty),
      FALSE
    );
  END IF;

  UPDATE public.picking_lists
     SET items      = v_new_items,
         updated_at = NOW()
   WHERE id = p_waiting_list_id;

  INSERT INTO public.picking_list_notes (list_id, user_id, message)
  VALUES (
    p_waiting_list_id,
    v_caller_id,
    format('[Take Over SKU] %s x%s moved to order #%s', p_sku, p_qty, COALESCE(v_target_order_number, p_target_list_id::text))
  );
END;
$$;

ALTER FUNCTION public.take_over_sku_from_waiting(uuid, uuid, text, integer) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.take_over_sku_from_waiting(uuid, uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.take_over_sku_from_waiting(uuid, uuid, text, integer) TO authenticated;

COMMENT ON FUNCTION public.take_over_sku_from_waiting(uuid, uuid, text, integer) IS
  'Take over a SKU from a waiting order into another order. Temporarily available to any authenticated user.';

COMMIT;
