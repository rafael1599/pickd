-- idea-111 + fedex-returns bundle
--
-- Three changes in one migration:
-- 1) inventory_logs.note text — explains *this* action (per-log note,
--    distinct from inventory.internal_note which is per-row state).
-- 2) move_inventory_stock + upsert_inventory_log gain p_move_note param.
-- 3) New RPC process_fedex_return_item — atomic rename+move+resolve so
--    Return-to-Stock is one click and emits a single MOVE log with the
--    tracking number in note.
-- 4) New RPC update_inventory_log_note — retroactive note edits from
--    History; any signed-in user, any log type.

-- ── 1. Schema ───────────────────────────────────────────────────────

ALTER TABLE public.inventory_logs ADD COLUMN IF NOT EXISTS note text;

COMMENT ON COLUMN public.inventory_logs.note IS
  'idea-111: per-action explanation (e.g. "FedEx Return 792270157942" on a MOVE from FDX). Distinct from inventory.internal_note which is per-row state.';

-- ── 2. upsert_inventory_log: new p_note param ───────────────────────
-- Adds p_note as the last optional param so existing callers keep working.

CREATE OR REPLACE FUNCTION public.upsert_inventory_log(
  p_sku text,
  p_from_warehouse text,
  p_from_location text,
  p_to_warehouse text,
  p_to_location text,
  p_quantity_change integer,
  p_prev_quantity integer,
  p_new_quantity integer,
  p_action_type text,
  p_item_id bigint,
  p_location_id uuid,
  p_to_location_id uuid,
  p_performed_by text,
  p_user_id uuid,
  p_list_id uuid DEFAULT NULL,
  p_order_number text DEFAULT NULL,
  p_snapshot_before jsonb DEFAULT NULL,
  p_is_reversed boolean DEFAULT false,
  p_note text DEFAULT NULL,
  p_previous_sku text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO public.inventory_logs (
    sku, from_warehouse, from_location, to_warehouse, to_location,
    quantity_change, previous_quantity, new_quantity, action_type,
    item_id, location_id, to_location_id, performed_by, user_id,
    list_id, order_number, snapshot_before, is_reversed, note, previous_sku
  ) VALUES (
    p_sku, p_from_warehouse, p_from_location, p_to_warehouse, p_to_location,
    p_quantity_change, p_prev_quantity, p_new_quantity, p_action_type,
    p_item_id, p_location_id, p_to_location_id, p_performed_by, p_user_id,
    p_list_id, p_order_number, p_snapshot_before, p_is_reversed, p_note, p_previous_sku
  );
END;
$function$;

-- ── 3. move_inventory_stock: new p_move_note param ───────────────────
-- Adds a per-move audit note (writes into inventory_logs.note for the MOVE row).

CREATE OR REPLACE FUNCTION public.move_inventory_stock(
  p_sku text,
  p_from_warehouse text,
  p_from_location text,
  p_to_warehouse text,
  p_to_location text,
  p_qty integer,
  p_performed_by text,
  p_user_id uuid DEFAULT NULL::uuid,
  p_user_role text DEFAULT 'staff'::text,
  p_internal_note text DEFAULT NULL::text,
  p_sublocation text[] DEFAULT NULL::text[],
  p_move_note text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_src_id BIGINT;
  v_src_prev_qty INTEGER;
  v_src_new_qty INTEGER;
  v_src_note TEXT;
  v_src_internal_note TEXT;
  v_from_loc_id UUID;
  v_from_loc_name TEXT;
  v_to_loc_id UUID;
  v_snapshot JSONB;
  v_resolved_note TEXT;
  v_resolved_sublocation TEXT[];
BEGIN
  p_from_location := NULLIF(TRIM(UPPER(p_from_location)), '');
  p_to_location   := NULLIF(TRIM(UPPER(p_to_location)), '');

  IF p_to_location IS NOT NULL AND p_to_location ILIKE 'ROW%' THEN
    v_resolved_sublocation := p_sublocation;
  ELSE
    v_resolved_sublocation := NULL;
  END IF;

  SELECT id, quantity, item_name, internal_note
  INTO v_src_id, v_src_prev_qty, v_src_note, v_src_internal_note
  FROM public.inventory
  WHERE sku = p_sku AND warehouse = p_from_warehouse
    AND ((p_from_location IS NULL AND (location IS NULL OR location = '')) OR (location = p_from_location))
    AND is_active = TRUE
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Source item not found or inactive'; END IF;

  v_from_loc_id := public.resolve_location(p_from_warehouse, p_from_location);
  SELECT location INTO v_from_loc_name FROM public.locations WHERE id = v_from_loc_id;
  v_to_loc_id := public.resolve_location(p_to_warehouse, p_to_location);

  SELECT row_to_json(inv.*)::jsonb INTO v_snapshot
  FROM public.inventory inv
  WHERE inv.id = v_src_id;

  v_resolved_note := COALESCE(p_internal_note, v_src_internal_note);

  PERFORM public.adjust_inventory_quantity(
    p_sku, p_from_warehouse, p_from_location, -p_qty,
    p_performed_by, p_user_id, p_user_role, NULL, NULL, NULL, TRUE
  );
  v_src_new_qty := v_src_prev_qty - p_qty;

  PERFORM public.adjust_inventory_quantity(
    p_sku, p_to_warehouse, p_to_location, p_qty,
    p_performed_by, p_user_id, p_user_role, NULL, NULL, v_src_note, TRUE, v_resolved_note
  );

  UPDATE inventory
  SET sublocation = v_resolved_sublocation
  WHERE sku = p_sku
    AND warehouse = p_to_warehouse
    AND UPPER(TRIM(COALESCE(location, ''))) = UPPER(TRIM(COALESCE(p_to_location, '')))
    AND is_active = true;

  PERFORM public.upsert_inventory_log(
    p_sku::TEXT, p_from_warehouse::TEXT, v_from_loc_name::TEXT,
    p_to_warehouse::TEXT, p_to_location::TEXT,
    (-p_qty)::INTEGER, v_src_prev_qty::INTEGER, v_src_new_qty::INTEGER,
    'MOVE'::TEXT,
    v_src_id::BIGINT, v_from_loc_id::UUID, v_to_loc_id::UUID,
    p_performed_by::TEXT, p_user_id::UUID,
    NULL::UUID, NULL::TEXT, v_snapshot::JSONB, false, p_move_note, NULL
  );

  RETURN jsonb_build_object('success', true, 'moved_qty', p_qty, 'id', v_src_id);
END;
$function$;

-- ── 4. process_fedex_return_item ────────────────────────────────────
-- Atomic rename + move + resolve for a FedEx Return placeholder item.
--
-- Replaces the broken 2-step flow:
--   useAddReturnItem (creates dup row + ADDs to FDX) → useResolveReturn (MOVE)
-- with a single one-click flow:
--   process_fedex_return_item (rename placeholder + MOVE to target + auto-resolve return)
--
-- Emits one MOVE log with note='FedEx Return <tracking>' so History shows:
--   <real_sku> | Moved (<tracking>) from FDX to <target> | <qty>

CREATE OR REPLACE FUNCTION public.process_fedex_return_item(
  p_item_id uuid,
  p_real_sku text,
  p_item_name text,
  p_target_warehouse text,
  p_target_location text,
  p_condition text,
  p_user_id uuid,
  p_performed_by text DEFAULT 'FedEx Returns'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_item RECORD;
  v_return RECORD;
  v_placeholder_sku text;
  v_tracking text;
  v_real_sku text := UPPER(TRIM(p_real_sku));
  v_target_loc text := UPPER(TRIM(p_target_location));
  v_placeholder_inv RECORD;
  v_placeholder_qty integer;
  v_dest_inv RECORD;
  v_dest_prev integer;
  v_dest_new integer;
  v_from_loc_id uuid;
  v_to_loc_id uuid;
  v_snapshot jsonb;
  v_remaining integer;
  v_note text;
BEGIN
  IF v_real_sku IS NULL OR v_real_sku = '' THEN
    RAISE EXCEPTION 'process_fedex_return_item: p_real_sku required' USING ERRCODE='22023';
  END IF;
  IF v_target_loc IS NULL OR v_target_loc = '' THEN
    RAISE EXCEPTION 'process_fedex_return_item: p_target_location required' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_item FROM public.fedex_return_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'fedex_return_item % not found', p_item_id USING ERRCODE='22023'; END IF;
  IF v_item.moved_to_location IS NOT NULL THEN
    RAISE EXCEPTION 'item % already moved to %', p_item_id, v_item.moved_to_location USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_return FROM public.fedex_returns WHERE id = v_item.return_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'fedex_returns % not found', v_item.return_id USING ERRCODE='22023'; END IF;

  v_tracking := v_return.tracking_number;
  v_placeholder_sku := v_item.sku;

  -- Ensure sku_metadata exists for the real SKU (idempotent insert).
  INSERT INTO public.sku_metadata (sku) VALUES (v_real_sku) ON CONFLICT DO NOTHING;

  v_note := 'FedEx Return ' || v_tracking;

  -- Look up the placeholder inventory row (sku=tracking number) at LUDLOW.FDX.
  -- We tolerate any FDX-prefixed location (FDX, FDX 1, FDX 2…) since intake
  -- and historical placement varied.
  SELECT * INTO v_placeholder_inv
  FROM public.inventory
  WHERE sku = v_placeholder_sku
    AND warehouse = 'LUDLOW'
    AND location LIKE 'FDX%'
    AND is_active = TRUE
  ORDER BY quantity DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND AND v_placeholder_inv.quantity >= v_item.quantity THEN
    -- Path A: there is a placeholder to consume. Decrement it.
    v_placeholder_qty := v_placeholder_inv.quantity;
    v_from_loc_id := v_placeholder_inv.location_id;

    UPDATE public.inventory
    SET quantity = quantity - v_item.quantity,
        is_active = (quantity - v_item.quantity > 0),
        item_name = CASE WHEN quantity - v_item.quantity = 0 THEN '[deduped] ' || COALESCE(item_name, '') ELSE item_name END
    WHERE id = v_placeholder_inv.id;
  ELSE
    -- Path B: no placeholder (or insufficient qty) — record from-location as
    -- canonical FDX so History still shows a sensible MOVE source.
    v_placeholder_qty := 0;
    v_from_loc_id := public.resolve_location('LUDLOW', 'FDX');
  END IF;

  -- Add to destination (consolidate or create).
  SELECT * INTO v_dest_inv
  FROM public.inventory
  WHERE sku = v_real_sku
    AND warehouse = p_target_warehouse
    AND location = v_target_loc
    AND is_active = TRUE
  FOR UPDATE;

  IF FOUND THEN
    v_dest_prev := v_dest_inv.quantity;
    v_dest_new := v_dest_prev + v_item.quantity;
    UPDATE public.inventory
    SET quantity = v_dest_new,
        is_active = TRUE
    WHERE id = v_dest_inv.id;
  ELSE
    v_to_loc_id := public.resolve_location(p_target_warehouse, v_target_loc);
    INSERT INTO public.inventory (sku, warehouse, location, location_id, quantity, is_active, item_name)
    VALUES (v_real_sku, p_target_warehouse, v_target_loc, v_to_loc_id, v_item.quantity, TRUE, p_item_name)
    RETURNING id, quantity INTO v_dest_inv.id, v_dest_new;
    v_dest_prev := 0;
  END IF;

  v_to_loc_id := public.resolve_location(p_target_warehouse, v_target_loc);

  SELECT row_to_json(inv.*)::jsonb INTO v_snapshot
  FROM public.inventory inv WHERE inv.id = v_dest_inv.id;

  -- Single MOVE log: sku=real, previous_sku=tracking (rename evidence),
  -- from=FDX, to=target, note='FedEx Return <tracking>'.
  PERFORM public.upsert_inventory_log(
    v_real_sku::TEXT, 'LUDLOW'::TEXT, 'FDX'::TEXT,
    p_target_warehouse::TEXT, v_target_loc::TEXT,
    v_item.quantity::INTEGER, v_dest_prev::INTEGER, v_dest_new::INTEGER,
    'MOVE'::TEXT,
    v_dest_inv.id::BIGINT, v_from_loc_id::UUID, v_to_loc_id::UUID,
    p_performed_by::TEXT, p_user_id::UUID,
    NULL::UUID, NULL::TEXT, v_snapshot::JSONB, false,
    v_note,
    CASE WHEN v_placeholder_sku <> v_real_sku THEN v_placeholder_sku ELSE NULL END
  );

  -- Update the fedex_return_items row (rename in place — preserve created_at).
  UPDATE public.fedex_return_items
  SET sku = v_real_sku,
      item_name = p_item_name,
      condition = COALESCE(p_condition, condition, 'good'),
      target_warehouse = p_target_warehouse,
      target_location = v_target_loc,
      moved_to_location = v_target_loc,
      moved_to_warehouse = p_target_warehouse,
      moved_at = now()
  WHERE id = p_item_id;

  -- Auto-resolve: if every item in this return now has moved_to_location set,
  -- flip the return to 'resolved'.
  SELECT COUNT(*) INTO v_remaining
  FROM public.fedex_return_items
  WHERE return_id = v_return.id AND moved_to_location IS NULL;

  IF v_remaining = 0 AND v_return.status <> 'resolved' THEN
    UPDATE public.fedex_returns
    SET status = 'resolved',
        resolved_at = now(),
        updated_at = now()
    WHERE id = v_return.id;
  END IF;

  RETURN jsonb_build_object(
    'item_id', p_item_id,
    'sku', v_real_sku,
    'tracking', v_tracking,
    'moved_qty', v_item.quantity,
    'target_location', v_target_loc,
    'return_resolved', (v_remaining = 0)
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.process_fedex_return_item(uuid, text, text, text, text, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_fedex_return_item(uuid, text, text, text, text, text, uuid, text) TO service_role;

-- ── 5. update_inventory_log_note ────────────────────────────────────
-- Retroactive note editing from History. Any signed-in user can edit any log.

CREATE OR REPLACE FUNCTION public.update_inventory_log_note(
  p_log_id uuid,
  p_note text,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_log RECORD;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'sign-in required' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_log FROM public.inventory_logs WHERE id = p_log_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'inventory_logs % not found', p_log_id USING ERRCODE='22023'; END IF;

  UPDATE public.inventory_logs
  SET note = NULLIF(TRIM(p_note), '')
  WHERE id = p_log_id;

  RETURN jsonb_build_object('id', p_log_id, 'note', NULLIF(TRIM(p_note), ''));
END;
$function$;

-- The earlier (bigint) signature accidentally shipped during smoke; drop it
-- so PostgREST does not pick it over the uuid one.
DROP FUNCTION IF EXISTS public.update_inventory_log_note(bigint, text, uuid);

GRANT EXECUTE ON FUNCTION public.update_inventory_log_note(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_inventory_log_note(uuid, text, uuid) TO service_role;
