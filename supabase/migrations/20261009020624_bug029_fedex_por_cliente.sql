-- ============================================================================
-- bug-029: Regla de >= 5 bicis por cliente y direccion en lotes FedEx
--
-- 1. Columna aditiva: picking_lists.shipping_type_manual boolean default false.
--    Candado manual para que ni triggers ni cliente sobreescriban la decisión
--    manual tomada en ShippingTypeToggle o useOrderSplit.
-- 2. auto_group_fedex_orders():
--    - Llave canónica: (customer_id, ship_to_address_id IS NOT DISTINCT FROM)
--      con customer_id NOT NULL.
--    - La suma de 5 clientes x 1 bici nunca cambia nada.
--    - >= 5 bicis de un mismo cliente/dirección dentro de un lote FedEx ->
--      esas órdenes pasan a 'regular', salen del lote FedEx y, si son >= 2,
--      forman su propio grupo 'general' y un solo envío (combine_into_shipment).
--    - Una sola orden >= 5 bicis -> 'regular', sin grupo (group_id = NULL).
--    - Si el grupo FedEx está tomado (group_is_held), el shipping_type cambia
--      igual a 'regular', pero no se mueve nada de grupo (como hoy).
--    - Si combine_into_shipment fallaría (load # o carrier distintos, P0004/P0005),
--      se forma el grupo 'general' pero no se fusiona el envío — nunca se
--      aborta la inserción de la orden.
--    - Candado manual: órdenes con shipping_type_manual = true nunca son
--      modificadas por la regla automática.
-- 3. reevaluate_shipping_type_on_ungroup():
--    - Respeta shipping_type_manual = true.
--    - No reevalúa lotes de tipo 'fedex' sumando entre clientes distintos.
-- ============================================================================

-- 1. Columna aditiva shipping_type_manual
ALTER TABLE public.picking_lists
  ADD COLUMN IF NOT EXISTS shipping_type_manual boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.picking_lists.shipping_type_manual IS
  'Candado manual para shipping_type (bug-029). Puesto en true por ShippingTypeToggle o useOrderSplit. Ninguna regla automática (trigger o cliente) altera shipping_type ni group_id si es true.';

-- 2. Función auto_group_fedex_orders reescrita
CREATE OR REPLACE FUNCTION public.auto_group_fedex_orders()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path = public
AS $function$
DECLARE
  v_is_fedex boolean;
  v_sibling_id uuid;
  v_sibling_group uuid;
  v_new_group uuid;
  v_total_bikes integer;
  v_new_bikes integer;
  v_transport text;
  v_movable_sibling_ids uuid[];
  v_general_group_id uuid;
  v_target_sibling_id uuid;
  v_source_order_ids uuid[];
  v_combine_failed boolean := false;
  v_target_shipment_id uuid;
  v_target_load text;
  v_target_addr uuid;
  v_target_transport text;
  v_target_shipped boolean;
BEGIN
  -- Candado manual: si NEW viene con shipping_type_manual en true,
  -- ninguna regla automática cambia su shipping_type ni su group_id.
  IF NEW.shipping_type_manual IS TRUE THEN
    RETURN NEW;
  END IF;

  -- Skip if order already has a group
  IF NEW.group_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Skip if NEW itself is waiting for inventory
  IF NEW.is_waiting_inventory IS TRUE THEN
    RETURN NEW;
  END IF;

  -- Skip combined orders
  IF NEW.order_number IS NOT NULL AND position(' / ' in NEW.order_number) > 0 THEN
    RETURN NEW;
  END IF;

  -- Asegurar NEW.id no nulo para operaciones de comparación
  IF NEW.id IS NULL THEN
    NEW.id := gen_random_uuid();
  END IF;

  v_transport := UPPER(TRIM(COALESCE(NEW.transport_company, '')));

  -- Determine if this order is fedex initially
  IF v_transport = 'FEDEX' THEN
    v_is_fedex := true;
  ELSIF v_transport != '' THEN
    v_is_fedex := false;
  ELSIF NEW.shipping_type = 'fedex' THEN
    v_is_fedex := true;
  ELSIF NEW.shipping_type = 'regular' THEN
    v_is_fedex := false;
  ELSE
    v_is_fedex := classify_picking_list_fedex(NEW.items, NEW.transport_company);
  END IF;

  -- Rule: >= 5 BIKES for the SAME customer & address -> convert to REGULAR
  SELECT COALESCE(SUM((item->>'pickingQty')::numeric), 0)::integer INTO v_new_bikes
  FROM jsonb_array_elements(COALESCE(NEW.items, '[]'::jsonb)) AS item
  LEFT JOIN sku_metadata sm ON sm.sku = item->>'sku'
  WHERE sm.is_bike = true;

  IF NEW.customer_id IS NOT NULL THEN
    -- Count ALL open bikes for this customer and address (FedEx or Regular)
    SELECT COALESCE(SUM((item->>'pickingQty')::numeric), 0)::integer INTO v_total_bikes
    FROM picking_lists pl
    CROSS JOIN jsonb_array_elements(COALESCE(pl.items, '[]'::jsonb)) AS item
    LEFT JOIN sku_metadata sm ON sm.sku = item->>'sku'
    WHERE pl.customer_id = NEW.customer_id
      AND pl.ship_to_address_id IS NOT DISTINCT FROM NEW.ship_to_address_id
      AND pl.id != NEW.id
      AND pl.status NOT IN ('completed', 'cancelled')
      AND pl.is_waiting_inventory IS NOT TRUE
      AND sm.is_bike = true;

    IF (v_new_bikes + v_total_bikes) >= 5 THEN
      NEW.shipping_type := 'regular';
      v_is_fedex := false;

      -- 1. Actualizar órdenes abiertas del cliente en grupos TOMADOS (group_is_held):
      -- El shipping_type cambia siempre; el group_id NO se mueve para no romper la verificación en curso.
      -- Respeta candado manual (shipping_type_manual IS NOT TRUE).
      UPDATE picking_lists
      SET shipping_type = 'regular'
      WHERE customer_id = NEW.customer_id
        AND ship_to_address_id IS NOT DISTINCT FROM NEW.ship_to_address_id
        AND id != NEW.id
        AND status NOT IN ('completed', 'cancelled')
        AND is_waiting_inventory IS NOT TRUE
        AND shipping_type_manual IS NOT TRUE
        AND public.group_is_held(group_id);

      -- 2. Identificar órdenes hermanas abiertas que NO están en un grupo tomado
      -- y NO tienen candado manual (son libres de moverse).
      SELECT COALESCE(array_agg(pl.id ORDER BY pl.created_at ASC), '{}'::uuid[])
      INTO v_movable_sibling_ids
      FROM picking_lists pl
      WHERE pl.customer_id = NEW.customer_id
        AND pl.ship_to_address_id IS NOT DISTINCT FROM NEW.ship_to_address_id
        AND pl.id != NEW.id
        AND pl.status NOT IN ('completed', 'cancelled')
        AND pl.is_waiting_inventory IS NOT TRUE
        AND pl.shipping_type_manual IS NOT TRUE
        AND NOT public.group_is_held(pl.group_id);

      -- Si son >= 2 órdenes en total (hermanas movibles + NEW), forman grupo 'general'
      -- y se unifica el envío (combine_into_shipment).
      -- Si es 1 sola orden (NEW sin hermanas movibles): regular sin grupo.
      IF array_length(v_movable_sibling_ids, 1) IS NOT NULL AND array_length(v_movable_sibling_ids, 1) >= 1 THEN
        -- Buscar si alguna hermana ya pertenece a un grupo general
        SELECT og.id INTO v_general_group_id
        FROM picking_lists pl
        JOIN order_groups og ON og.id = pl.group_id
        WHERE pl.id = ANY(v_movable_sibling_ids)
          AND og.group_type = 'general'
        LIMIT 1;

        IF v_general_group_id IS NULL THEN
          INSERT INTO public.order_groups (group_type)
          VALUES ('general')
          RETURNING id INTO v_general_group_id;
        END IF;

        -- Asignar las hermanas al grupo general fila por fila (para evitar error 27000
        -- con reevaluate_shipping_type_on_ungroup)
        FOR v_sibling_id IN SELECT unnest(v_movable_sibling_ids)
        LOOP
          UPDATE public.picking_lists
          SET shipping_type = 'regular',
              group_id = v_general_group_id
          WHERE id = v_sibling_id;
        END LOOP;

        NEW.group_id := v_general_group_id;

        -- Intentar combinar los envíos físicos (combine_into_shipment):
        -- La ancla es la hermana movible más antigua:
        v_target_sibling_id := v_movable_sibling_ids[1];

        -- Si hay 2 o más hermanas movibles ya en picking_lists, unificarlas con combine_into_shipment
        IF array_length(v_movable_sibling_ids, 1) >= 2 THEN
          v_source_order_ids := v_movable_sibling_ids[2:array_length(v_movable_sibling_ids, 1)];
          BEGIN
            PERFORM public.combine_into_shipment(v_target_sibling_id, v_source_order_ids);
          EXCEPTION
            WHEN OTHERS THEN
              v_combine_failed := true;
          END;
        END IF;

        -- Ahora vincular NEW al shipment unificado de v_target_sibling_id,
        -- validando que no haya conflictos de load_number, dirección o carrier.
        IF NOT v_combine_failed THEN
          SELECT pl.shipment_id, s.load_number, s.ship_to_address_id, s.transport_company, s.is_shipped
          INTO v_target_shipment_id, v_target_load, v_target_addr, v_target_transport, v_target_shipped
          FROM public.picking_lists pl
          JOIN public.shipments s ON s.id = pl.shipment_id
          WHERE pl.id = v_target_sibling_id;

          IF v_target_shipment_id IS NOT NULL AND v_target_shipped IS NOT TRUE THEN
            -- Chequeo de conflicto de dirección (P0004)
            IF NEW.ship_to_address_id IS NOT DISTINCT FROM v_target_addr THEN
              -- Chequeo de conflicto de Load # (P0005)
              IF NOT (
                v_target_load IS NOT NULL AND TRIM(v_target_load) <> ''
                AND NEW.load_number IS NOT NULL AND TRIM(NEW.load_number) <> ''
                AND TRIM(NEW.load_number) <> TRIM(v_target_load)
              ) THEN
                -- Chequeo de carrier
                IF NOT (
                  UPPER(TRIM(COALESCE(NEW.transport_company, ''))) <> ''
                  AND UPPER(TRIM(COALESCE(v_target_transport, ''))) <> ''
                  AND UPPER(TRIM(NEW.transport_company)) <> UPPER(TRIM(v_target_transport))
                ) THEN
                  -- Sin conflictos: NEW comparte el shipment de destino
                  NEW.shipment_id := v_target_shipment_id;

                  -- Actualizar agregados del shipment
                  UPDATE public.shipments
                  SET pallets_qty = pallets_qty + COALESCE(NEW.pallets_qty, 0),
                      total_weight_lbs = COALESCE(total_weight_lbs, 0) + COALESCE(NEW.total_weight_lbs, 0),
                      pallet_dims = '[]'::jsonb,
                      load_number = COALESCE(v_target_load, NEW.load_number),
                      transport_company = COALESCE(v_target_transport, NEW.transport_company),
                      updated_at = now()
                  WHERE id = v_target_shipment_id;
                END IF;
              END IF;
            END IF;
          END IF;
        END IF;

      ELSE
        -- 1 sola orden (NEW): regular sin grupo
        NEW.group_id := NULL;
      END IF;
    END IF;
  END IF;

  -- Si termina siendo regular (o no es fedex y no se convirtió), retorna sin agrupar en fedex
  IF NOT v_is_fedex THEN
    RETURN NEW;
  END IF;

  -- Operational grouping for FedEx: the sibling must be at rest, and so must
  -- its group (20260909233836).
  SELECT pl.id, pl.group_id INTO v_sibling_id, v_sibling_group
  FROM picking_lists pl
  WHERE pl.id != NEW.id
    AND pl.status NOT IN ('completed', 'cancelled', 'reopened')
    AND pl.is_waiting_inventory IS NOT TRUE
    AND (pl.order_number IS NULL OR position(' / ' in pl.order_number) = 0)
    AND (
      pl.shipping_type = 'fedex'
      OR (pl.shipping_type IS NULL AND classify_picking_list_fedex(pl.items, pl.transport_company))
    )
    AND pl.checked_by IS NULL
    AND pl.status <> 'double_checking'
    AND COALESCE(jsonb_array_length(COALESCE(pl.verified_item_keys, '[]'::jsonb)), 0) = 0
    AND NOT public.group_is_held(pl.group_id)
  ORDER BY pl.created_at ASC
  LIMIT 1;

  IF v_sibling_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_sibling_group IS NOT NULL THEN
    NEW.group_id := v_sibling_group;
  ELSE
    INSERT INTO order_groups (group_type) VALUES ('fedex') RETURNING id INTO v_new_group;
    UPDATE picking_lists SET group_id = v_new_group WHERE id = v_sibling_id;
    NEW.group_id := v_new_group;
  END IF;

  RETURN NEW;
END;
$function$;

-- 3. Actualizar reevaluate_shipping_type_on_ungroup para respetar el candado manual
-- y no reclasificar sumando entre distintos clientes de un lote fedex.
CREATE OR REPLACE FUNCTION public.reevaluate_shipping_type_on_ungroup()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_group_bikes integer;
  v_order_bikes integer;
  v_group_id uuid;
BEGIN
  -- Descombinar para cancelar no es un ungroup de negocio: no queda nadie vivo
  -- a quien reclasificar, y tocar otras filas del grupo desde un BEFORE trigger
  -- es lo que produce el error 27000 cuando el comando toca más de una.
  IF COALESCE(current_setting('pickd.ungroup_reason', true), '') = 'cancel' THEN
    RETURN NEW;
  END IF;

  -- Only trigger when an order is removed from a group
  IF OLD.group_id IS NOT NULL AND (NEW.group_id IS NULL OR NEW.group_id != OLD.group_id) THEN

    -- 1. Evaluate the removed order itself — but only while it can still be
    --    picked and DOES NOT have manual lock.
    IF OLD.shipping_type = 'regular'
       AND NEW.shipping_type_manual IS NOT TRUE
       AND COALESCE(NEW.status, '') NOT IN ('completed', 'cancelled') THEN
      SELECT COALESCE(SUM((item->>'pickingQty')::numeric), 0)::integer INTO v_order_bikes
      FROM jsonb_array_elements(COALESCE(NEW.items, '[]'::jsonb)) AS item
      LEFT JOIN sku_metadata sm ON sm.sku = item->>'sku'
      WHERE COALESCE(sm.is_bike, LEFT(item->>'sku', 2) IN ('01','02','03','06','07')) = true;

      -- If the individual order has < 5 bikes AND it qualifies for fedex
      IF v_order_bikes < 5 AND classify_picking_list_fedex(NEW.items, NEW.transport_company) THEN
        NEW.shipping_type := 'fedex';
      END IF;
    END IF;

    -- 2. Evaluate the remaining orders in the OLD group
    v_group_id := OLD.group_id;

    -- Only evaluate remaining orders if the old group was NOT a fedex batch
    -- (fedex batches contain independent orders across different customers)
    IF NOT EXISTS (SELECT 1 FROM order_groups WHERE id = v_group_id AND group_type = 'fedex') THEN
      SELECT COALESCE(SUM((item->>'pickingQty')::numeric), 0)::integer INTO v_group_bikes
      FROM picking_lists pl
      CROSS JOIN jsonb_array_elements(COALESCE(pl.items, '[]'::jsonb)) AS item
      LEFT JOIN sku_metadata sm ON sm.sku = item->>'sku'
      WHERE pl.group_id = v_group_id
        AND pl.id != NEW.id -- exclude the one being removed
        AND pl.status NOT IN ('completed', 'cancelled')
        AND COALESCE(sm.is_bike, LEFT(item->>'sku', 2) IN ('01','02','03','06','07')) = true;

      IF v_group_bikes < 5 THEN
        UPDATE picking_lists pl
        SET shipping_type = 'fedex'
        WHERE pl.group_id = v_group_id
          AND pl.id != NEW.id
          AND pl.shipping_type_manual IS NOT TRUE
          AND pl.status NOT IN ('completed', 'cancelled')
          AND pl.shipping_type = 'regular'
          AND classify_picking_list_fedex(pl.items, pl.transport_company);

        UPDATE order_groups SET group_type = 'fedex' WHERE id = v_group_id;
      END IF;
    END IF;

  END IF;

  RETURN NEW;
END;
$$;
