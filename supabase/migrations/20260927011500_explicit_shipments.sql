-- ============================================================================
-- El envío como entidad: combinar y separar como acciones explícitas (PickD)
-- (26 sep 2026; docs/prds/shipments.md §9, backlog idea-230, bug-032, bug-045)
-- Migración unificada:
--   1. Retira el espejo de la fase 3 (trg_shipments_mirror_update, refresh_shipment...)
--   2. Trigger mínimo de watchdog en órdenes sueltas (carrier y dirección)
--   3. RPCs combine_into_shipment y split_from_shipment
--   4. Seis funciones de base de datos actualizadas para escribir en shipments:
--      process_picking_list, recomplete_picking_list, append_pallet_photo,
--      remove_pallet_photo, cancel_completed_order, quick_group_completed_orders
-- ============================================================================

-- ── 1) Retiro del espejo de Fase 3 ───────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_shipments_mirror_update ON public.picking_lists;
DROP TRIGGER IF EXISTS trg_shipments_mirror_delete ON public.picking_lists;
DROP FUNCTION IF EXISTS public.sync_picking_list_to_shipment();
DROP FUNCTION IF EXISTS public.sync_picking_list_delete_to_shipment();
DROP FUNCTION IF EXISTS public.refresh_shipment(uuid);

-- ── 2) Trigger mínimo para el Watchdog (orden que va sola en su envío) ────────

CREATE OR REPLACE FUNCTION public.sync_single_order_shipment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF NEW.shipment_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.picking_lists
  WHERE shipment_id = NEW.shipment_id;

  IF v_count = 1 THEN
    UPDATE public.shipments
    SET transport_company = NEW.transport_company,
        ship_to_address_id = NEW.ship_to_address_id,
        updated_at = now()
    WHERE id = NEW.shipment_id
      AND (
        transport_company IS DISTINCT FROM NEW.transport_company OR
        ship_to_address_id IS DISTINCT FROM NEW.ship_to_address_id
      );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_single_order_shipment ON public.picking_lists;
CREATE TRIGGER trg_sync_single_order_shipment
  AFTER UPDATE ON public.picking_lists
  FOR EACH ROW
  WHEN (
    OLD.transport_company IS DISTINCT FROM NEW.transport_company OR
    OLD.ship_to_address_id IS DISTINCT FROM NEW.ship_to_address_id
  )
  EXECUTE FUNCTION public.sync_single_order_shipment();

-- ── 3) RPCs combine_into_shipment y split_from_shipment ──────────────────────

-- ============================================================================
-- RPCs: combine_into_shipment y split_from_shipment (PickD)
-- El envío cambia sólo por combinar o separar explícitamente.
-- ============================================================================

-- ── 1) combine_into_shipment ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.combine_into_shipment(
  p_target_order_id uuid,
  p_source_order_ids uuid[],
  p_selected_address_id uuid DEFAULT NULL,
  p_selected_load_number text DEFAULT NULL,
  p_pallets_qty integer DEFAULT NULL,
  p_total_weight_lbs numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_target_pl record;
  v_target_shipment record;
  v_all_order_ids uuid[];
  v_distinct_customers integer;
  v_has_shipped boolean;
  v_has_unshipped boolean;
  v_distinct_addresses integer;
  v_distinct_loads integer;
  v_source_shipment_ids uuid[];
  v_merged_photos jsonb;
  v_final_address uuid;
  v_final_load text;
  v_final_pallets integer;
  v_final_weight numeric;
  v_all_open boolean := true;
  v_target_group_id uuid;
  v_new_group_id uuid;
  v_order_status text;
BEGIN
  -- Validaciones básicas
  IF p_target_order_id IS NULL THEN
    RAISE EXCEPTION 'Target order ID cannot be null' USING ERRCODE = 'P0001';
  END IF;

  IF p_source_order_ids IS NULL OR array_length(p_source_order_ids, 1) IS NULL OR array_length(p_source_order_ids, 1) = 0 THEN
    RAISE EXCEPTION 'Source order IDs cannot be empty' USING ERRCODE = 'P0001';
  END IF;

  IF p_target_order_id = ANY(p_source_order_ids) THEN
    RAISE EXCEPTION 'Target order cannot be included in source orders' USING ERRCODE = 'P0001';
  END IF;

  -- Obtener orden y envío destino
  SELECT * INTO v_target_pl FROM public.picking_lists WHERE id = p_target_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target order % not found', p_target_order_id USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_target_shipment FROM public.shipments WHERE id = v_target_pl.shipment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shipment for target order % not found', p_target_order_id USING ERRCODE = 'P0001';
  END IF;

  -- Array total
  v_all_order_ids := array_append(p_source_order_ids, p_target_order_id);

  -- 1. Validar mismo cliente
  SELECT count(DISTINCT customer_id) INTO v_distinct_customers
  FROM public.picking_lists
  WHERE id = ANY(v_all_order_ids);

  IF v_distinct_customers > 1 THEN
    RAISE EXCEPTION 'Cannot combine orders from different customers' USING ERRCODE = 'P0002';
  END IF;

  -- Obtener IDs de envíos fuente
  SELECT array_agg(DISTINCT shipment_id) INTO v_source_shipment_ids
  FROM public.picking_lists
  WHERE id = ANY(p_source_order_ids)
    AND shipment_id IS NOT NULL
    AND shipment_id <> v_target_pl.shipment_id;

  -- 2. Validar consistencia de is_shipped (entre el envío destino y los envíos fuente)
  SELECT 
    bool_or(is_shipped),
    bool_or(NOT is_shipped)
  INTO v_has_shipped, v_has_unshipped
  FROM public.shipments
  WHERE id = v_target_pl.shipment_id OR id = ANY(v_source_shipment_ids);

  IF v_has_shipped IS TRUE AND v_has_unshipped IS TRUE THEN
    RAISE EXCEPTION 'Cannot combine shipped and unshipped orders. Unmark shipped first.' USING ERRCODE = 'P0003';
  END IF;

  -- 3. Validar conflicto de direcciones
  SELECT count(DISTINCT ship_to_address_id) INTO v_distinct_addresses
  FROM public.picking_lists
  WHERE id = ANY(v_all_order_ids) AND ship_to_address_id IS NOT NULL;

  IF v_distinct_addresses > 1 AND p_selected_address_id IS NULL THEN
    RAISE EXCEPTION 'Address conflict: multiple distinct addresses found. Explicit selection required.' USING ERRCODE = 'P0004';
  END IF;

  -- 4. Validar conflicto de Load #
  SELECT count(DISTINCT load_number) INTO v_distinct_loads
  FROM public.shipments
  WHERE (id = v_target_pl.shipment_id OR id = ANY(v_source_shipment_ids))
    AND load_number IS NOT NULL
    AND trim(load_number) <> '';

  IF v_distinct_loads > 1 AND p_selected_load_number IS NULL THEN
    RAISE EXCEPTION 'Load number conflict: multiple distinct load numbers found. Explicit selection required.' USING ERRCODE = 'P0005';
  END IF;

  -- 5. Calcular fusión de fotos (sin duplicados, preservando orden)
  SELECT COALESCE(jsonb_agg(photo), '[]'::jsonb) INTO v_merged_photos
  FROM (
    SELECT DISTINCT ON (photo_elem) photo_elem as photo, min_ord
    FROM (
      SELECT jsonb_array_elements_text(pallet_photos) as photo_elem, ord as min_ord
      FROM (
        SELECT pallet_photos, 1 as ord FROM public.shipments WHERE id = v_target_pl.shipment_id
        UNION ALL
        SELECT pallet_photos, 2 as ord FROM public.shipments WHERE id = ANY(v_source_shipment_ids)
      ) photos_source
    ) expanded
    GROUP BY photo_elem, min_ord
    ORDER BY photo_elem, min_ord ASC
  ) merged;

  -- 6. Resolver dirección y load_number final
  v_final_address := COALESCE(
    p_selected_address_id,
    v_target_shipment.ship_to_address_id,
    (SELECT ship_to_address_id FROM public.picking_lists WHERE id = ANY(p_source_order_ids) AND ship_to_address_id IS NOT NULL LIMIT 1)
  );

  v_final_load := COALESCE(
    p_selected_load_number,
    v_target_shipment.load_number,
    (SELECT load_number FROM public.shipments WHERE id = ANY(v_source_shipment_ids) AND load_number IS NOT NULL LIMIT 1)
  );

  -- 7. Resolver pallets_qty y total_weight_lbs
  IF p_pallets_qty IS NOT NULL THEN
    v_final_pallets := p_pallets_qty;
  ELSE
    SELECT v_target_shipment.pallets_qty + COALESCE(sum(pallets_qty), 0)
    INTO v_final_pallets
    FROM public.shipments
    WHERE id = ANY(v_source_shipment_ids);
  END IF;

  IF p_total_weight_lbs IS NOT NULL THEN
    v_final_weight := p_total_weight_lbs;
  ELSE
    SELECT COALESCE(v_target_shipment.total_weight_lbs, 0) + COALESCE(sum(total_weight_lbs), 0)
    INTO v_final_weight
    FROM public.shipments
    WHERE id = ANY(v_source_shipment_ids);
  END IF;

  -- 7.5. Liberar load_number en envíos fuente antes de asignarlo al destino para evitar violación de UNIQUE constraint
  IF v_source_shipment_ids IS NOT NULL AND array_length(v_source_shipment_ids, 1) > 0 THEN
    UPDATE public.shipments
    SET load_number = NULL
    WHERE id = ANY(v_source_shipment_ids);
  END IF;

  -- 8. Actualizar el envío de destino
  UPDATE public.shipments
  SET ship_to_address_id = v_final_address,
      load_number = v_final_load,
      pallets_qty = v_final_pallets,
      total_weight_lbs = v_final_weight,
      pallet_dims = '[]'::jsonb,       -- REINICIO de medidas de tarimas
      pallet_photos = v_merged_photos, -- FUSIÓN de fotos
      updated_at = now()
  WHERE id = v_target_pl.shipment_id;

  -- 9. Mover las órdenes fuente al envío de destino
  UPDATE public.picking_lists
  SET shipment_id = v_target_pl.shipment_id
  WHERE id = ANY(p_source_order_ids);

  -- 10. Limpiar envíos fuente que quedaron sin órdenes
  IF v_source_shipment_ids IS NOT NULL AND array_length(v_source_shipment_ids, 1) > 0 THEN
    UPDATE public.shipments s
    SET load_number = NULL,  -- Libera el índice UNIQUE parcial
        pallets_qty = 0,
        total_weight_lbs = 0,
        pallet_dims = '[]'::jsonb,
        pallet_photos = '[]'::jsonb,
        updated_at = now()
    WHERE s.id = ANY(v_source_shipment_ids)
      AND NOT EXISTS (
        SELECT 1 FROM public.picking_lists pl WHERE pl.shipment_id = s.id
      );
  END IF;

  -- 11. Manejo de group_id (lote de picking):
  -- Si todas las órdenes están en estado abierto de picking, se asocian al mismo group_id
  FOR v_order_status IN 
    SELECT status FROM public.picking_lists WHERE id = ANY(v_all_order_ids)
  LOOP
    IF v_order_status IN ('completed', 'cancelled') THEN
      v_all_open := false;
      EXIT;
    END IF;
  END LOOP;

  IF v_all_open THEN
    v_target_group_id := v_target_pl.group_id;
    IF v_target_group_id IS NULL THEN
      -- Crear nuevo lote de picking
      INSERT INTO public.order_groups (group_type)
      VALUES ('general')
      RETURNING id INTO v_new_group_id;

      UPDATE public.picking_lists
      SET group_id = v_new_group_id
      WHERE id = ANY(v_all_order_ids);
    ELSE
      -- Sumar órdenes al grupo existente
      UPDATE public.picking_lists
      SET group_id = v_target_group_id
      WHERE id = ANY(p_source_order_ids);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'target_shipment_id', v_target_pl.shipment_id,
    'combined_orders', v_all_order_ids,
    'pallets_qty', v_final_pallets,
    'total_weight_lbs', v_final_weight,
    'load_number', v_final_load,
    'ship_to_address_id', v_final_address
  );
END;
$$;

-- ── 2) split_from_shipment ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.split_from_shipment(
  p_order_id uuid,
  p_target_pallets_qty integer DEFAULT NULL,
  p_target_weight numeric DEFAULT NULL,
  p_new_pallets_qty integer DEFAULT NULL,
  p_new_weight numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_order record;
  v_current_shipment record;
  v_siblings_count integer;
  v_new_shipment_id uuid;
  v_remaining_pallets integer;
  v_remaining_weight numeric;
  v_remaining_group_members integer;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'Order ID cannot be null' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_order FROM public.picking_lists WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % not found', p_order_id USING ERRCODE = 'P0001';
  END IF;

  IF v_order.shipment_id IS NULL THEN
    RAISE EXCEPTION 'Order % has no shipment_id', p_order_id USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_current_shipment FROM public.shipments WHERE id = v_order.shipment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shipment % not found', v_order.shipment_id USING ERRCODE = 'P0001';
  END IF;

  -- 1. Validar que la orden pertenezca a un envío compartido (más de 1 orden)
  SELECT count(*) INTO v_siblings_count
  FROM public.picking_lists
  WHERE shipment_id = v_order.shipment_id;

  IF v_siblings_count <= 1 THEN
    RAISE EXCEPTION 'Order is already in a single-order shipment' USING ERRCODE = 'P0006';
  END IF;

  -- 2. Validar que el envío NO esté marcado como enviado (Rafael, 26 sep 2026: se desmarca antes de separar)
  IF v_current_shipment.is_shipped IS TRUE OR v_order.is_shipped IS TRUE THEN
    RAISE EXCEPTION 'Cannot split a shipped shipment. Unmark shipped first.' USING ERRCODE = 'P0007';
  END IF;

  -- 3. Crear el nuevo envío propio para la orden que sale
  INSERT INTO public.shipments (
    customer_id,
    ship_to_address_id,
    transport_company,
    load_number,
    pallets_qty,
    total_weight_lbs,
    pallet_dims,
    pallet_photos,
    is_shipped,
    shipped_at
  ) VALUES (
    v_order.customer_id,
    v_order.ship_to_address_id,          -- Recupera su propia dirección original
    v_current_shipment.transport_company, -- Hereda transportista
    NULL,                                -- Load # nace en NULL (nuevo BOL)
    COALESCE(p_new_pallets_qty, 0),      -- Tarimas recalculadas para la saliente
    p_new_weight,
    '[]'::jsonb,                         -- Medidas vacías (estimación en gris)
    '[]'::jsonb,                         -- PRD §4: nace limpio sin fotos
    false,
    NULL
  ) RETURNING id INTO v_new_shipment_id;

  -- 4. Asignar el nuevo envío a la orden
  UPDATE public.picking_lists
  SET shipment_id = v_new_shipment_id
  WHERE id = p_order_id;

  -- 5. Recalcular y actualizar el envío remanente
  v_remaining_pallets := COALESCE(
    p_target_pallets_qty,
    GREATEST(0, v_current_shipment.pallets_qty - COALESCE(p_new_pallets_qty, 0))
  );

  v_remaining_weight := COALESCE(
    p_target_weight,
    GREATEST(0, COALESCE(v_current_shipment.total_weight_lbs, 0) - COALESCE(p_new_weight, 0))
  );

  UPDATE public.shipments
  SET pallets_qty = v_remaining_pallets,
      total_weight_lbs = v_remaining_weight,
      pallet_dims = '[]'::jsonb,  -- REINICIO de medidas del envío remanente
      updated_at = now()
  WHERE id = v_current_shipment.id;

  -- 6. Manejo de group_id (lote de picking):
  -- Si estaba en picking abierto, sacarla del lote
  IF v_order.status NOT IN ('completed', 'cancelled') AND v_order.group_id IS NOT NULL THEN
    UPDATE public.picking_lists SET group_id = NULL WHERE id = p_order_id;

    -- Si en el grupo original sólo queda 1 orden, disolver el grupo de trabajo
    SELECT count(*) INTO v_remaining_group_members
    FROM public.picking_lists
    WHERE group_id = v_order.group_id;

    IF v_remaining_group_members <= 1 THEN
      UPDATE public.picking_lists SET group_id = NULL WHERE group_id = v_order.group_id;
      DELETE FROM public.order_groups WHERE id = v_order.group_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'original_shipment_id', v_current_shipment.id,
    'new_shipment_id', v_new_shipment_id,
    'remaining_pallets', v_remaining_pallets,
    'new_pallets', COALESCE(p_new_pallets_qty, 0)
  );
END;
$$;


GRANT EXECUTE ON FUNCTION public.combine_into_shipment(uuid, uuid[], uuid, text, integer, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.split_from_shipment(uuid, integer, numeric, integer, numeric) TO authenticated, service_role;

-- ── 4) Seis funciones de base actualizadas para escribir en shipments ────────

-- 4.1 append_pallet_photo
CREATE OR REPLACE FUNCTION public.append_pallet_photo(p_list_id uuid, p_url text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_shipment_id uuid;
  v_photos jsonb;
BEGIN
  SELECT shipment_id INTO v_shipment_id FROM public.picking_lists WHERE id = p_list_id;
  IF v_shipment_id IS NOT NULL THEN
    UPDATE public.shipments
       SET pallet_photos = CASE
             WHEN coalesce(pallet_photos, '[]'::jsonb) ? p_url THEN pallet_photos
             ELSE coalesce(pallet_photos, '[]'::jsonb) || jsonb_build_array(p_url)
           END,
           updated_at = now()
     WHERE id = v_shipment_id
    RETURNING pallet_photos INTO v_photos;
  ELSE
    UPDATE public.picking_lists
       SET pallet_photos = CASE
             WHEN coalesce(pallet_photos, '[]'::jsonb) ? p_url THEN pallet_photos
             ELSE coalesce(pallet_photos, '[]'::jsonb) || jsonb_build_array(p_url)
           END
     WHERE id = p_list_id
    RETURNING pallet_photos INTO v_photos;
  END IF;

  RETURN v_photos;
END;
$$;

REVOKE ALL ON FUNCTION public.append_pallet_photo(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.append_pallet_photo(uuid, text) TO authenticated, service_role;

-- 4.2 remove_pallet_photo
CREATE OR REPLACE FUNCTION public.remove_pallet_photo(p_list_id uuid, p_url text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_shipment_id uuid;
  v_photos jsonb;
BEGIN
  SELECT shipment_id INTO v_shipment_id FROM public.picking_lists WHERE id = p_list_id;
  IF v_shipment_id IS NOT NULL THEN
    UPDATE public.shipments
       SET pallet_photos = coalesce(pallet_photos, '[]'::jsonb) - p_url,
           updated_at = now()
     WHERE id = v_shipment_id
    RETURNING pallet_photos INTO v_photos;
  ELSE
    UPDATE public.picking_lists
       SET pallet_photos = coalesce(pallet_photos, '[]'::jsonb) - p_url
     WHERE id = p_list_id
    RETURNING pallet_photos INTO v_photos;
  END IF;

  RETURN v_photos;
END;
$$;

REVOKE ALL ON FUNCTION public.remove_pallet_photo(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_pallet_photo(uuid, text) TO authenticated, service_role;

-- 4.3 process_picking_list
CREATE OR REPLACE FUNCTION public.process_picking_list(p_list_id uuid, p_performed_by text, p_user_id uuid DEFAULT NULL::uuid, p_pallets_qty integer DEFAULT NULL::integer, p_total_units integer DEFAULT NULL::integer, p_user_role text DEFAULT 'staff'::text)
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

  -- El snapshot manda, no el estado. Una orden que lo conserva ya descontó lo
  -- suyo una vez: aquí se aplica la DIFERENCIA contra esa foto, nunca un
  -- descuento nuevo. Sin esto, cualquier camino que le quite el estado
  -- ''reopened'' —un barrido de grupo, un take-over— la hacía descontar dos
  -- veces en silencio (7 órdenes, 35 unidades hasta el 17 sep 2026).
  IF v_list.completed_snapshot IS NOT NULL THEN
    PERFORM public.recomplete_picking_list(
      p_list_id, p_performed_by, p_user_id, p_pallets_qty, p_total_units, p_user_role
    );
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

  IF p_pallets_qty IS NOT NULL AND v_list.shipment_id IS NOT NULL THEN
    UPDATE public.shipments SET pallets_qty = p_pallets_qty, updated_at = NOW() WHERE id = v_list.shipment_id;
  END IF;

  UPDATE picking_lists SET
    status = 'completed',
    pallets_qty = COALESCE(p_pallets_qty, pallets_qty),
    total_units = COALESCE(p_total_units, total_units),
    updated_at = NOW(),
    checked_by = p_user_id
  WHERE id = p_list_id;

  RETURN TRUE;
END;
$function$
;

-- 4.4 recomplete_picking_list
CREATE OR REPLACE FUNCTION public.recomplete_picking_list(p_list_id uuid, p_performed_by text, p_user_id uuid, p_pallets_qty integer DEFAULT NULL::integer, p_total_units integer DEFAULT NULL::integer, p_user_role text DEFAULT 'staff'::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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

  -- Terminal: no hay nada que re-completar.
  IF v_list.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Cannot recomplete: status is %, expected an open order with a snapshot', v_list.status;
  END IF;

  IF v_list.completed_snapshot IS NULL THEN
    RAISE EXCEPTION 'No snapshot found for order % (status %)', p_list_id, v_list.status;
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
  IF p_pallets_qty IS NOT NULL AND v_list.shipment_id IS NOT NULL THEN
    UPDATE public.shipments SET pallets_qty = p_pallets_qty, updated_at = NOW() WHERE id = v_list.shipment_id;
  END IF;

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
$function$
;

-- 4.5 cancel_completed_order
CREATE OR REPLACE FUNCTION public.cancel_completed_order(p_list_id uuid, p_user_id uuid, p_unship boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_list RECORD;
  v_log RECORD;
  v_units integer;
  v_total_restored integer := 0;
  v_lines_restored integer := 0;
  v_was_reopened boolean := false;
  v_was_shipped boolean := false;
  v_remaining_in_group integer;
  v_orphan uuid;
BEGIN
  SELECT * INTO v_list FROM picking_lists
  WHERE id = p_list_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Picking list % not found', p_list_id;
  END IF;

  -- Idempotencia: ya cancelada => no-op.
  IF v_list.status = 'cancelled' THEN
    RETURN jsonb_build_object(
      'restored_units', 0,
      'items_restored', 0,
      'status', 'cancelled',
      'was_reopened', false,
      'was_shipped', false,
      'requires_unship', false,
      'location', NULL,
      'already_cancelled', true
    );
  END IF;

  -- Solo completed y reopened pasan por aquí. Los estados activos tienen su
  -- propio camino en el trigger, y ese sí devuelve a la ubicación original.
  IF v_list.status NOT IN ('completed', 'reopened') THEN
    RAISE EXCEPTION
      'cancel_completed_order only valid for completed/reopened orders, got %',
      v_list.status;
  END IF;

  v_was_shipped := COALESCE((SELECT is_shipped FROM public.shipments WHERE id = v_list.shipment_id), v_list.is_shipped, false);
  IF v_was_shipped AND NOT p_unship THEN
    RETURN jsonb_build_object(
      'restored_units', 0,
      'items_restored', 0,
      'status', v_list.status,
      'was_reopened', false,
      'was_shipped', true,
      'requires_unship', true,
      'location', NULL,
      'already_cancelled', false
    );
  END IF;
  v_was_shipped := COALESCE(v_list.is_shipped, false);

  -- Si está reopened, primero se pliega al estado previo al reopen. Eso revierte
  -- las escrituras de inventario de esa ventana a sus propias ubicaciones, que
  -- es lo correcto: esas ediciones sí pasaron en el piso.
  IF v_list.status = 'reopened' THEN
    v_was_reopened := true;
    PERFORM public.cancel_reopen(p_list_id, p_user_id);
    SELECT * INTO v_list FROM picking_lists WHERE id = p_list_id FOR UPDATE;
  END IF;

  -- Lo que la lista descontó de verdad, en reversa y hacia CANCELLED PALLET.
  --
  -- Dos descuentos que NO son un pick de un estante y no se replican:
  --   · `auto-zero out-of-stock` significa "el estante estaba vacío" — no hay
  --     nada en el pallet que traer de vuelta;
  --   · `cancel-undone` es el descuento que hace el propio deshacer al sacar
  --     las unidades de CANCELLED PALLET. Contarlo sería devolver dos veces lo
  --     que salió una: 881420 (17 sep 2026) habría acreditado 22 unidades de 11.
  FOR v_log IN
    SELECT l.id,
           l.sku,
           COALESCE(l.to_warehouse, l.from_warehouse, 'LUDLOW') AS warehouse,
           l.quantity_change
    FROM inventory_logs l
    WHERE l.list_id = p_list_id
      AND l.action_type = 'DEDUCT'
      AND COALESCE(l.is_reversed, false) = false
      AND l.quantity_change < 0
      AND COALESCE(l.performed_by, '') NOT LIKE 'system: auto-zero%'
      AND COALESCE(l.performed_by, '') NOT LIKE 'system: cancel-undone%'
    ORDER BY l.created_at DESC
    FOR UPDATE
  LOOP
    v_units := -v_log.quantity_change;

    PERFORM public.adjust_inventory_quantity(
      p_sku          := v_log.sku,
      p_warehouse    := v_log.warehouse,
      p_location     := 'CANCELLED PALLET',
      p_delta        := v_units,
      p_performed_by := 'system: order-cancelled',
      p_user_id      := p_user_id,
      p_list_id      := p_list_id,
      p_order_number := v_list.order_number,
      -- Sin merge_note a propósito: CANCELLED PALLET recibe unidades de muchas
      -- órdenes y la nota se iría concatenando en la fila de inventario. El
      -- porqué de cada unidad vive en su log, con número de orden y autor.
      p_merge_note   := NULL
    );

    UPDATE inventory_logs SET is_reversed = true WHERE id = v_log.id;

    v_total_restored := v_total_restored + v_units;
    v_lines_restored := v_lines_restored + 1;
  END LOOP;

  -- El campo `notes` es la nota de AS400 que se imprime en el pallet; la
  -- historia de la orden va a `picking_list_notes`, que es donde se lee.
  IF p_unship AND v_list.shipment_id IS NOT NULL THEN
    UPDATE public.shipments SET is_shipped = false, shipped_at = NULL, updated_at = NOW() WHERE id = v_list.shipment_id;
  END IF;

  UPDATE picking_lists SET
    status           = 'cancelled',
    is_shipped       = CASE WHEN p_unship THEN false ELSE is_shipped END,
    updated_at       = NOW(),
    last_activity_at = NOW()
  WHERE id = p_list_id;

  INSERT INTO picking_list_notes (list_id, user_id, message)
  VALUES (
    p_list_id, p_user_id,
    '[Cancelled]: ' ||
    CASE
      WHEN v_total_restored > 0 THEN
        v_total_restored::text || ' units returned to CANCELLED PALLET across ' ||
        v_lines_restored::text || ' line(s).'
      ELSE
        'Nothing had been deducted, so no units were returned.'
    END ||
    CASE WHEN v_was_reopened THEN ' Reopen was cancelled first.' ELSE '' END ||
    CASE WHEN p_unship AND v_was_shipped THEN ' Order was un-marked as shipped.' ELSE '' END
  );

  -- Limpieza de grupo: si era la última orden viva del grupo, se disuelve.
  --
  -- Fila por fila, no en un UPDATE de varias: `reevaluate_shipping_type_on_ungroup`
  -- es un BEFORE trigger que escribe sobre las demás filas del grupo, y cuando
  -- esas filas están en el mismo comando Postgres aborta con 27000. Pasaba con
  -- cualquier grupo que tuviera una orden ya cancelada y una sola viva — o sea,
  -- justo después de la primera cancelación.
  IF v_list.group_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_remaining_in_group
    FROM picking_lists
    WHERE group_id = v_list.group_id
      AND status NOT IN ('cancelled')
      AND id != p_list_id;

    IF v_remaining_in_group <= 1 THEN
      PERFORM set_config('pickd.ungroup_reason', 'cancel', true);
      FOR v_orphan IN
        SELECT id FROM picking_lists
        WHERE group_id = v_list.group_id AND id != p_list_id
      LOOP
        UPDATE picking_lists SET group_id = NULL WHERE id = v_orphan;
      END LOOP;
      PERFORM set_config('pickd.ungroup_reason', '', true);

      DELETE FROM order_groups WHERE id = v_list.group_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'restored_units', v_total_restored,
    'items_restored', v_lines_restored,
    'status', 'cancelled',
    'was_reopened', v_was_reopened,
    'was_shipped', v_was_shipped,
    'requires_unship', false,
    'location', 'CANCELLED PALLET',
    'already_cancelled', false
  );
END;
$function$
;

-- 4.6 quick_group_completed_orders
CREATE OR REPLACE FUNCTION public.quick_group_completed_orders(p_list_ids uuid[], p_location text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_group_id UUID;
  v_caller_id UUID;
  v_count INT;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF array_length(p_list_ids, 1) < 2 THEN
    RAISE EXCEPTION 'quick_group_completed_orders: at least 2 orders required';
  END IF;

  -- Verify all orders are completed and owned by same customer
  SELECT COUNT(*) INTO v_count
  FROM public.picking_lists
  WHERE id = ANY(p_list_ids)
    AND status = 'completed'
    AND COALESCE((SELECT is_shipped FROM public.shipments WHERE id = picking_lists.shipment_id), picking_lists.is_shipped, false) = false;

  IF v_count <> array_length(p_list_ids, 1) THEN
    RAISE EXCEPTION 'quick_group_completed_orders: all orders must be completed and not shipped';
  END IF;

  -- Create group
  INSERT INTO public.order_groups (group_type)
  VALUES ('pickup')
  RETURNING id INTO v_group_id;

  -- Assign all orders to group
  UPDATE public.picking_lists
  SET group_id = v_group_id, updated_at = now()
  WHERE id = ANY(p_list_ids);

  -- Add parked location notes for each order
  INSERT INTO public.picking_list_notes (list_id, user_id, message)
  SELECT id, v_caller_id, '[Parked]: ' || p_location
  FROM public.picking_lists
  WHERE id = ANY(p_list_ids);

  RETURN json_build_object(
    'success', true,
    'group_id', v_group_id,
    'orders_grouped', array_length(p_list_ids, 1)
  );
END;
$function$
;
