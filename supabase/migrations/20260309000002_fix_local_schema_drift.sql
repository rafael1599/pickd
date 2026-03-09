-- ============================================================
-- MIGRACIÓN: fix_local_schema_drift
-- Aplica en: LOCAL (Docker → Supabase Studio http://localhost:54323)
-- Problema: local tiene `sku_note` pero el código usa `item_name`
--           + `internal_note`. Hay que renombrar + agregar.
-- ============================================================

-- ── 1. Renombrar sku_note → item_name en inventory ───────────
-- (preserva todos los datos existentes)
ALTER TABLE public.inventory
  RENAME COLUMN sku_note TO item_name;

-- ── 2. Agregar internal_note (nueva columna que falta) ────────
ALTER TABLE public.inventory
  ADD COLUMN IF NOT EXISTS internal_note text;

-- ── 3. Verificar resultado en inventory ───────────────────────
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'inventory'
ORDER BY ordinal_position;

-- ── 4. Actualizar la RPC adjust_inventory_quantity ───────────
-- (igual que prod: usa item_name en vez de sku_note)
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

    INSERT INTO inventory (sku, warehouse, location, location_id, quantity, is_active, item_name)
    VALUES (p_sku, p_warehouse, v_location_name, v_location_id, v_new_qty, (v_new_qty > 0), p_merge_note)
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

-- ── 5. Actualizar move_inventory_stock ───────────────────────
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

-- ── 6. Actualizar create_daily_snapshot ──────────────────────
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

  INSERT INTO daily_inventory_snapshots
    (snapshot_date, warehouse, location, sku, quantity, location_id, sku_note)
  SELECT
    p_snapshot_date,
    warehouse,
    location,
    sku,
    quantity,
    location_id,
    item_name
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
