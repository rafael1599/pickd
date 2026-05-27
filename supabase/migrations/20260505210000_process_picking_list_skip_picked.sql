-- idea-105 Phase 2: skip already-picked items in process_picking_list.
-- Items toggled via pick_item RPC have already deducted inventory through
-- the compensate_picking_list_changes trigger. Without this guard, completing
-- the order would double-deduct them.

CREATE OR REPLACE FUNCTION public.process_picking_list(
  p_list_id uuid,
  p_performed_by text,
  p_user_id uuid DEFAULT NULL::uuid,
  p_pallets_qty integer DEFAULT NULL::integer,
  p_total_units integer DEFAULT NULL::integer,
  p_user_role text DEFAULT 'staff'::text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_list RECORD;
  v_item JSONB;
  v_sku TEXT;
  v_warehouse TEXT;
  v_location TEXT;
  v_qty INTEGER;
  v_order_number TEXT;
  v_sku_not_found BOOLEAN;
  v_picked BOOLEAN;
BEGIN
  SELECT * INTO v_list FROM picking_lists WHERE id = p_list_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Picking list % not found', p_list_id;
  END IF;

  IF v_list.status = 'completed' THEN
    RETURN TRUE;
  END IF;

  IF v_list.status = 'reopened' THEN
    RAISE EXCEPTION 'Cannot process a reopened picking list (%); use recomplete_picking_list() instead', p_list_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_order_number := v_list.order_number;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_list.items)
  LOOP
    v_sku := v_item->>'sku';
    v_warehouse := v_item->>'warehouse';
    v_location := v_item->>'location';
    v_qty := (v_item->>'pickingQty')::integer;
    v_sku_not_found := (v_item->>'sku_not_found')::boolean;
    v_picked := COALESCE((v_item->>'picked')::boolean, false);

    IF v_qty IS NULL OR v_qty <= 0 OR v_sku_not_found = true THEN
      CONTINUE;
    END IF;

    -- idea-105 Phase 2: items toggled picked=true already deducted via trigger.
    IF v_picked THEN
      CONTINUE;
    END IF;

    PERFORM public.adjust_inventory_quantity(
      v_sku, v_warehouse, v_location, -v_qty,
      p_performed_by, p_user_id, p_user_role, p_list_id, v_order_number,
      NULL
    );
  END LOOP;

  UPDATE picking_lists SET
    status = 'completed',
    pallets_qty = COALESCE(p_pallets_qty, pallets_qty),
    total_units = COALESCE(p_total_units, total_units),
    updated_at = NOW(),
    checked_by = p_user_id
  WHERE id = p_list_id;

  RETURN TRUE;
END;
$function$;
