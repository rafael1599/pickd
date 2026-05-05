-- idea-105 Phase 2 (LOCAL TESTING ONLY — do not push to prod)
-- Per-item DEDUCT on toggle, DB-side trigger handles compensation.
--
-- Architecture:
--   pick_item RPC      -> sets items[i].picked=true, picked_at=now(),
--                          appends key to verified_item_keys, calls
--                          adjust_inventory_quantity(-qty).
--   unpick_item RPC    -> mirror, restores qty.
--   compensate trigger -> watches picking_lists UPDATEs. When items
--                          change OR status flips to 'cancelled', it
--                          finds picked-but-now-removed (or qty-changed)
--                          items and restores their qty automatically.
--                          Both RPCs set pickd.skip_compensation=true
--                          so the trigger doesn't double-compensate
--                          their own work.
--
-- Active states (= states where picked-tracking is meaningful):
--   active, needs_correction, ready_to_double_check, double_checking
--
-- Out of scope (handled elsewhere):
--   - reopen / recomplete: handled by recomplete_picking_list delta logic.
--     Trigger explicitly skips when status is 'reopened'.
--   - process_picking_list at completion: adapted in a separate migration
--     to skip items where picked=true (already deducted).

-- ---------------------------------------------------------------------------
-- Compensation trigger
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
  v_skip       boolean;
  v_old_picked boolean;
  v_new_picked boolean;
  v_old_qty    int;
  v_new_qty    int;
  v_match      boolean;
  v_active_states constant text[] :=
    ARRAY['active','needs_correction','ready_to_double_check','double_checking'];
BEGIN
  -- Skip when the calling RPC already accounted for the inventory change.
  v_skip := COALESCE(current_setting('pickd.skip_compensation', true), 'false')::boolean;
  IF v_skip THEN
    RETURN NEW;
  END IF;

  -- Reopen / recomplete have their own delta-based path — leave them alone.
  IF NEW.status = 'reopened' OR OLD.status = 'reopened' THEN
    RETURN NEW;
  END IF;

  -- ---- A) status -> 'cancelled' from any active state: restore all picked.
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

  -- ---- B) items change while in active states: detect picked-but-now-altered.
  IF NEW.status = ANY(v_active_states)
     AND OLD.status = ANY(v_active_states)
     AND OLD.items IS DISTINCT FROM NEW.items THEN
    FOR v_old_item IN SELECT * FROM jsonb_array_elements(COALESCE(OLD.items, '[]'::jsonb)) LOOP
      v_old_picked := COALESCE((v_old_item->>'picked')::boolean, false);
      IF NOT v_old_picked THEN
        CONTINUE; -- nothing to compensate; never deducted.
      END IF;
      v_old_qty := COALESCE((v_old_item->>'pickingQty')::int, 0);
      v_match   := false;

      -- Match by sku+warehouse+location.
      FOR v_new_item IN SELECT * FROM jsonb_array_elements(COALESCE(NEW.items, '[]'::jsonb)) LOOP
        IF v_new_item->>'sku'       = v_old_item->>'sku'
          AND v_new_item->>'warehouse' = v_old_item->>'warehouse'
          AND v_new_item->>'location'  = v_old_item->>'location' THEN
          v_match      := true;
          v_new_picked := COALESCE((v_new_item->>'picked')::boolean, false);
          v_new_qty    := COALESCE((v_new_item->>'pickingQty')::int, 0);

          -- Picked-flag changes (true→false) are the unpick_item RPC's job;
          -- it sets pickd.skip_compensation=true so we never reach this
          -- branch in that case. If we do reach it, compensate.
          IF v_new_picked = false THEN
            PERFORM public.adjust_inventory_quantity(
              p_sku          := v_old_item->>'sku',
              p_warehouse    := v_old_item->>'warehouse',
              p_location     := v_old_item->>'location',
              p_delta        := v_old_qty,
              p_performed_by := 'system: unpick-without-rpc',
              p_user_id      := NULL,
              p_list_id      := NEW.id,
              p_order_number := NEW.order_number,
              p_merge_note   := 'auto-restore: picked false outside RPC'
            );
          ELSIF v_new_qty <> v_old_qty THEN
            -- Qty changed while still picked. Compensate the delta:
            -- if qty went down, restore the difference; if up, deduct more.
            PERFORM public.adjust_inventory_quantity(
              p_sku          := v_old_item->>'sku',
              p_warehouse    := v_old_item->>'warehouse',
              p_location     := v_old_item->>'location',
              p_delta        := v_old_qty - v_new_qty, -- positive = restore.
              p_performed_by := 'system: edit-qty-compensation',
              p_user_id      := NULL,
              p_list_id      := NEW.id,
              p_order_number := NEW.order_number,
              p_merge_note   := 'auto-compensate edited qty'
            );
          END IF;
          EXIT; -- found the match, stop scanning NEW.
        END IF;
      END LOOP;

      -- Item entirely removed from the array (EditOrder remove, swap-out, etc.)
      IF NOT v_match THEN
        PERFORM public.adjust_inventory_quantity(
          p_sku          := v_old_item->>'sku',
          p_warehouse    := v_old_item->>'warehouse',
          p_location     := v_old_item->>'location',
          p_delta        := v_old_qty,
          p_performed_by := 'system: edit-remove-restore',
          p_user_id      := NULL,
          p_list_id      := NEW.id,
          p_order_number := NEW.order_number,
          p_merge_note   := 'auto-restore: item removed from order'
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
-- pick_item RPC
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

  -- Lock the row to prevent concurrent toggles racing.
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

  -- Locate the item index by sku+warehouse+location.
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

  -- Idempotent: if already picked, return current state without re-deducting.
  IF v_already THEN
    RETURN jsonb_build_object(
      'list_id', p_list_id, 'sku', p_sku, 'already_picked', true
    );
  END IF;

  -- Suppress the compensation trigger for this UPDATE — we are doing the
  -- inventory change ourselves below.
  PERFORM set_config('pickd.skip_compensation', 'true', true);

  -- Update the JSONB: mark picked, stamp picked_at.
  v_items := jsonb_set(
    v_items,
    ARRAY[v_match::text, 'picked'],
    'true'::jsonb,
    true
  );
  v_items := jsonb_set(
    v_items,
    ARRAY[v_match::text, 'picked_at'],
    to_jsonb(now()),
    true
  );

  -- Append the verified key for UI hydration. Use sublocation-agnostic
  -- key shape "{palletId}-{sku}-{location}" the frontend builds.
  -- The palletId portion is opaque to us — the frontend rebuilds the Set
  -- from items[].picked anyway. We keep verified_item_keys for backward
  -- compat with Phase 1 hydrate path; the actual key the frontend uses
  -- is built client-side from the same items, so this column is a
  -- secondary cache after Phase 2.
  v_key := p_sku || '@' || p_warehouse || '/' || p_location;
  IF NOT v_keys ? v_key THEN
    v_keys := v_keys || to_jsonb(v_key);
  END IF;

  UPDATE public.picking_lists
  SET items = v_items,
      verified_item_keys = v_keys,
      updated_at = now()
  WHERE id = p_list_id;

  -- Apply the DEDUCT.
  PERFORM public.adjust_inventory_quantity(
    p_sku          := p_sku,
    p_warehouse    := p_warehouse,
    p_location     := p_location,
    p_delta        := -p_qty,
    p_performed_by := p_performed_by,
    p_user_id      := p_user_id,
    p_list_id      := p_list_id
  );

  -- Reset the GUC so the next statement isn't accidentally suppressed.
  PERFORM set_config('pickd.skip_compensation', 'false', true);

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
-- unpick_item RPC
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

  -- Idempotent: if not picked, return without restoring.
  IF NOT v_was_picked THEN
    RETURN jsonb_build_object(
      'list_id', p_list_id, 'sku', p_sku, 'already_unpicked', true
    );
  END IF;

  PERFORM set_config('pickd.skip_compensation', 'true', true);

  -- Set picked=false. Leave picked_at as historical record (the next
  -- pick_item will overwrite it). Could also null it; choose to keep.
  v_items := jsonb_set(
    v_items,
    ARRAY[v_match::text, 'picked'],
    'false'::jsonb,
    true
  );

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

  PERFORM public.adjust_inventory_quantity(
    p_sku          := p_sku,
    p_warehouse    := p_warehouse,
    p_location     := p_location,
    p_delta        := p_qty, -- positive: restore.
    p_performed_by := p_performed_by,
    p_user_id      := p_user_id,
    p_list_id      := p_list_id,
    p_merge_note   := 'unpick: user toggle off'
  );

  PERFORM set_config('pickd.skip_compensation', 'false', true);

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
