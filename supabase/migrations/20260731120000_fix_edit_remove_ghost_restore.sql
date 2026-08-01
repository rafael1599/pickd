-- ============================================================================
-- Fix: Prevent Ghost Stock Restoration on edit-remove / unpick / recomplete
-- AND Auto-Zero Inventory on Order Completion for Insufficient Stock Items
--
-- Problem 1: When an order item marked picked=true was removed, swapped, or unpicked,
-- compensate_picking_list_changes (and recomplete_picking_list) automatically
-- restored +1 to inventory ("system: edit-remove").
-- However, when an item was removed because it was OUT OF STOCK / MISSING on floor
-- (flagged with insufficient_stock=true, sku_not_found=true, or no_restore=true),
-- no physical unit was ever picked. Restoring +1 back to inventory created a
-- permanent GHOST UNIT (+1) in the system when physically 0 exist.
--
-- Problem 2: When an order was completed with items flagged as insufficient_stock=true
-- or sku_not_found=true, process_picking_list skipped deducting them, leaving
-- zombie stock (quantity=1, is_active=true) in inventory even though floor pickers
-- confirmed the shelf is empty.
--
-- Fix:
--   1) Guard compensate_picking_list_changes and recomplete_picking_list so that
--      items flagged with insufficient_stock=true, sku_not_found=true, or no_restore=true
--      DO NOT add back stock on remove/unpick.
--   2) Update process_picking_list so that items flagged with insufficient_stock=true or
--      sku_not_found=true auto-zero out any remaining active stock at that location.
-- ============================================================================

-- 1. Update compensate_picking_list_changes trigger function
CREATE OR REPLACE FUNCTION public.compensate_picking_list_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old_items           jsonb;
  v_new_items           jsonb;
  v_old_item            jsonb;
  v_new_item            jsonb;
  v_old_picked          boolean;
  v_new_picked          boolean;
  v_old_is_out_of_stock boolean;
  v_old_qty             int;
  v_new_qty             int;
  v_old_len             int;
  v_new_len             int;
  v_i                   int;
  v_active_states constant text[] :=
    ARRAY['active','needs_correction','ready_to_double_check','double_checking'];
BEGIN
  -- Reopen / recomplete have their own delta-based path — leave them alone.
  IF NEW.status = 'reopened' OR OLD.status = 'reopened' THEN
    RETURN NEW;
  END IF;

  -- Status -> 'cancelled' from any active state: restore picked items EXCEPT out-of-stock / missing items.
  IF NEW.status = 'cancelled' AND OLD.status = ANY(v_active_states) THEN
    FOR v_old_item IN SELECT * FROM jsonb_array_elements(COALESCE(OLD.items, '[]'::jsonb)) LOOP
      v_old_picked := COALESCE((v_old_item->>'picked')::boolean, false);
      v_old_is_out_of_stock := COALESCE((v_old_item->>'insufficient_stock')::boolean, false)
                            OR COALESCE((v_old_item->>'sku_not_found')::boolean, false)
                            OR COALESCE((v_old_item->>'no_restore')::boolean, false);
      IF v_old_picked AND NOT v_old_is_out_of_stock THEN
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
      v_old_is_out_of_stock := COALESCE((v_old_item->>'insufficient_stock')::boolean, false)
                            OR COALESCE((v_old_item->>'sku_not_found')::boolean, false)
                            OR COALESCE((v_old_item->>'no_restore')::boolean, false);
      v_old_qty    := COALESCE((v_old_item->>'pickingQty')::int, 0);
      v_new_qty    := COALESCE((v_new_item->>'pickingQty')::int, 0);

      -- Same identity check: if SKU/warehouse/location changed at this index,
      -- treat as remove + add
      IF v_old_item->>'sku'       IS DISTINCT FROM v_new_item->>'sku'
        OR v_old_item->>'warehouse' IS DISTINCT FROM v_new_item->>'warehouse'
        OR v_old_item->>'location'  IS DISTINCT FROM v_new_item->>'location' THEN
        -- Old item at this position was effectively removed
        IF v_old_picked AND NOT v_old_is_out_of_stock THEN
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
      -- 2) true → false: ADD restore (skip_log: toggle noise) — ONLY IF item was in stock
      ELSIF v_old_picked AND NOT v_new_picked AND NOT v_old_is_out_of_stock THEN
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
      ELSIF v_old_picked AND v_new_picked AND v_old_qty <> v_new_qty AND NOT v_old_is_out_of_stock THEN
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
      v_old_is_out_of_stock := COALESCE((v_old_item->>'insufficient_stock')::boolean, false)
                            OR COALESCE((v_old_item->>'sku_not_found')::boolean, false)
                            OR COALESCE((v_old_item->>'no_restore')::boolean, false);
      v_old_qty    := COALESCE((v_old_item->>'pickingQty')::int, 0);
      IF v_old_picked AND NOT v_old_is_out_of_stock THEN
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

-- 2. Update recomplete_picking_list RPC to skip out-of-stock items in snapshot deltas
CREATE OR REPLACE FUNCTION public.recomplete_picking_list(
  p_list_id uuid,
  p_performed_by text,
  p_user_id uuid,
  p_pallets_qty integer DEFAULT NULL,
  p_total_units integer DEFAULT NULL,
  p_user_role text DEFAULT 'staff'
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_list RECORD;
  v_snap_item jsonb;
  v_curr_item jsonb;
  v_key text;
  v_snap_qty integer;
  v_curr_qty integer;
  v_delta integer;
  v_sku text;
  v_warehouse text;
  v_location text;
  v_order_number text;
  v_reopen_count integer;
  v_sku_not_found boolean;
  v_insufficient_stock boolean;
  v_no_restore boolean;
BEGIN
  -- Lock and validate
  SELECT * INTO v_list FROM picking_lists
  WHERE id = p_list_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Picking list % not found', p_list_id;
  END IF;

  IF v_list.status != 'reopened' THEN
    RAISE EXCEPTION 'Cannot recomplete: status is %, expected reopened', v_list.status;
  END IF;

  IF v_list.completed_snapshot IS NULL THEN
    RAISE EXCEPTION 'No snapshot found for reopened order %', p_list_id;
  END IF;

  IF jsonb_array_length(v_list.items) = 0 THEN
    RAISE EXCEPTION 'Cannot recomplete with zero items';
  END IF;

  v_order_number := v_list.order_number;
  v_reopen_count := COALESCE(v_list.reopen_count, 1);

  CREATE TEMP TABLE IF NOT EXISTS _snap_map (
    item_key text PRIMARY KEY,
    sku text,
    warehouse text,
    location text,
    qty integer
  ) ON COMMIT DROP;
  TRUNCATE _snap_map;

  CREATE TEMP TABLE IF NOT EXISTS _curr_map (
    item_key text PRIMARY KEY,
    sku text,
    warehouse text,
    location text,
    qty integer
  ) ON COMMIT DROP;
  TRUNCATE _curr_map;

  -- Populate snapshot map (skipping out-of-stock items)
  FOR v_snap_item IN SELECT * FROM jsonb_array_elements(v_list.completed_snapshot) LOOP
    v_sku_not_found := COALESCE((v_snap_item->>'sku_not_found')::boolean, false);
    v_insufficient_stock := COALESCE((v_snap_item->>'insufficient_stock')::boolean, false);
    v_no_restore := COALESCE((v_snap_item->>'no_restore')::boolean, false);

    IF v_sku_not_found OR v_insufficient_stock OR v_no_restore THEN CONTINUE; END IF;

    v_sku := v_snap_item->>'sku';
    v_warehouse := v_snap_item->>'warehouse';
    v_location := COALESCE(v_snap_item->>'location', '');
    v_snap_qty := COALESCE((v_snap_item->>'pickingQty')::integer, 0);

    IF v_snap_qty <= 0 THEN CONTINUE; END IF;

    v_key := v_sku || '::' || v_warehouse || '::' || v_location;

    INSERT INTO _snap_map (item_key, sku, warehouse, location, qty)
    VALUES (v_key, v_sku, v_warehouse, v_location, v_snap_qty)
    ON CONFLICT (item_key) DO UPDATE SET qty = _snap_map.qty + v_snap_qty;
  END LOOP;

  -- Populate current items map
  FOR v_curr_item IN SELECT * FROM jsonb_array_elements(v_list.items) LOOP
    v_sku_not_found := COALESCE((v_curr_item->>'sku_not_found')::boolean, false);
    v_insufficient_stock := COALESCE((v_curr_item->>'insufficient_stock')::boolean, false);
    v_no_restore := COALESCE((v_curr_item->>'no_restore')::boolean, false);

    IF v_sku_not_found OR v_insufficient_stock OR v_no_restore THEN CONTINUE; END IF;

    v_sku := v_curr_item->>'sku';
    v_warehouse := v_curr_item->>'warehouse';
    v_location := COALESCE(v_curr_item->>'location', '');
    v_curr_qty := COALESCE((v_curr_item->>'pickingQty')::integer, 0);

    IF v_curr_qty <= 0 THEN CONTINUE; END IF;

    v_key := v_sku || '::' || v_warehouse || '::' || v_location;

    INSERT INTO _curr_map (item_key, sku, warehouse, location, qty)
    VALUES (v_key, v_sku, v_warehouse, v_location, v_curr_qty)
    ON CONFLICT (item_key) DO UPDATE SET qty = _curr_map.qty + v_curr_qty;
  END LOOP;

  -- Process deltas
  FOR v_key, v_sku, v_warehouse, v_location, v_snap_qty IN
    SELECT s.item_key, s.sku, s.warehouse, s.location, s.qty FROM _snap_map s
  LOOP
    SELECT c.qty INTO v_curr_qty FROM _curr_map c WHERE c.item_key = v_key;

    IF v_curr_qty IS NULL THEN
      v_delta := v_snap_qty;
    ELSE
      v_delta := v_snap_qty - v_curr_qty;
    END IF;

    IF v_delta != 0 THEN
      PERFORM public.adjust_inventory_quantity(
        v_sku, v_warehouse, v_location,
        v_delta,
        p_performed_by, p_user_id, p_user_role,
        p_list_id, v_order_number,
        'Reopen delta #' || v_reopen_count
      );
    END IF;
  END LOOP;

  -- Items in current but NOT in snapshot: newly added, need to deduct
  FOR v_key, v_sku, v_warehouse, v_location, v_curr_qty IN
    SELECT c.item_key, c.sku, c.warehouse, c.location, c.qty
    FROM _curr_map c
    WHERE NOT EXISTS (SELECT 1 FROM _snap_map s WHERE s.item_key = c.item_key)
  LOOP
    IF v_curr_qty > 0 THEN
      PERFORM public.adjust_inventory_quantity(
        v_sku, v_warehouse, v_location,
        -v_curr_qty,
        p_performed_by, p_user_id, p_user_role,
        p_list_id, v_order_number,
        'Reopen new item #' || v_reopen_count
      );
    END IF;
  END LOOP;

  -- Finalize: mark as completed, clear snapshot
  UPDATE picking_lists SET
    status = 'completed',
    completed_snapshot = NULL,
    reopened_by = NULL,
    reopened_at = NULL,
    pallets_qty = COALESCE(p_pallets_qty, pallets_qty),
    total_units = COALESCE(p_total_units, total_units),
    checked_by = p_user_id,
    updated_at = NOW()
  WHERE id = p_list_id;

  INSERT INTO picking_list_notes (list_id, user_id, message)
  VALUES (
    p_list_id,
    p_user_id,
    'Order re-completed after reopen #' || v_reopen_count
  );

  DROP TABLE IF EXISTS _snap_map;
  DROP TABLE IF EXISTS _curr_map;

  RETURN TRUE;
END;
$$;

-- 3. Update process_picking_list to auto-zero active inventory when items are completed with insufficient_stock or sku_not_found
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
  v_insufficient_stock BOOLEAN;
  v_picked BOOLEAN;
  v_curr_inv_qty INTEGER;
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
    v_warehouse := COALESCE(v_item->>'warehouse', 'LUDLOW');
    v_location := v_item->>'location';
    v_qty := (v_item->>'pickingQty')::integer;
    v_sku_not_found := COALESCE((v_item->>'sku_not_found')::boolean, false);
    v_insufficient_stock := COALESCE((v_item->>'insufficient_stock')::boolean, false);
    v_picked := COALESCE((v_item->>'picked')::boolean, false);

    IF v_qty IS NULL OR v_qty <= 0 THEN
      CONTINUE;
    END IF;

    -- If flagged as insufficient_stock or sku_not_found: the picker/verifier checked the shelf and found NO STOCK!
    -- Auto-zero out remaining active inventory at this location.
    IF v_sku_not_found = true OR v_insufficient_stock = true THEN
      IF v_location IS NOT NULL AND TRIM(v_location) != '' THEN
        SELECT COALESCE(quantity, 0) INTO v_curr_inv_qty
        FROM inventory
        WHERE sku = v_sku
          AND warehouse = v_warehouse
          AND UPPER(TRIM(COALESCE(location, ''))) = UPPER(TRIM(v_location))
          AND is_active = true
        LIMIT 1;

        IF v_curr_inv_qty > 0 THEN
          PERFORM public.adjust_inventory_quantity(
            v_sku, v_warehouse, v_location, -v_curr_inv_qty,
            'system: auto-zero out-of-stock', p_user_id, p_user_role, p_list_id, v_order_number,
            'auto-zero: reported insufficient_stock in order'
          );
        END IF;
      END IF;
      CONTINUE;
    END IF;

    -- Items toggled picked=true already deducted via trigger.
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
