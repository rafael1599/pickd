-- ============================================================
-- MIGRACIÓN: fix_prod_schema_drift
-- Aplica en: PRODUCCIÓN (Supabase Studio → SQL Editor)
-- Problema: RPCs usan `sku_note` en inventory, pero la tabla
--           de prod tiene `item_name` + `internal_note`.
--           Además faltan columnas de stowage y capacity.
-- ============================================================

-- ── 1. COLUMNAS FALTANTES EN inventory ───────────────────────
ALTER TABLE public.inventory
  ADD COLUMN IF NOT EXISTS capacity       integer DEFAULT 550,
  ADD COLUMN IF NOT EXISTS stowage_type   text CHECK (stowage_type IS NULL OR stowage_type = ANY (ARRAY['TOWER','LINE','PALLET'])),
  ADD COLUMN IF NOT EXISTS stowage_index  integer,
  ADD COLUMN IF NOT EXISTS stowage_qty    numeric,
  ADD COLUMN IF NOT EXISTS location_hint  text;

-- ── 2. ÍNDICE de stowage (idéntico al local) ─────────────────
CREATE INDEX IF NOT EXISTS idx_inventory_stowage
  ON public.inventory (location, stowage_index);

CREATE UNIQUE INDEX IF NOT EXISTS unique_stowage_unit
  ON public.inventory (warehouse, sku, location, stowage_type, stowage_index)
  WHERE stowage_type IS NOT NULL;

-- ── 3. COLUMNA faltante en sku_metadata ──────────────────────
-- Local tiene length_ft que prod no tiene
ALTER TABLE public.sku_metadata
  ADD COLUMN IF NOT EXISTS length_ft numeric;

-- ── 4. FIX adjust_inventory_quantity ─────────────────────────
-- Cambia referencias de `sku_note` → `item_name`
-- (en prod, item_name es la columna equivalente a sku_note en local)
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
  p_skip_log boolean DEFAULT false
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

    -- FIXED: usa item_name en vez de sku_note
    INSERT INTO inventory (sku, warehouse, location, location_id, quantity, is_active, item_name)
    VALUES (p_sku, p_warehouse, v_location_name, v_location_id, v_new_qty, (v_new_qty > 0), p_merge_note)
    RETURNING id INTO v_item_id;
  ELSE
    v_new_qty := v_prev_qty + p_delta;
    IF v_new_qty < 0 THEN
      v_new_qty := 0;
      v_actual_delta := -v_prev_qty;
    END IF;

    -- FIXED: usa item_name en vez de sku_note
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
      END
    WHERE id = v_item_id;
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

-- ── 5. FIX move_inventory_stock ──────────────────────────────
-- Cambia `sku_note` → `item_name`
CREATE OR REPLACE FUNCTION public.move_inventory_stock(
  p_sku text,
  p_from_warehouse text,
  p_from_location text,
  p_to_warehouse text,
  p_to_location text,
  p_qty integer,
  p_performed_by text,
  p_user_id uuid DEFAULT NULL::uuid,
  p_user_role text DEFAULT 'staff'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_src_id BIGINT; v_src_prev_qty INTEGER; v_src_new_qty INTEGER; v_src_note TEXT;
  v_from_loc_id UUID; v_from_loc_name TEXT; v_to_loc_id UUID; v_snapshot JSONB;
BEGIN
  p_from_location := NULLIF(TRIM(UPPER(p_from_location)), '');
  p_to_location   := NULLIF(TRIM(UPPER(p_to_location)), '');

  -- FIXED: usa item_name en vez de sku_note
  SELECT id, quantity, item_name INTO v_src_id, v_src_prev_qty, v_src_note
  FROM public.inventory
  WHERE sku = p_sku AND warehouse = p_from_warehouse
    AND ((p_from_location IS NULL AND (location IS NULL OR location = '')) OR (location = p_from_location))
    AND is_active = TRUE
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Source item not found or inactive'; END IF;

  v_from_loc_id := public.resolve_location(p_from_warehouse, p_from_location);
  SELECT location INTO v_from_loc_name FROM public.locations WHERE id = v_from_loc_id;
  v_to_loc_id := public.resolve_location(p_to_warehouse, p_to_location);

  PERFORM public.adjust_inventory_quantity(p_sku, p_from_warehouse, p_from_location, -p_qty, p_performed_by, p_user_id, p_user_role, NULL, NULL, NULL, TRUE);
  v_src_new_qty := v_src_prev_qty - p_qty;
  PERFORM public.adjust_inventory_quantity(p_sku, p_to_warehouse, p_to_location, p_qty, p_performed_by, p_user_id, p_user_role, NULL, NULL, v_src_note, TRUE);

  SELECT jsonb_build_object('id', v_src_id, 'sku', p_sku, 'quantity', v_src_new_qty, 'location', p_from_location, 'warehouse', p_from_warehouse) INTO v_snapshot;

  PERFORM public.upsert_inventory_log(
    p_sku::TEXT, p_from_warehouse::TEXT, v_from_loc_name::TEXT, p_to_warehouse::TEXT, p_to_location::TEXT,
    (-p_qty)::INTEGER, v_src_prev_qty::INTEGER, v_src_new_qty::INTEGER, 'MOVE'::TEXT,
    v_src_id::BIGINT, v_from_loc_id::UUID, v_to_loc_id::UUID, p_performed_by::TEXT, p_user_id::UUID, NULL::UUID, NULL::TEXT, v_snapshot::JSONB
  );

  RETURN jsonb_build_object('success', true, 'moved_qty', p_qty, 'id', v_src_id);
END;
$function$;

-- ── 6. FIX create_daily_snapshot ─────────────────────────────
-- Copia item_name de inventory → sku_note en snapshots
-- (daily_inventory_snapshots mantiene sku_note como nombre histórico)
CREATE OR REPLACE FUNCTION public.create_daily_snapshot(
  p_snapshot_date date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_count INTEGER;
BEGIN
  DELETE FROM daily_inventory_snapshots
  WHERE snapshot_date = p_snapshot_date;

  -- FIXED: lee item_name de inventory, guarda en sku_note de snapshots
  INSERT INTO daily_inventory_snapshots
    (snapshot_date, warehouse, location, sku, quantity, location_id, sku_note)
  SELECT
    p_snapshot_date,
    warehouse,
    location,
    sku,
    quantity,
    location_id,
    item_name   -- <-- era sku_note, que no existe en prod
  FROM inventory
  WHERE is_active = TRUE AND quantity > 0;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'success',       true,
    'snapshot_date', p_snapshot_date,
    'items_saved',   v_count,
    'created_at',    NOW()
  );
END;
$function$;

-- ── 7. FIX undo_inventory_action ─────────────────────────────
-- Cambia sku_note → item_name; maneja snapshots viejos con COALESCE
CREATE OR REPLACE FUNCTION public.undo_inventory_action(target_log_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
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
          is_active   = (v_log.snapshot_before->>'is_active')::boolean
      WHERE id = v_item_id;

      IF NOT FOUND THEN
          INSERT INTO inventory (id, sku, quantity, location, location_id, warehouse, is_active, item_name)
          VALUES (
              v_item_id,
              COALESCE(v_log.snapshot_before->>'sku', v_log.sku),
              (v_log.snapshot_before->>'quantity')::int,
              v_log.snapshot_before->>'location',
              NULLIF(v_log.snapshot_before->>'location_id', '')::uuid,
              v_log.snapshot_before->>'warehouse',
              (v_log.snapshot_before->>'is_active')::boolean,
              v_note
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
$function$;

-- ── 8. VERIFICACIÓN FINAL ─────────────────────────────────────
-- Corre esto al final para confirmar que todo está OK
SELECT
  column_name,
  data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'inventory'
ORDER BY ordinal_position;
