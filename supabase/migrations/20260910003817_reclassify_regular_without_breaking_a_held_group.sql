-- Reclasificar a REGULAR ya no le arranca el grupo a quien lo está verificando.
--
-- Continuación de 20260909233836. Aquella cerró la puerta de entrada: un grupo
-- que alguien tiene en las manos no recibe órdenes nuevas. Queda el movimiento
-- inverso, en el mismo trigger: cuando llega una orden que lleva al cliente a
-- 5 bicis o más, todas sus órdenes FedEx abiertas pasan a REGULAR **y pierden
-- el group_id de golpe**. Si una de ellas es la que el picker tiene abierta,
-- se le parte la tarjeta combinada a mitad de verificación.
--
-- Las dos mitades de ese UPDATE no valen lo mismo. Cambiar el `shipping_type`
-- es la decisión operativa — dice cómo se envía, y tiene que aplicarse igual o
-- media orden saldría por FedEx mientras su hermana va en camión. Vaciar el
-- `group_id` es limpieza: saca a la orden del cubo operativo FedEx, en el que
-- ya no pertenece. Lo primero corre siempre; lo segundo espera a que la suelten.
--
-- Un grupo tomado queda entonces con `shipping_type = 'regular'` y su group_id
-- intacto — que es exactamente lo que `resolveMixedShippingType` y el ungroup
-- manual ya saben tratar, y lo que el picker espera ver: la misma tarjeta con
-- la que empezó.

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

  -- Determine if this order is fedex
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

  IF NOT v_is_fedex THEN
    RETURN NEW;
  END IF;

  -- Rule: >= 5 BIKES for the SAME customer -> convert to REGULAR (canonical sm.is_bike = true)
  SELECT COALESCE(SUM((item->>'pickingQty')::numeric), 0)::integer INTO v_new_bikes
  FROM jsonb_array_elements(NEW.items) AS item
  LEFT JOIN sku_metadata sm ON sm.sku = item->>'sku'
  WHERE sm.is_bike = true;

  IF NEW.customer_id IS NOT NULL THEN
    SELECT COALESCE(SUM((item->>'pickingQty')::numeric), 0)::integer INTO v_total_bikes
    FROM picking_lists pl
    CROSS JOIN jsonb_array_elements(pl.items) AS item
    LEFT JOIN sku_metadata sm ON sm.sku = item->>'sku'
    WHERE pl.customer_id = NEW.customer_id
      AND pl.id != COALESCE(NEW.id, gen_random_uuid())
      AND pl.status NOT IN ('completed', 'cancelled')
      AND pl.is_waiting_inventory IS NOT TRUE
      AND (
        pl.shipping_type = 'fedex'
        OR (pl.shipping_type IS NULL AND classify_picking_list_fedex(pl.items, pl.transport_company))
      )
      AND sm.is_bike = true;

    IF (v_new_bikes + v_total_bikes) >= 5 THEN
      NEW.shipping_type := 'regular';

      -- El tipo de envío cambia siempre; el group_id solo si nadie lo sostiene.
      UPDATE picking_lists
      SET shipping_type = 'regular',
          group_id = CASE
                       WHEN public.group_is_held(group_id) THEN group_id
                       ELSE NULL
                     END
      WHERE customer_id = NEW.customer_id
        AND id != COALESCE(NEW.id, gen_random_uuid())
        AND status NOT IN ('completed', 'cancelled')
        AND is_waiting_inventory IS NOT TRUE
        AND (shipping_type = 'fedex' OR (shipping_type IS NULL AND classify_picking_list_fedex(items, transport_company)));

      RETURN NEW;
    END IF;
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
