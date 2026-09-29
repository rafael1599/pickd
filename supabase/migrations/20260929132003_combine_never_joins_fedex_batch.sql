-- combine_into_shipment: una combinada abierta nunca queda dentro de un lote FedEx.
--
-- Antes, si la orden destino estaba en un lote FedEx (auto_group_fedex_orders),
-- las fuentes se sumaban a ese lote. El board sólo junta y cuenta como una los
-- grupos deliberados (general/pickup), así que la combinada salía como órdenes
-- sueltas en la tarjeta y en los totales. Ahora el destino tiene que ser un grupo
-- deliberado; si no lo es, se crea uno general y todas salen del lote.
-- Sólo cambia el paso 11; el resto es la función de prod tal cual.

CREATE OR REPLACE FUNCTION public.combine_into_shipment(p_target_order_id uuid, p_source_order_ids uuid[], p_selected_address_id uuid DEFAULT NULL::uuid, p_selected_load_number text DEFAULT NULL::text, p_pallets_qty integer DEFAULT NULL::integer, p_total_weight_lbs numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
  v_move_id uuid;
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
  -- Si todas las órdenes están abiertas, comparten un grupo deliberado
  -- (general/pickup), que es lo que el board junta en una tarjeta y cuenta una
  -- vez. Un lote FedEx no sirve de destino: son clientes distintos juntados para
  -- trabajar, y sumar ahí las fuentes dejaba la combinada contada y pintada como
  -- órdenes sueltas (29 sep 2026). Se crea un grupo general y salen del lote.
  FOR v_order_status IN
    SELECT status FROM public.picking_lists WHERE id = ANY(v_all_order_ids)
  LOOP
    IF v_order_status IN ('completed', 'cancelled') THEN
      v_all_open := false;
      EXIT;
    END IF;
  END LOOP;

  IF v_all_open THEN
    SELECT og.id INTO v_target_group_id
    FROM public.order_groups og
    WHERE og.id = v_target_pl.group_id
      AND og.group_type IN ('general', 'pickup');

    IF v_target_group_id IS NULL THEN
      INSERT INTO public.order_groups (group_type)
      VALUES ('general')
      RETURNING id INTO v_target_group_id;
    END IF;

    -- Fila por fila: reevaluate_shipping_type_on_ungroup es BEFORE y escribe
    -- sobre las otras filas del grupo que se deja; un UPDATE de varias filas del
    -- mismo lote revienta con 27000 (lo mismo que cancel_completed_order).
    FOR v_move_id IN
      SELECT id FROM public.picking_lists
      WHERE id = ANY(v_all_order_ids)
        AND group_id IS DISTINCT FROM v_target_group_id
    LOOP
      UPDATE public.picking_lists SET group_id = v_target_group_id WHERE id = v_move_id;
    END LOOP;
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
$function$;
