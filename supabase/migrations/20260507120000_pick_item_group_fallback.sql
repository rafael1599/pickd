-- pick_item / unpick_item: fall back to sibling lists when not found.
--
-- When DoubleCheckView shows a grouped order (group_id), the cart merges items
-- from all sibling picking_lists. Various FE code paths (auto-resume, localStorage
-- hydration, direct setCartItems) populate cartItems without tagging items with
-- their owning list_id, so the FE may call these RPCs with the anchor list_id
-- even when the item lives in a sibling. Result: '...not found in list' 400s.
--
-- Fix server-side: if the item isn't in the given list and the list belongs to
-- a group, search siblings (same group_id, in any active-ish status). If exactly
-- one sibling has the (sku, warehouse, location) tuple, use that list instead.
-- Ambiguous (>1 match) or zero-match remains an error.

CREATE OR REPLACE FUNCTION public.pick_item(
  p_list_id uuid,
  p_sku text,
  p_warehouse text,
  p_location text,
  p_qty integer,
  p_user_id uuid,
  p_performed_by text DEFAULT 'picker'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_target_id uuid := p_list_id;
  v_status   text;
  v_items    jsonb;
  v_keys     jsonb;
  v_group_id uuid;
  v_item     jsonb;
  v_idx      int := 0;
  v_match    int := -1;
  v_already  boolean := false;
  v_key      text;
  v_sibling_count int;
  v_active_states constant text[] :=
    ARRAY['active','needs_correction','ready_to_double_check','double_checking'];
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'pick_item: qty must be > 0' USING ERRCODE = '22023';
  END IF;

  SELECT status, items, COALESCE(verified_item_keys, '[]'::jsonb), group_id
    INTO v_status, v_items, v_keys, v_group_id
  FROM public.picking_lists
  WHERE id = p_list_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'pick_item: list % not found', p_list_id USING ERRCODE = '22023';
  END IF;

  IF v_status <> ALL(v_active_states) THEN
    RAISE EXCEPTION 'pick_item: list % is in status % (must be active)', p_list_id, v_status
      USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(v_items, '[]'::jsonb)) LOOP
    IF v_item->>'sku' = p_sku
       AND v_item->>'warehouse' = p_warehouse
       AND v_item->>'location'  = p_location THEN
      v_match := v_idx;
      v_already := COALESCE((v_item->>'picked')::boolean, false);
      EXIT;
    END IF;
    v_idx := v_idx + 1;
  END LOOP;

  -- Group fallback: if not found here and the list is part of a group, see
  -- whether exactly one sibling owns this (sku, warehouse, location).
  IF v_match = -1 AND v_group_id IS NOT NULL THEN
    SELECT count(*) INTO v_sibling_count
    FROM public.picking_lists pl,
         jsonb_array_elements(COALESCE(pl.items, '[]'::jsonb)) it
    WHERE pl.group_id = v_group_id
      AND pl.id <> p_list_id
      AND pl.status = ANY(v_active_states)
      AND it->>'sku' = p_sku
      AND it->>'warehouse' = p_warehouse
      AND it->>'location'  = p_location;

    IF v_sibling_count = 1 THEN
      SELECT pl.id INTO v_target_id
      FROM public.picking_lists pl,
           jsonb_array_elements(COALESCE(pl.items, '[]'::jsonb)) it
      WHERE pl.group_id = v_group_id
        AND pl.id <> p_list_id
        AND pl.status = ANY(v_active_states)
        AND it->>'sku' = p_sku
        AND it->>'warehouse' = p_warehouse
        AND it->>'location'  = p_location
      LIMIT 1;

      -- Re-load and lock the actual owning list.
      SELECT status, items, COALESCE(verified_item_keys, '[]'::jsonb)
        INTO v_status, v_items, v_keys
      FROM public.picking_lists
      WHERE id = v_target_id
      FOR UPDATE;

      IF v_status <> ALL(v_active_states) THEN
        RAISE EXCEPTION 'pick_item: sibling list % is in status % (must be active)',
          v_target_id, v_status USING ERRCODE = '22023';
      END IF;

      v_idx := 0;
      FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(v_items, '[]'::jsonb)) LOOP
        IF v_item->>'sku' = p_sku
           AND v_item->>'warehouse' = p_warehouse
           AND v_item->>'location'  = p_location THEN
          v_match := v_idx;
          v_already := COALESCE((v_item->>'picked')::boolean, false);
          EXIT;
        END IF;
        v_idx := v_idx + 1;
      END LOOP;
    ELSIF v_sibling_count > 1 THEN
      RAISE EXCEPTION 'pick_item: item %/%/% ambiguous across % sibling lists in group %',
        p_sku, p_warehouse, p_location, v_sibling_count, v_group_id
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF v_match = -1 THEN
    RAISE EXCEPTION 'pick_item: item %/%/% not found in list',
      p_sku, p_warehouse, p_location USING ERRCODE = '22023';
  END IF;

  IF v_already THEN
    RETURN jsonb_build_object('list_id', v_target_id, 'sku', p_sku, 'already_picked', true);
  END IF;

  v_items := jsonb_set(v_items, ARRAY[v_match::text, 'picked'], 'true'::jsonb, true);
  v_items := jsonb_set(v_items, ARRAY[v_match::text, 'picked_at'], to_jsonb(now()), true);

  v_key := p_sku || '@' || p_warehouse || '/' || p_location;
  IF NOT v_keys ? v_key THEN
    v_keys := v_keys || to_jsonb(v_key);
  END IF;

  UPDATE public.picking_lists
  SET items = v_items,
      verified_item_keys = v_keys,
      updated_at = now()
  WHERE id = v_target_id;

  RETURN jsonb_build_object(
    'list_id', v_target_id,
    'sku', p_sku,
    'picked', true,
    'qty_deducted', p_qty,
    'resolved_via_group', v_target_id <> p_list_id
  );
END;
$function$;


CREATE OR REPLACE FUNCTION public.unpick_item(
  p_list_id uuid,
  p_sku text,
  p_warehouse text,
  p_location text,
  p_qty integer,
  p_user_id uuid,
  p_performed_by text DEFAULT 'picker'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_target_id uuid := p_list_id;
  v_status   text;
  v_items    jsonb;
  v_keys     jsonb;
  v_group_id uuid;
  v_item     jsonb;
  v_idx      int := 0;
  v_match    int := -1;
  v_was_picked boolean := false;
  v_key      text;
  v_sibling_count int;
  v_active_states constant text[] :=
    ARRAY['active','needs_correction','ready_to_double_check','double_checking'];
BEGIN
  SELECT status, items, COALESCE(verified_item_keys, '[]'::jsonb), group_id
    INTO v_status, v_items, v_keys, v_group_id
  FROM public.picking_lists
  WHERE id = p_list_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'unpick_item: list % not found', p_list_id USING ERRCODE = '22023';
  END IF;

  IF v_status <> ALL(v_active_states) THEN
    RAISE EXCEPTION 'unpick_item: list % is in status % (must be active)', p_list_id, v_status
      USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(v_items, '[]'::jsonb)) LOOP
    IF v_item->>'sku' = p_sku
       AND v_item->>'warehouse' = p_warehouse
       AND v_item->>'location'  = p_location THEN
      v_match := v_idx;
      v_was_picked := COALESCE((v_item->>'picked')::boolean, false);
      EXIT;
    END IF;
    v_idx := v_idx + 1;
  END LOOP;

  IF v_match = -1 AND v_group_id IS NOT NULL THEN
    SELECT count(*) INTO v_sibling_count
    FROM public.picking_lists pl,
         jsonb_array_elements(COALESCE(pl.items, '[]'::jsonb)) it
    WHERE pl.group_id = v_group_id
      AND pl.id <> p_list_id
      AND pl.status = ANY(v_active_states)
      AND it->>'sku' = p_sku
      AND it->>'warehouse' = p_warehouse
      AND it->>'location'  = p_location;

    IF v_sibling_count = 1 THEN
      SELECT pl.id INTO v_target_id
      FROM public.picking_lists pl,
           jsonb_array_elements(COALESCE(pl.items, '[]'::jsonb)) it
      WHERE pl.group_id = v_group_id
        AND pl.id <> p_list_id
        AND pl.status = ANY(v_active_states)
        AND it->>'sku' = p_sku
        AND it->>'warehouse' = p_warehouse
        AND it->>'location'  = p_location
      LIMIT 1;

      SELECT status, items, COALESCE(verified_item_keys, '[]'::jsonb)
        INTO v_status, v_items, v_keys
      FROM public.picking_lists
      WHERE id = v_target_id
      FOR UPDATE;

      IF v_status <> ALL(v_active_states) THEN
        RAISE EXCEPTION 'unpick_item: sibling list % is in status % (must be active)',
          v_target_id, v_status USING ERRCODE = '22023';
      END IF;

      v_idx := 0;
      FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(v_items, '[]'::jsonb)) LOOP
        IF v_item->>'sku' = p_sku
           AND v_item->>'warehouse' = p_warehouse
           AND v_item->>'location'  = p_location THEN
          v_match := v_idx;
          v_was_picked := COALESCE((v_item->>'picked')::boolean, false);
          EXIT;
        END IF;
        v_idx := v_idx + 1;
      END LOOP;
    ELSIF v_sibling_count > 1 THEN
      RAISE EXCEPTION 'unpick_item: item %/%/% ambiguous across % sibling lists in group %',
        p_sku, p_warehouse, p_location, v_sibling_count, v_group_id
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF v_match = -1 THEN
    RAISE EXCEPTION 'unpick_item: item %/%/% not found in list',
      p_sku, p_warehouse, p_location USING ERRCODE = '22023';
  END IF;

  IF NOT v_was_picked THEN
    RETURN jsonb_build_object('list_id', v_target_id, 'sku', p_sku, 'already_unpicked', true);
  END IF;

  v_items := jsonb_set(v_items, ARRAY[v_match::text, 'picked'], 'false'::jsonb, true);

  v_key := p_sku || '@' || p_warehouse || '/' || p_location;
  v_keys := COALESCE(
    (SELECT jsonb_agg(elem) FROM jsonb_array_elements(v_keys) AS elem WHERE elem::text <> to_jsonb(v_key)::text),
    '[]'::jsonb
  );

  UPDATE public.picking_lists
  SET items = v_items,
      verified_item_keys = v_keys,
      updated_at = now()
  WHERE id = v_target_id;

  RETURN jsonb_build_object(
    'list_id', v_target_id,
    'sku', p_sku,
    'picked', false,
    'qty_restored', p_qty,
    'resolved_via_group', v_target_id <> p_list_id
  );
END;
$function$;
