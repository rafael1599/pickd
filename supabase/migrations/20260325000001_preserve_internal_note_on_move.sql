-- idea-017: Preserve internal_note when moving inventory between locations
--
-- Three fixes:
-- 1) adjust_inventory_quantity: new p_internal_note param, sets it on INSERT and UPDATE
-- 2) move_inventory_stock: reads source internal_note, forwards to destination
-- 3) undo_inventory_action: restores internal_note from snapshot

-- ============================================================
-- FIX 1: adjust_inventory_quantity — propagate internal_note
-- ============================================================
-- Drop old signature first to avoid overload ambiguity
DROP FUNCTION IF EXISTS public.adjust_inventory_quantity(text, text, text, integer, text, uuid, text, uuid, text, text, boolean);

CREATE OR REPLACE FUNCTION public.adjust_inventory_quantity(
    p_sku text,
    p_warehouse text,
    p_location text,
    p_delta integer,
    p_performed_by text,
    p_user_id uuid,
    p_user_role text DEFAULT 'staff'::text,
    p_list_id uuid DEFAULT NULL::uuid,
    p_order_number text DEFAULT NULL::text,
    p_merge_note text DEFAULT NULL::text,
    p_skip_log boolean DEFAULT false,
    p_internal_note text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
    v_item_id INTEGER;
    v_location_id UUID;
    v_location_name TEXT;
    v_prev_qty INTEGER;
    v_new_qty INTEGER;
    v_actual_delta INTEGER;
    v_snapshot JSONB;
BEGIN
    v_location_id := public.resolve_location(p_warehouse, p_location, p_user_role);
    SELECT location INTO v_location_name FROM locations WHERE id = v_location_id;

    IF v_location_id IS NOT NULL AND v_location_name IS NULL THEN
        v_location_name := UPPER(TRIM(p_location));
    END IF;

    v_actual_delta := p_delta;

    SELECT id, quantity, row_to_json(inventory.*)::jsonb INTO v_item_id, v_prev_qty, v_snapshot
    FROM inventory
    WHERE sku = p_sku
      AND warehouse = p_warehouse
      AND UPPER(TRIM(COALESCE(location, ''))) = UPPER(TRIM(COALESCE(v_location_name, '')))
    FOR UPDATE;

    IF v_item_id IS NULL THEN
        v_prev_qty := 0;
        IF p_delta < 0 THEN
            v_actual_delta := 0;
            v_new_qty := 0;
        ELSE
            v_new_qty := p_delta;
        END IF;

        INSERT INTO inventory (sku, warehouse, location, location_id, quantity, is_active, item_name, internal_note)
        VALUES (p_sku, p_warehouse, v_location_name, v_location_id, v_new_qty, (v_new_qty > 0), p_merge_note, p_internal_note)
        RETURNING id INTO v_item_id;
    ELSE
        v_new_qty := v_prev_qty + p_delta;
        IF v_new_qty < 0 THEN
            v_new_qty := 0;
            v_actual_delta := -v_prev_qty;
        END IF;

        UPDATE inventory SET
            quantity    = v_new_qty,
            location_id = v_location_id,
            location    = v_location_name,
            is_active   = CASE WHEN v_new_qty > 0 THEN true ELSE is_active END,
            updated_at  = NOW(),
            item_name = CASE
                WHEN p_merge_note IS NOT NULL AND LENGTH(TRIM(p_merge_note)) > 0 THEN
                    CASE
                        WHEN item_name IS NULL OR LENGTH(TRIM(item_name)) = 0 THEN p_merge_note
                        WHEN item_name != p_merge_note AND item_name NOT LIKE '%' || p_merge_note || '%' THEN item_name || ' | ' || p_merge_note
                        ELSE item_name
                    END
                ELSE item_name
            END,
            internal_note = CASE
                WHEN p_internal_note IS NOT NULL THEN p_internal_note
                ELSE internal_note
            END
        WHERE id = v_item_id;

        -- Adjust distribution when deducting
        IF v_actual_delta < 0 THEN
            PERFORM public.adjust_distribution(v_item_id, (-v_actual_delta));
        END IF;
    END IF;

    IF NOT p_skip_log AND v_actual_delta != 0 THEN
        PERFORM public.upsert_inventory_log(
            p_sku, p_warehouse, v_location_name, p_warehouse, v_location_name,
            v_actual_delta, v_prev_qty, v_new_qty, (CASE WHEN v_actual_delta > 0 THEN 'ADD' ELSE 'DEDUCT' END),
            v_item_id, v_location_id, v_location_id, p_performed_by, p_user_id, p_list_id, p_order_number, v_snapshot
        );
    END IF;

    RETURN (SELECT row_to_json(i)::jsonb FROM inventory i WHERE id = v_item_id);
END;
$function$;


-- ============================================================
-- FIX 2: move_inventory_stock — read and forward internal_note
-- ============================================================
-- Drop old signature first to avoid overload ambiguity
DROP FUNCTION IF EXISTS public.move_inventory_stock(text, text, text, text, text, integer, text, uuid, text);

CREATE OR REPLACE FUNCTION public.move_inventory_stock(
    p_sku TEXT,
    p_from_warehouse TEXT,
    p_from_location TEXT,
    p_to_warehouse TEXT,
    p_to_location TEXT,
    p_qty INTEGER,
    p_performed_by TEXT,
    p_user_id UUID DEFAULT NULL,
    p_user_role TEXT DEFAULT 'staff',
    p_internal_note TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_src_id BIGINT; v_src_prev_qty INTEGER; v_src_new_qty INTEGER; v_src_note TEXT;
  v_src_internal_note TEXT;
  v_from_loc_id UUID; v_from_loc_name TEXT; v_to_loc_id UUID; v_snapshot JSONB;
  v_resolved_note TEXT;
BEGIN
  p_from_location := NULLIF(TRIM(UPPER(p_from_location)), '');
  p_to_location   := NULLIF(TRIM(UPPER(p_to_location)), '');

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

  -- Capture FULL pre-move snapshot (before any changes)
  SELECT row_to_json(inv.*)::jsonb INTO v_snapshot
  FROM public.inventory inv
  WHERE inv.id = v_src_id;

  -- Resolve which internal_note to use at destination:
  -- If frontend passed one explicitly (merge resolution), use it. Otherwise inherit from source.
  v_resolved_note := COALESCE(p_internal_note, v_src_internal_note);

  PERFORM public.adjust_inventory_quantity(p_sku, p_from_warehouse, p_from_location, -p_qty, p_performed_by, p_user_id, p_user_role, NULL, NULL, NULL, TRUE);
  v_src_new_qty := v_src_prev_qty - p_qty;
  PERFORM public.adjust_inventory_quantity(p_sku, p_to_warehouse, p_to_location, p_qty, p_performed_by, p_user_id, p_user_role, NULL, NULL, v_src_note, TRUE, v_resolved_note);

  PERFORM public.upsert_inventory_log(
    p_sku::TEXT, p_from_warehouse::TEXT, v_from_loc_name::TEXT, p_to_warehouse::TEXT, p_to_location::TEXT,
    (-p_qty)::INTEGER, v_src_prev_qty::INTEGER, v_src_new_qty::INTEGER, 'MOVE'::TEXT,
    v_src_id::BIGINT, v_from_loc_id::UUID, v_to_loc_id::UUID, p_performed_by::TEXT, p_user_id::UUID, NULL::UUID, NULL::TEXT, v_snapshot::JSONB
  );

  RETURN jsonb_build_object('success', true, 'moved_qty', p_qty, 'id', v_src_id);
END;
$$;


-- ============================================================
-- FIX 3: undo_inventory_action — restore internal_note
-- ============================================================
CREATE OR REPLACE FUNCTION public.undo_inventory_action(target_log_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_log inventory_logs%ROWTYPE;
  v_item_id BIGINT;
  v_move_qty INT;
  v_note TEXT;
BEGIN
  SELECT * INTO v_log FROM inventory_logs WHERE id = target_log_id FOR UPDATE;

  IF v_log IS NULL THEN RETURN jsonb_build_object('success', false, 'message', 'Log not found'); END IF;
  IF v_log.is_reversed THEN RETURN jsonb_build_object('success', false, 'message', 'Action already reversed'); END IF;

  v_item_id := COALESCE(
      v_log.item_id,
      (v_log.snapshot_before->>'id')::bigint,
      (v_log.snapshot_before->>'ID')::bigint
  );

  IF v_item_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'message', 'Could not identify ID to reverse');
  END IF;

  -- Snapshots viejos guardaron 'sku_note', los nuevos guardan 'item_name'
  v_note := COALESCE(
      v_log.snapshot_before->>'item_name',
      v_log.snapshot_before->>'sku_note'
  );

  IF v_log.snapshot_before IS NOT NULL THEN
      UPDATE inventory SET
          sku         = COALESCE(v_log.snapshot_before->>'sku', v_log.sku),
          quantity    = (v_log.snapshot_before->>'quantity')::int,
          location    = (v_log.snapshot_before->>'location'),
          location_id = NULLIF(v_log.snapshot_before->>'location_id', '')::uuid,
          warehouse   = (v_log.snapshot_before->>'warehouse'),
          item_name   = v_note,
          internal_note = v_log.snapshot_before->>'internal_note',
          is_active   = COALESCE((v_log.snapshot_before->>'is_active')::boolean, TRUE),
          distribution = CASE
              WHEN v_log.snapshot_before ? 'distribution'
              THEN (v_log.snapshot_before->'distribution')
              ELSE distribution
          END
      WHERE id = v_item_id;

      IF NOT FOUND THEN
          INSERT INTO inventory (id, sku, quantity, location, location_id, warehouse, is_active, item_name, internal_note, distribution)
          VALUES (
              v_item_id,
              COALESCE(v_log.snapshot_before->>'sku', v_log.sku),
              (v_log.snapshot_before->>'quantity')::int,
              v_log.snapshot_before->>'location',
              NULLIF(v_log.snapshot_before->>'location_id', '')::uuid,
              v_log.snapshot_before->>'warehouse',
              COALESCE((v_log.snapshot_before->>'is_active')::boolean, TRUE),
              v_note,
              v_log.snapshot_before->>'internal_note',
              CASE
                  WHEN v_log.snapshot_before ? 'distribution'
                  THEN (v_log.snapshot_before->'distribution')
                  ELSE '[]'::jsonb
              END
          );
      END IF;

      IF v_log.action_type = 'MOVE' THEN
          v_move_qty := ABS(v_log.quantity_change);
          UPDATE inventory
          SET quantity = GREATEST(0, quantity - v_move_qty)
          WHERE sku = v_log.sku
            AND warehouse = v_log.to_warehouse
            AND UPPER(location) = UPPER(v_log.to_location);
      END IF;

  ELSE
      IF v_log.action_type = 'MOVE' THEN
          v_move_qty := ABS(v_log.quantity_change);

          UPDATE inventory
          SET quantity = quantity + v_move_qty, is_active = true
          WHERE id = v_item_id;

          UPDATE inventory
          SET quantity = GREATEST(0, quantity - v_move_qty)
          WHERE sku = v_log.sku
            AND warehouse = v_log.to_warehouse
            AND UPPER(location) = UPPER(v_log.to_location);
      ELSE
          UPDATE inventory
          SET quantity = quantity - v_log.quantity_change,
              is_active = CASE WHEN (quantity - v_log.quantity_change) > 0 THEN true ELSE is_active END
          WHERE id = v_item_id;
      END IF;
  END IF;

  UPDATE inventory_logs SET is_reversed = TRUE WHERE id = target_log_id;
  RETURN jsonb_build_object('success', true);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$$;
