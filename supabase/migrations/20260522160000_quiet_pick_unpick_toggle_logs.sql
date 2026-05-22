-- ============================================================================
-- Quiet pick/unpick toggle logs (Option C)
--
-- Problem: when a picker toggles an item checkbox in DoubleCheckView during
-- active states, the trigger `compensate_picking_list_changes` writes one
-- inventory_logs row per toggle. A picker who goes pick→unpick→pick on 14
-- items generates 28+ log rows that net to zero inventory change. This
-- pollutes audit history and makes inventory_logs noisy.
--
-- Decision: keep the real-time inventory.quantity update (so other pickers
-- see accurate "available" stock without ghost items), but suppress the
-- per-toggle log row via the existing `p_skip_log := true` parameter of
-- `adjust_inventory_quantity`.
--
-- Trade-off accepted: inventory_logs no longer records per-toggle events
-- during picking. Forensic "who picked SKU X at time T" lives in
-- `picking_lists.items[].picked_at` + `picking_list_notes`, not in
-- inventory_logs. Logs in this table are now restricted to meaningful
-- inventory movements: restocks, manual adjustments, completion, cancellation,
-- and explicit item edits (add/remove/qty-change).
--
-- Scope (only these two trigger branches change):
--   1) items[].picked  false → true   (pick toggle)   → skip log
--   2) items[].picked  true  → false  (unpick toggle) → skip log
--
-- Unchanged (still write logs):
--   - Item added with picked=true (edit-add-prepicked)
--   - Item removed while picked (edit-remove)
--   - Qty changed while picked (edit-qty)
--   - status active → cancelled (cancel-restore branch)
--   - All cancel_completed_order / cancel_reopen / recomplete paths
--     (these call adjust_inventory_quantity without p_skip_log)
-- ============================================================================

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
  -- These restore actions DO write logs (audit value: order was cancelled).
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

  -- Items diff while in active states: cases 1-5.
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

          -- 1) false → true: DEDUCT (skip_log: toggle noise)
          IF NOT v_old_picked AND v_new_picked THEN
            PERFORM public.adjust_inventory_quantity(
              p_sku          := v_old_item->>'sku',
              p_warehouse    := v_old_item->>'warehouse',
              p_location     := v_old_item->>'location',
              p_delta        := -v_new_qty,
              p_performed_by := 'system: pick',
              p_user_id      := NULL,
              p_list_id      := NEW.id,
              p_order_number := NEW.order_number,
              p_skip_log     := true
            );
          -- 2) true → false: ADD restore (skip_log: toggle noise)
          ELSIF v_old_picked AND NOT v_new_picked THEN
            PERFORM public.adjust_inventory_quantity(
              p_sku          := v_old_item->>'sku',
              p_warehouse    := v_old_item->>'warehouse',
              p_location     := v_old_item->>'location',
              p_delta        := v_old_qty,
              p_performed_by := 'system: unpick',
              p_user_id      := NULL,
              p_list_id      := NEW.id,
              p_order_number := NEW.order_number,
              p_skip_log     := true
            );
          -- 4) still picked, qty changed: delta (KEEPS log — explicit edit)
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

      -- 3) Item removed entirely from the array (KEEPS log — explicit edit).
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
    -- unpicked, but a swap-in could land already-picked). KEEPS log.
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
