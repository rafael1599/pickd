-- ============================================================================
-- auto_group_fedex_orders: el cliente se revisa siempre, con todas sus bicis
-- (26 sep 2026; análisis en label-bench/agrupado/, validado en prod con ROLLBACK)
-- ============================================================================
--
-- WILMETTE, 25 sep: #881735 (2 bicis, 16:42:15), #881644 (53, 16:42:34) y
-- #881645 (1, 16:42:53), mismo cliente y dirección. Debieron ser un envío
-- regular y salieron como tres, con las dos chicas en un grupo FedEx. Dos
-- defectos de la versión de 20260910003817:
--
--   1. `IF NOT v_is_fedex THEN RETURN NEW` salía ANTES de revisar al cliente:
--      #881644 entró regular y nadie convirtió a su hermana FedEx.
--   2. La suma sólo contaba las órdenes FedEx abiertas del cliente: al llegar
--      #881645 dio 2 + 1 = 3 y dejó fuera las 53 regulares.
--
-- Ahora la regla de ≥ 5 bicis corre para toda orden que entra y suma TODAS
-- las abiertas del cliente, FedEx o regular. Y el ámbito es cliente +
-- dirección (`ship_to_address_id IS NOT DISTINCT FROM`): el 98 % de las
-- órdenes la traen (272 de 277 en 30 días), así que dos bodegas del mismo
-- cliente ya no se suman.
--
-- Lo que NO cambia: el group_id se vacía sólo si nadie sostiene el grupo
-- (group_is_held), el camino FedEx de buscar hermana en reposo es idéntico,
-- y la función no combina regulares — decidir que dos órdenes son un envío
-- sigue siendo de una persona (9 sep 2026).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.auto_group_fedex_orders()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_is_fedex boolean;
  v_sibling_id uuid;
  v_sibling_group uuid;
  v_new_group uuid;
  v_total_bikes integer;
  v_new_bikes integer;
  v_transport text;
BEGIN
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
  FROM jsonb_array_elements(NEW.items) AS item
  LEFT JOIN sku_metadata sm ON sm.sku = item->>'sku'
  WHERE sm.is_bike = true;

  IF NEW.customer_id IS NOT NULL THEN
    -- Count ALL open bikes for this customer and address (FedEx or Regular)
    SELECT COALESCE(SUM((item->>'pickingQty')::numeric), 0)::integer INTO v_total_bikes
    FROM picking_lists pl
    CROSS JOIN jsonb_array_elements(pl.items) AS item
    LEFT JOIN sku_metadata sm ON sm.sku = item->>'sku'
    WHERE pl.customer_id = NEW.customer_id
      AND pl.ship_to_address_id IS NOT DISTINCT FROM NEW.ship_to_address_id
      AND pl.id != COALESCE(NEW.id, gen_random_uuid())
      AND pl.status NOT IN ('completed', 'cancelled')
      AND pl.is_waiting_inventory IS NOT TRUE
      AND sm.is_bike = true;

    IF (v_new_bikes + v_total_bikes) >= 5 THEN
      NEW.shipping_type := 'regular';
      v_is_fedex := false; -- Actualizamos para que no siga el camino fedex

      -- El tipo de envío cambia siempre; el group_id solo si nadie lo sostiene.
      -- Solo actualizar las ordenes FedEx abiertas del cliente a regular
      UPDATE picking_lists
      SET shipping_type = 'regular',
          group_id = CASE
                       WHEN public.group_is_held(group_id) THEN group_id
                       ELSE NULL
                     END
      WHERE customer_id = NEW.customer_id
        AND ship_to_address_id IS NOT DISTINCT FROM NEW.ship_to_address_id
        AND id != COALESCE(NEW.id, gen_random_uuid())
        AND status NOT IN ('completed', 'cancelled')
        AND is_waiting_inventory IS NOT TRUE
        AND (shipping_type = 'fedex' OR (shipping_type IS NULL AND classify_picking_list_fedex(items, transport_company)));
    END IF;
  END IF;

  -- Si termina siendo regular (o no es fedex y no se convirtió), retorna sin agrupar
  IF NOT v_is_fedex THEN
    RETURN NEW;
  END IF;

  -- Operational grouping for FedEx: the sibling must be at rest, and so must
  -- its group (20260909233836).
  SELECT pl.id, pl.group_id INTO v_sibling_id, v_sibling_group
  FROM picking_lists pl
  WHERE pl.id != COALESCE(NEW.id, gen_random_uuid())
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
