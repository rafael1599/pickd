-- Edge-case guards on move_inventory_stock.
--
-- The function previously accepted no-op moves silently:
--   - p_qty = 0 or negative → wrote two pointless inventory_logs rows.
--   - from == to (same warehouse + location) → ended up touching the
--     same inventory row twice via adjust_inventory_quantity, leaving
--     audit noise and (in rare cases) a transient inactive→active
--     toggle of the row.
--
-- Both surface in the Consolidation Move modal when the operator
-- clicks the source row by accident, or when the smart suggestion
-- recommends a row that's the same as the source (possible inside
-- clear-row mode where the source row is in the same zone as the
-- target list).
--
-- Fix: validate at the top of the function. Errors are RAISEd before
-- any side effect so the caller sees a clean failure instead of a
-- silent no-op. We keep using CREATE OR REPLACE so the signature
-- (and grants) stay intact.

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
SET search_path TO 'public', 'pg_temp'
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
  v_from_norm TEXT;
  v_to_norm TEXT;
BEGIN
  -- Normalize early so the validation comparison agrees with downstream
  -- processing (which uppercases + trims).
  v_from_norm := NULLIF(TRIM(UPPER(p_from_location)), '');
  v_to_norm   := NULLIF(TRIM(UPPER(p_to_location)), '');
  p_from_location := v_from_norm;
  p_to_location   := v_to_norm;

  -- Guard: positive qty required.
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'move_inventory_stock: qty must be > 0 (got %)', COALESCE(p_qty::text,'NULL')
      USING ERRCODE = '22023',
            HINT = 'Pass a strictly positive integer for p_qty.';
  END IF;

  -- Guard: same source and target = no-op, refuse so the caller fixes its UI.
  -- Sublocation edits should go through the inventory update path, not move.
  IF p_from_warehouse = p_to_warehouse
     AND COALESCE(v_from_norm, '') = COALESCE(v_to_norm, '') THEN
    RAISE EXCEPTION 'move_inventory_stock: source and target are the same (%, %)',
      p_from_warehouse, COALESCE(v_from_norm, '<NULL>')
      USING ERRCODE = '22023',
            HINT = 'Pick a different destination row. Use the inventory edit flow to change sublocation in place.';
  END IF;

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
