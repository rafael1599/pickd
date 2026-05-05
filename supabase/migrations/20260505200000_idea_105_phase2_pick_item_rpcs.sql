-- idea-105 Phase 2 (LOCAL TESTING ONLY — do not push to prod)
-- Per-item DEDUCT on toggle; ALL inventory changes flow through a
-- single BEFORE UPDATE trigger on picking_lists. No skip-compensation
-- escape hatch needed — pick_item / unpick_item are thin wrappers that
-- only flip the picked flag in the items[] JSONB; the trigger reads
-- the diff and calls adjust_inventory_quantity exactly once per row.
--
-- Active states (= states where picked-tracking is meaningful):
--   active, needs_correction, ready_to_double_check, double_checking
--
-- Cases the trigger handles (status path + items diff):
--   1) items[i].picked false→true               → DEDUCT pickingQty
--   2) items[i].picked true→false               → ADD pickingQty (restore)
--   3) item w/ picked=true removed from array   → ADD pickingQty (restore)
--   4) item w/ picked=true and qty changed      → DEDUCT/ADD the delta
--   5) status active→cancelled with picked items → ADD all picked qtys
--   6) status active→completed                  → noop (process_picking_list
--                                                  is responsible — it
--                                                  must skip items with
--                                                  picked=true to avoid
--                                                  double-deduct).
--   7) status anything→reopened or reopened→anything → noop (recomplete
--                                                  delta logic owns this).

-- ---------------------------------------------------------------------------
-- compensate_picking_list_changes — single source of truth for inventory
-- changes derived from picking_lists transitions.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.compensate_picking_list_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old_item   jsonb;
  v_new_item   jsonb;
  v_old_picked boolean;
  v_new_picked boolean;
  v_old_qty    int;
  v_new_qty    int;
  v_match      boolean;
  v_active_states constant text[] :=
    ARRAY['active','needs_correction','ready_to_double_check','double_checking'];
BEGIN
  -- Reopen / recomplete have their own delta-based path — leave them alone.
  IF NEW.status = 'reopened' OR OLD.status = 'reopened' THEN
    RETURN NEW;
  END IF;

  -- Status -> 'cancelled' from any active state: restore all picked items.
  IF NEW.status = 'cancelled' AND OLD.status = ANY(v_active_states) THEN
    FOR v_old_item IN SELECT * FROM jsonb_array_elements(COALESCE(OLD.items, '[]'::jsonb)) LOOP
      IF COALESCE((v_old_item->>'picked')::boolean, false) = true THEN
        PERFORM public.adjust_inventory_quantity(
          p_sku          := v_old_item->>'sku',
          p_warehouse    := v_old_item->>'warehouse',
          p_location     := v_old_item->>'location',
          p_delta        := COALESCE((v_old_item->>'pickingQty')::int, 0),
          p_performed_by := 'system: cancel-restore',
          p_user_id      := NULL,
          p_list_id      := NEW.id,
          p_order_number := NEW.order_number,
          p_merge_note   := 'auto-restore on cancel'
        );
      END IF;
    END LOOP;
    RETURN NEW;
  END IF;

  -- Status -> 'completed': process_picking_list owns the deduct loop and
  -- must already skip items where picked=true. We do nothing here.
  IF NEW.status = 'completed' AND OLD.status = ANY(v_active_states) THEN
    RETURN NEW;
  END IF;

  -- Items diff while in active states: cases 1-4.
  IF NEW.status = ANY(v_active_states)
     AND OLD.status = ANY(v_active_states)
     AND OLD.items IS DISTINCT FROM NEW.items THEN

    -- Pass 1: walk OLD items, find matches in NEW, handle picked-stay,
    -- picked-flip-off, qty-change, and removed cases.
    FOR v_old_item IN SELECT * FROM jsonb_array_elements(COALESCE(OLD.items, '[]'::jsonb)) LOOP
      v_old_picked := COALESCE((v_old_item->>'picked')::boolean, false);
      v_old_qty    := COALESCE((v_old_item->>'pickingQty')::int, 0);
      v_match      := false;

      FOR v_new_item IN SELECT * FROM jsonb_array_elements(COALESCE(NEW.items, '[]'::jsonb)) LOOP
        IF v_new_item->>'sku'       = v_old_item->>'sku'
          AND v_new_item->>'warehouse' = v_old_item->>'warehouse'
          AND v_new_item->>'location'  = v_old_item->>'location' THEN
          v_match      := true;
          v_new_picked := COALESCE((v_new_item->>'picked')::boolean, false);
          v_new_qty    := COALESCE((v_new_item->>'pickingQty')::int, 0);

          -- 1) false → true: DEDUCT
          IF NOT v_old_picked AND v_new_picked THEN
            PERFORM public.adjust_inventory_quantity(
              p_sku          := v_old_item->>'sku',
              p_warehouse    := v_old_item->>'warehouse',
              p_location     := v_old_item->>'location',
              p_delta        := -v_new_qty,
              p_performed_by := 'system: pick',
              p_user_id      := NULL,
              p_list_id      := NEW.id,
              p_order_number := NEW.order_number
            );
          -- 2) true → false: ADD (restore)
          ELSIF v_old_picked AND NOT v_new_picked THEN
            PERFORM public.adjust_inventory_quantity(
              p_sku          := v_old_item->>'sku',
              p_warehouse    := v_old_item->>'warehouse',
              p_location     := v_old_item->>'location',
              p_delta        := v_old_qty,
              p_performed_by := 'system: unpick',
              p_user_id      := NULL,
              p_list_id      := NEW.id,
              p_order_number := NEW.order_number
            );
          -- 4) still picked, qty changed: delta
          ELSIF v_old_picked AND v_new_picked AND v_old_qty <> v_new_qty THEN
            PERFORM public.adjust_inventory_quantity(
              p_sku          := v_old_item->>'sku',
              p_warehouse    := v_old_item->>'warehouse',
              p_location     := v_old_item->>'location',
              p_delta        := v_old_qty - v_new_qty,
              p_performed_by := 'system: edit-qty',
              p_user_id      := NULL,
              p_list_id      := NEW.id,
              p_order_number := NEW.order_number,
              p_merge_note   := 'auto-compensate qty change'
            );
          END IF;
          EXIT;
        END IF;
      END LOOP;

      -- 3) Item removed entirely from the array. If it was picked, restore.
      IF NOT v_match AND v_old_picked THEN
        PERFORM public.adjust_inventory_quantity(
          p_sku          := v_old_item->>'sku',
          p_warehouse    := v_old_item->>'warehouse',
          p_location     := v_old_item->>'location',
          p_delta        := v_old_qty,
          p_performed_by := 'system: edit-remove',
          p_user_id      := NULL,
          p_list_id      := NEW.id,
          p_order_number := NEW.order_number,
          p_merge_note   := 'auto-restore: item removed'
        );
      END IF;
    END LOOP;

    -- Pass 2: walk NEW items looking for ones that did NOT exist in OLD
    -- but came in with picked=true (rare — usually new items start
    -- unpicked, but a swap-in could land already-picked).
    FOR v_new_item IN SELECT * FROM jsonb_array_elements(COALESCE(NEW.items, '[]'::jsonb)) LOOP
      v_new_picked := COALESCE((v_new_item->>'picked')::boolean, false);
      IF NOT v_new_picked THEN CONTINUE; END IF;
      v_match := false;
      FOR v_old_item IN SELECT * FROM jsonb_array_elements(COALESCE(OLD.items, '[]'::jsonb)) LOOP
        IF v_old_item->>'sku'       = v_new_item->>'sku'
          AND v_old_item->>'warehouse' = v_new_item->>'warehouse'
          AND v_old_item->>'location'  = v_new_item->>'location' THEN
          v_match := true;
          EXIT;
        END IF;
      END LOOP;
      IF NOT v_match THEN
        PERFORM public.adjust_inventory_quantity(
          p_sku          := v_new_item->>'sku',
          p_warehouse    := v_new_item->>'warehouse',
          p_location     := v_new_item->>'location',
          p_delta        := -COALESCE((v_new_item->>'pickingQty')::int, 0),
          p_performed_by := 'system: edit-add-prepicked',
          p_user_id      := NULL,
          p_list_id      := NEW.id,
          p_order_number := NEW.order_number,
          p_merge_note   := 'auto-deduct: new picked item added'
        );
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS compensate_picking_list_changes_trigger ON public.picking_lists;
CREATE TRIGGER compensate_picking_list_changes_trigger
  BEFORE UPDATE ON public.picking_lists
  FOR EACH ROW
  EXECUTE FUNCTION public.compensate_picking_list_changes();

-- ---------------------------------------------------------------------------
-- pick_item — thin wrapper. Only flips items[i].picked=true. The trigger
-- runs on the resulting UPDATE and emits the DEDUCT.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.pick_item(
  p_list_id    uuid,
  p_sku        text,
  p_warehouse  text,
  p_location   text,
  p_qty        int,
  p_user_id    uuid,
  p_performed_by text DEFAULT 'picker'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status   text;
  v_items    jsonb;
  v_keys     jsonb;
  v_item     jsonb;
  v_idx      int := 0;
  v_match    int := -1;
  v_already  boolean := false;
  v_key      text;
  v_active_states constant text[] :=
    ARRAY['active','needs_correction','ready_to_double_check','double_checking'];
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'pick_item: qty must be > 0' USING ERRCODE = '22023';
  END IF;

  SELECT status, items, COALESCE(verified_item_keys, '[]'::jsonb)
    INTO v_status, v_items, v_keys
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

  IF v_match = -1 THEN
    RAISE EXCEPTION 'pick_item: item %/%/% not found in list', p_sku, p_warehouse, p_location
      USING ERRCODE = '22023';
  END IF;

  -- Idempotent: if already picked, return without re-flipping (and so
  -- the trigger has nothing to do).
  IF v_already THEN
    RETURN jsonb_build_object('list_id', p_list_id, 'sku', p_sku, 'already_picked', true);
  END IF;

  v_items := jsonb_set(v_items, ARRAY[v_match::text, 'picked'], 'true'::jsonb, true);
  v_items := jsonb_set(v_items, ARRAY[v_match::text, 'picked_at'], to_jsonb(now()), true);

  v_key := p_sku || '@' || p_warehouse || '/' || p_location;
  IF NOT v_keys ? v_key THEN
    v_keys := v_keys || to_jsonb(v_key);
  END IF;

  -- This UPDATE fires the compensate trigger which detects the
  -- false→true picked flip and DEDUCTs the qty.
  UPDATE public.picking_lists
  SET items = v_items,
      verified_item_keys = v_keys,
      updated_at = now()
  WHERE id = p_list_id;

  RETURN jsonb_build_object(
    'list_id', p_list_id,
    'sku', p_sku,
    'picked', true,
    'qty_deducted', p_qty
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.pick_item(uuid, text, text, text, int, uuid, text)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- unpick_item — thin wrapper. Trigger ADDs the qty on the picked true→false flip.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.unpick_item(
  p_list_id    uuid,
  p_sku        text,
  p_warehouse  text,
  p_location   text,
  p_qty        int,
  p_user_id    uuid,
  p_performed_by text DEFAULT 'picker'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status   text;
  v_items    jsonb;
  v_keys     jsonb;
  v_item     jsonb;
  v_idx      int := 0;
  v_match    int := -1;
  v_was_picked boolean := false;
  v_key      text;
  v_active_states constant text[] :=
    ARRAY['active','needs_correction','ready_to_double_check','double_checking'];
BEGIN
  SELECT status, items, COALESCE(verified_item_keys, '[]'::jsonb)
    INTO v_status, v_items, v_keys
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

  IF v_match = -1 THEN
    RAISE EXCEPTION 'unpick_item: item %/%/% not found in list', p_sku, p_warehouse, p_location
      USING ERRCODE = '22023';
  END IF;

  IF NOT v_was_picked THEN
    RETURN jsonb_build_object('list_id', p_list_id, 'sku', p_sku, 'already_unpicked', true);
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
  WHERE id = p_list_id;

  RETURN jsonb_build_object(
    'list_id', p_list_id,
    'sku', p_sku,
    'picked', false,
    'qty_restored', p_qty
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.unpick_item(uuid, text, text, text, int, uuid, text)
  TO authenticated, service_role;
