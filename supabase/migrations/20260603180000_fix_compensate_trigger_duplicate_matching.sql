-- ============================================================================
-- Fix: duplicate-matching bug in compensate_picking_list_changes
--
-- Problem: when a picking list has 2+ items with the same sku+warehouse+location
-- (e.g., same SKU from two different source orders), the trigger's nested loop
-- matches multiple OLD items against the SAME NEW item. This causes:
--   - Over-deduction on pick toggles (each OLD item triggers a deduct against
--     the first matching NEW item, even if only ONE item was toggled)
--   - Under-restoration on unpick toggles (OLD picked item matches a different
--     NEW item that is still picked, so the unpick is invisible)
--
-- Root cause: matching by (sku, warehouse, location) is NOT unique when a
-- picking list contains duplicate SKUs at the same location.
--
-- Fix: switch from nested-loop matching to positional (index-based) matching.
-- Each OLD[i] is compared to NEW[i]. This is correct because:
--   1) The frontend updates items in-place (toggle picked on item at index N)
--   2) Items are never reordered within a single update
--   3) Add/remove operations change the array length, which is handled by
--      comparing OLD vs NEW array lengths and processing extras
--
-- Affected scenario: SKU 03-4080SL had qty=10 at ROW 11. A picking list with
-- 2 items of that SKU (qty=2 and qty=1) caused a deduction of 4 instead of 2
-- when the first item was toggled to picked. Over multiple toggles + completion,
-- the inventory was zeroed out instead of correctly reaching 7.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.compensate_picking_list_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old_items  jsonb;
  v_new_items  jsonb;
  v_old_item   jsonb;
  v_new_item   jsonb;
  v_old_picked boolean;
  v_new_picked boolean;
  v_old_qty    int;
  v_new_qty    int;
  v_old_len    int;
  v_new_len    int;
  v_i          int;
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

  -- Items diff while in active states.
  IF NEW.status = ANY(v_active_states)
     AND OLD.status = ANY(v_active_states)
     AND OLD.items IS DISTINCT FROM NEW.items THEN

    v_old_items := COALESCE(OLD.items, '[]'::jsonb);
    v_new_items := COALESCE(NEW.items, '[]'::jsonb);
    v_old_len   := jsonb_array_length(v_old_items);
    v_new_len   := jsonb_array_length(v_new_items);

    -- ── Positional pass: compare OLD[i] vs NEW[i] for overlapping indices ──
    FOR v_i IN 0 .. LEAST(v_old_len, v_new_len) - 1 LOOP
      v_old_item   := v_old_items->v_i;
      v_new_item   := v_new_items->v_i;
      v_old_picked := COALESCE((v_old_item->>'picked')::boolean, false);
      v_new_picked := COALESCE((v_new_item->>'picked')::boolean, false);
      v_old_qty    := COALESCE((v_old_item->>'pickingQty')::int, 0);
      v_new_qty    := COALESCE((v_new_item->>'pickingQty')::int, 0);

      -- Same identity check: if SKU/warehouse/location changed at this index,
      -- treat as remove + add (handled in the tail passes below via length diff,
      -- or as an explicit swap).
      IF v_old_item->>'sku'       IS DISTINCT FROM v_new_item->>'sku'
        OR v_old_item->>'warehouse' IS DISTINCT FROM v_new_item->>'warehouse'
        OR v_old_item->>'location'  IS DISTINCT FROM v_new_item->>'location' THEN
        -- Old item at this position was effectively removed
        IF v_old_picked THEN
          PERFORM public.adjust_inventory_quantity(
            p_sku          := v_old_item->>'sku',
            p_warehouse    := v_old_item->>'warehouse',
            p_location     := v_old_item->>'location',
            p_delta        := v_old_qty,
            p_performed_by := 'system: edit-remove',
            p_user_id      := NULL,
            p_list_id      := NEW.id,
            p_order_number := NEW.order_number,
            p_merge_note   := 'auto-restore: item replaced'
          );
        END IF;
        -- New item at this position was effectively added
        IF v_new_picked THEN
          PERFORM public.adjust_inventory_quantity(
            p_sku          := v_new_item->>'sku',
            p_warehouse    := v_new_item->>'warehouse',
            p_location     := v_new_item->>'location',
            p_delta        := -v_new_qty,
            p_performed_by := 'system: edit-add-prepicked',
            p_user_id      := NULL,
            p_list_id      := NEW.id,
            p_order_number := NEW.order_number,
            p_merge_note   := 'auto-deduct: replaced item added picked'
          );
        END IF;
        CONTINUE;
      END IF;

      -- Same item at same index: check for state changes.

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
    END LOOP;

    -- ── Tail: items removed (OLD is longer) ────────────────────────────────
    FOR v_i IN v_new_len .. v_old_len - 1 LOOP
      v_old_item   := v_old_items->v_i;
      v_old_picked := COALESCE((v_old_item->>'picked')::boolean, false);
      v_old_qty    := COALESCE((v_old_item->>'pickingQty')::int, 0);
      IF v_old_picked THEN
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

    -- ── Tail: items added (NEW is longer) ──────────────────────────────────
    FOR v_i IN v_old_len .. v_new_len - 1 LOOP
      v_new_item   := v_new_items->v_i;
      v_new_picked := COALESCE((v_new_item->>'picked')::boolean, false);
      v_new_qty    := COALESCE((v_new_item->>'pickingQty')::int, 0);
      IF v_new_picked THEN
        PERFORM public.adjust_inventory_quantity(
          p_sku          := v_new_item->>'sku',
          p_warehouse    := v_new_item->>'warehouse',
          p_location     := v_new_item->>'location',
          p_delta        := -v_new_qty,
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
