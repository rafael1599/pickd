-- ============================================================================
-- Salir de un grupo no le cambia el carrier a una orden ya terminada.
--
-- Rafael, 17 sep 2026: combinó #881373 con #881622, y al salir 881373 del grupo
-- viejo sus dos compañeras pasaron solas de `regular` a `fedex` — #881347 estaba
-- `completed` esperando camión en ese momento. Hoy no costó nada (acabó
-- cancelada un minuto después), pero la misma secuencia con una orden que sí se
-- envía la manda por FedEx sin que nadie lo decida, y el carrier de una orden
-- terminada ya se tecleó en Audit Source o en el sistema de FedEx.
--
-- El trigger `reevaluate_shipping_type_on_ungroup` existe para una pregunta
-- concreta: si un grupo pierde un miembro y a los que quedan ya no les alcanza
-- para un pallet (<5 bicis), deberían ir por FedEx. Esa pregunta es sobre
-- órdenes que **todavía se pueden recoger**. Su propio SELECT ya lo sabe —
-- cuenta las bicis con `status NOT IN ('completed','cancelled')` — pero el
-- UPDATE que escribía el resultado no filtraba por estado: contaba a unos y
-- escribía sobre otros.
--
-- Mismo agujero en el otro lado, verificado igual: la primera mitad del trigger
-- reclasifica a la orden **que se va**, y con eso #881348 (completed) pasó a
-- `fedex` el 17 sep a las 15:00:35, cuando su grupo se disolvió. Es la misma
-- regla, así que se cierra en el mismo sitio: una orden terminada no se
-- re-rutea sola, ni al irse ni al quedarse.
--
-- Lo que NO cambia: un grupo que pierde un miembro sigue reclasificando a sus
-- miembros abiertos, que es para lo que se escribió (20260510, idea FedEx/5
-- bicis), y el `group_type` del grupo sigue pasando a 'fedex' igual.
-- ============================================================================

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
    --    picked. Su carrier ya se decidió y se tecleó fuera de PickD.
    IF OLD.shipping_type = 'regular'
       AND COALESCE(NEW.status, '') NOT IN ('completed', 'cancelled') THEN
      SELECT COALESCE(SUM((item->>'pickingQty')::numeric), 0)::integer INTO v_order_bikes
      FROM jsonb_array_elements(NEW.items) AS item
      LEFT JOIN sku_metadata sm ON sm.sku = item->>'sku'
      WHERE COALESCE(sm.is_bike, LEFT(item->>'sku', 2) IN ('01','02','03','06','07')) = true;

      -- If the individual order has < 5 bikes AND it qualifies for fedex
      IF v_order_bikes < 5 AND classify_picking_list_fedex(NEW.items, NEW.transport_company) THEN
        NEW.shipping_type := 'fedex';
      END IF;
    END IF;

    -- 2. Evaluate the remaining orders in the OLD group
    v_group_id := OLD.group_id;

    SELECT COALESCE(SUM((item->>'pickingQty')::numeric), 0)::integer INTO v_group_bikes
    FROM picking_lists pl
    CROSS JOIN jsonb_array_elements(pl.items) AS item
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
        -- Se escribe sobre los mismos que se contaron, no sobre todos: una
        -- completada no entra en la cuenta de arriba y tampoco cambia aquí.
        AND pl.status NOT IN ('completed', 'cancelled')
        AND pl.shipping_type = 'regular'
        AND classify_picking_list_fedex(pl.items, pl.transport_company);

      UPDATE order_groups SET group_type = 'fedex' WHERE id = v_group_id;
    END IF;

  END IF;

  RETURN NEW;
END;
$$;
