-- ============================================================================
-- Mover con los números exactos por cuadro (idea-255 P1, 7 oct 2026)
--
-- Rafael: «darles la herramienta para que los usuarios en el piso hagan los
-- movimientos con los números exactos por sublocation». Estudio:
-- docs/prds/relocate-stock-redesign.md.
--
-- 1. inventory_logs.move_detail: qué salió de qué cuadro, dónde cayó y la
--    foto del destino antes, para deshacer las dos filas.
-- 2. move_stock_squares: la hoja nueva calcula los grupos de las dos filas
--    (src/features/inventory/utils/moveLoad.ts, una sola regla) y esta función
--    los escribe en una transacción. Antes de escribir compara las dos filas
--    con lo que la hoja vio: si alguien las cambió, no escribe nada (stale).
--    Misma fila, otro cuadro, se permite.
-- 3. undo_inventory_action: con move_detail devuelve las dos fotos.
-- 4. move_inventory_stock (la usan aún intake, devoluciones y el mapa): las
--    letras del destino se unen, nunca se reemplazan.
-- ============================================================================

BEGIN;

ALTER TABLE public.inventory_logs ADD COLUMN IF NOT EXISTS move_detail jsonb;
COMMENT ON COLUMN public.inventory_logs.move_detail IS
  'move_stock_squares: {take, land, origin_split, dest_item_id, dest_snapshot_before} (idea-255).';

CREATE OR REPLACE FUNCTION public.move_stock_squares(
  p_item_id bigint,
  p_expected jsonb,
  p_qty integer,
  p_origin_distribution jsonb,
  p_to_location text,
  p_dest_expected jsonb,
  p_dest_distribution jsonb,
  p_dest_squares text[],
  p_detail jsonb,
  p_performed_by text,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_src inventory%ROWTYPE;
  v_dst inventory%ROWTYPE;
  v_snapshot jsonb;
  v_dest_snapshot jsonb;
  v_to text := NULLIF(UPPER(TRIM(p_to_location)), '');
  v_is_row boolean;
  v_from_loc_id uuid;
  v_to_loc_id uuid;
  v_to_name text;
  v_dest_id bigint;
  v_dest_qty int;
  v_log_id uuid;
  v_same boolean;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'move_stock_squares: qty must be > 0' USING ERRCODE = '22023';
  END IF;
  IF v_to IS NULL THEN
    RAISE EXCEPTION 'move_stock_squares: destination is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_src FROM inventory WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND OR NOT v_src.is_active THEN
    RAISE EXCEPTION 'stale:origin' USING ERRCODE = '40001';
  END IF;
  -- What the sheet saw must still be there.
  IF v_src.quantity <> (p_expected->>'quantity')::int
     OR COALESCE(v_src.distribution, '[]'::jsonb) <> COALESCE(p_expected->'distribution', '[]'::jsonb) THEN
    RAISE EXCEPTION 'stale:origin' USING ERRCODE = '40001';
  END IF;
  IF p_qty > v_src.quantity THEN
    RAISE EXCEPTION 'move_stock_squares: only % there', v_src.quantity USING ERRCODE = '22023';
  END IF;

  v_snapshot := row_to_json(v_src.*)::jsonb;
  v_is_row := v_to ILIKE 'ROW%';
  v_same := UPPER(TRIM(COALESCE(v_src.location, ''))) = v_to;
  v_from_loc_id := v_src.location_id;

  IF v_same THEN
    -- Another square of the same row: one row, its groups as the sheet built them.
    IF NOT v_is_row OR p_dest_distribution IS NULL THEN
      RAISE EXCEPTION 'move_stock_squares: source and target are the same' USING ERRCODE = '22023';
    END IF;
    UPDATE inventory SET
      distribution = p_dest_distribution,
      sublocation = (SELECT array_agg(DISTINCT s ORDER BY s)
                       FROM unnest(COALESCE(sublocation, '{}') || COALESCE(p_dest_squares, '{}')) s)
    WHERE id = v_src.id;
    v_dest_id := v_src.id;
    v_dest_snapshot := v_snapshot;
    v_to_loc_id := v_src.location_id;
    v_to_name := v_src.location;
    v_dest_qty := v_src.quantity;
  ELSE
    v_to_loc_id := public.resolve_location(v_src.warehouse, v_to);
    SELECT location INTO v_to_name FROM locations WHERE id = v_to_loc_id;
    v_to_name := COALESCE(v_to_name, v_to);

    SELECT * INTO v_dst FROM inventory
     WHERE sku = v_src.sku AND warehouse = v_src.warehouse
       AND UPPER(TRIM(COALESCE(location, ''))) = UPPER(TRIM(v_to_name))
     ORDER BY is_active DESC, quantity DESC
     LIMIT 1
     FOR UPDATE;

    IF FOUND THEN
      v_dest_snapshot := row_to_json(v_dst.*)::jsonb;
      v_dest_qty := CASE WHEN v_dst.is_active THEN v_dst.quantity ELSE 0 END;
    ELSE
      v_dest_qty := 0;
    END IF;
    IF v_dest_qty <> COALESCE((p_dest_expected->>'quantity')::int, 0)
       OR (v_dest_qty > 0 AND COALESCE(v_dst.distribution, '[]'::jsonb)
                              <> COALESCE(p_dest_expected->'distribution', '[]'::jsonb)) THEN
      RAISE EXCEPTION 'stale:dest' USING ERRCODE = '40001';
    END IF;

    UPDATE inventory SET
      quantity = v_src.quantity - p_qty,
      is_active = (v_src.quantity - p_qty) > 0,
      distribution = CASE WHEN v_src.quantity - p_qty > 0
                          THEN COALESCE(p_origin_distribution, distribution) ELSE '[]'::jsonb END
    WHERE id = v_src.id;

    IF v_dst.id IS NOT NULL THEN
      UPDATE inventory SET
        quantity = v_dest_qty + p_qty,
        is_active = true,
        location_id = v_to_loc_id,
        location = v_to_name,
        -- No groups sent (not a ROW, a part): the default trigger builds them
        -- for a revived row; a live row keeps its own.
        distribution = COALESCE(p_dest_distribution,
                                CASE WHEN v_dest_qty > 0 THEN distribution ELSE '[]'::jsonb END),
        sublocation = CASE
          WHEN NOT v_is_row THEN NULL
          ELSE (SELECT array_agg(DISTINCT s ORDER BY s)
                  FROM unnest(CASE WHEN v_dest_qty > 0 THEN COALESCE(sublocation, '{}') ELSE '{}' END
                              || COALESCE(p_dest_squares, '{}')) s)
        END
      WHERE id = v_dst.id;
      v_dest_id := v_dst.id;
    ELSE
      INSERT INTO inventory (sku, warehouse, location, location_id, quantity, is_active,
                             item_name, internal_note, distribution, sublocation)
      VALUES (v_src.sku, v_src.warehouse, v_to_name, v_to_loc_id, p_qty, true,
              v_src.item_name, v_src.internal_note,
              COALESCE(p_dest_distribution, '[]'::jsonb),
              CASE WHEN v_is_row AND cardinality(p_dest_squares) > 0 THEN
                (SELECT array_agg(DISTINCT s ORDER BY s) FROM unnest(p_dest_squares) s) END)
      RETURNING id INTO v_dest_id;
    END IF;
  END IF;

  INSERT INTO inventory_logs (
    sku, from_warehouse, from_location, to_warehouse, to_location,
    quantity_change, previous_quantity, new_quantity, action_type,
    item_id, location_id, to_location_id, performed_by, user_id,
    snapshot_before, is_reversed, move_detail
  ) VALUES (
    v_src.sku, v_src.warehouse, v_src.location, v_src.warehouse, v_to_name,
    -p_qty, v_src.quantity, CASE WHEN v_same THEN v_src.quantity ELSE v_src.quantity - p_qty END, 'MOVE',
    v_src.id, v_from_loc_id, v_to_loc_id, p_performed_by, p_user_id,
    v_snapshot, false,
    COALESCE(p_detail, '{}'::jsonb) || jsonb_build_object(
      'dest_item_id', v_dest_id,
      'dest_snapshot_before', CASE WHEN v_same THEN NULL ELSE v_dest_snapshot END)
  ) RETURNING id INTO v_log_id;

  RETURN jsonb_build_object('success', true, 'log_id', v_log_id, 'id', v_src.id, 'dest_id', v_dest_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.move_stock_squares(bigint, jsonb, integer, jsonb, text, jsonb, jsonb, text[], jsonb, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.move_stock_squares(bigint, jsonb, integer, jsonb, text, jsonb, jsonb, text[], jsonb, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.undo_inventory_action(target_log_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_log inventory_logs%ROWTYPE;
  v_item_id BIGINT;
  v_move_qty INT;
  v_note TEXT;
  v_newer_exists BOOLEAN;
  v_dest_id BIGINT;
  v_dest JSONB;
BEGIN
  SELECT * INTO v_log FROM inventory_logs WHERE id = target_log_id FOR UPDATE;

  IF v_log IS NULL THEN RETURN jsonb_build_object('success', false, 'message', 'Log not found'); END IF;
  IF v_log.is_reversed THEN RETURN jsonb_build_object('success', false, 'message', 'Action already reversed'); END IF;

  -- A move by squares (move_stock_squares) saved both rows: put both back as
  -- they were, boxes and squares included, instead of subtracting.
  IF v_log.move_detail IS NOT NULL THEN
      v_item_id := v_log.item_id;
      v_dest_id := NULLIF(v_log.move_detail->>'dest_item_id', '')::bigint;
      IF EXISTS (
          SELECT 1 FROM inventory_logs
          WHERE item_id IN (v_item_id, v_dest_id)
            AND id != target_log_id
            AND is_reversed = false
            AND created_at > v_log.created_at
      ) THEN
          RETURN jsonb_build_object('success', false, 'message', 'Moved again after: undo that first.');
      END IF;

      UPDATE inventory SET
          quantity     = (v_log.snapshot_before->>'quantity')::int,
          is_active    = COALESCE((v_log.snapshot_before->>'is_active')::boolean, TRUE),
          distribution = COALESCE(v_log.snapshot_before->'distribution', '[]'::jsonb),
          sublocation  = CASE WHEN jsonb_typeof(v_log.snapshot_before->'sublocation') = 'array'
                              THEN ARRAY(SELECT jsonb_array_elements_text(v_log.snapshot_before->'sublocation'))
                              ELSE NULL END
      WHERE id = v_item_id;

      IF v_dest_id IS NOT NULL AND v_dest_id <> v_item_id THEN
          v_dest := v_log.move_detail->'dest_snapshot_before';
          IF v_dest IS NULL OR jsonb_typeof(v_dest) <> 'object' THEN
              UPDATE inventory SET quantity = 0, is_active = false, distribution = '[]'::jsonb, sublocation = NULL
              WHERE id = v_dest_id;
          ELSE
              UPDATE inventory SET
                  quantity     = (v_dest->>'quantity')::int,
                  is_active    = COALESCE((v_dest->>'is_active')::boolean, TRUE),
                  distribution = COALESCE(v_dest->'distribution', '[]'::jsonb),
                  sublocation  = CASE WHEN jsonb_typeof(v_dest->'sublocation') = 'array'
                                      THEN ARRAY(SELECT jsonb_array_elements_text(v_dest->'sublocation'))
                                      ELSE NULL END
              WHERE id = v_dest_id;
          END IF;
      END IF;

      UPDATE inventory_logs SET is_reversed = TRUE WHERE id = target_log_id;
      RETURN jsonb_build_object('success', true);
  END IF;

  v_item_id := COALESCE(
      v_log.item_id,
      (v_log.snapshot_before->>'id')::bigint,
      (v_log.snapshot_before->>'ID')::bigint
  );

  IF v_item_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'message', 'Could not identify ID to reverse');
  END IF;

  -- LIFO check: block if newer non-reversed actions exist for the same item
  SELECT EXISTS (
      SELECT 1 FROM inventory_logs
      WHERE item_id = v_item_id
        AND id != target_log_id
        AND is_reversed = false
        AND created_at > v_log.created_at
  ) INTO v_newer_exists;

  IF v_newer_exists THEN
      RETURN jsonb_build_object('success', false, 'message', 'LIFO Violation: newer actions exist for this item. Undo the most recent action first.');
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
          SET quantity = GREATEST(0, quantity - v_move_qty),
              -- Deactivate destination if it becomes empty after undo
              is_active = (GREATEST(0, quantity - v_move_qty) > 0)
          WHERE sku = v_log.sku
            AND warehouse = v_log.to_warehouse
            AND UPPER(location) = UPPER(v_log.to_location);
      END IF;

  ELSE
      -- ── Legacy path (no snapshot) ──────────────────────────────────────
      IF v_log.action_type = 'MOVE' THEN
          v_move_qty := ABS(v_log.quantity_change);

          -- Restore source: always reactivate (we're adding stock back)
          UPDATE inventory
          SET quantity = quantity + v_move_qty, is_active = true
          WHERE id = v_item_id;

          -- Deduct destination: deactivate if it becomes empty
          UPDATE inventory
          SET quantity = GREATEST(0, quantity - v_move_qty),
              is_active = (GREATEST(0, quantity - v_move_qty) > 0)
          WHERE sku = v_log.sku
            AND warehouse = v_log.to_warehouse
            AND UPPER(location) = UPPER(v_log.to_location);
      ELSE
          UPDATE inventory
          SET quantity = quantity - v_log.quantity_change,
              -- Bidirectional: deactivate if result is 0
              is_active = ((quantity - v_log.quantity_change) > 0)
          WHERE id = v_item_id;
      END IF;
  END IF;

  UPDATE inventory_logs SET is_reversed = TRUE WHERE id = target_log_id;
  RETURN jsonb_build_object('success', true);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$function$;

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
    -- p_merge_note = NULL: el nombre del origen no es una nota (20261005234857).
    p_performed_by, p_user_id, p_user_role, NULL, NULL, NULL, TRUE, v_resolved_note
  );

  -- The destination's squares are joined, never replaced (20261007130949):
  -- moving to H on a row in F,G used to leave {H}; a NULL wiped them all.
  UPDATE inventory
  SET sublocation = CASE
        WHEN v_resolved_sublocation IS NULL OR p_to_location IS NULL OR p_to_location NOT ILIKE 'ROW%'
          THEN CASE WHEN p_to_location ILIKE 'ROW%' THEN sublocation ELSE NULL END
        ELSE (SELECT array_agg(DISTINCT s ORDER BY s)
                FROM unnest(COALESCE(sublocation, '{}') || v_resolved_sublocation) s)
      END
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


COMMIT;
