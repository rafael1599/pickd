-- Un grupo que alguien tiene en las manos no recibe órdenes nuevas.
--
-- El 9 sep 2026 la orden #881394 nació a las 18:11:48 y quedó completada a las
-- 18:11:54: cinco segundos, cero líneas verificadas. No la completó nadie a
-- propósito. `auto_group_fedex_orders` la pegó al grupo FedEx 3806aafb —
-- #881385 + #881421, que un picker llevaba ocho minutos verificando — y el lote
-- de completado, que barre todo lo que comparta `group_id`, se la llevó por
-- delante. La bici nunca salió de ROW 1 y el inventario tardó una hora en
-- volver a decir la verdad.
--
-- La búsqueda de hermano solo excluía `completed`, `cancelled` y `reopened`
-- (20260422120000): miraba el estado de la orden, nunca si había alguien
-- trabajándola. `double_checking` — que es literalmente "lo tengo abierto" —
-- entraba como candidato válido.
--
-- Regla nueva: se puede agrupar contra una orden en reposo, nunca contra una
-- que está en manos de alguien. Lo que se topa con el bloqueo no se pierde:
-- nace sin grupo, aparece como su propia tarjeta en el board, y se combina a
-- mano con Combine — que es donde una decisión así debe tomarse.

-- ── La regla, en un solo lugar ───────────────────────────────────────────────
-- Tres señales de "esto está en manos de alguien", cualquiera basta:
--   * checked_by  — el lock vivo que pone lockForCheck y limpian parkOrder /
--                   releaseCheck, siempre sobre TODOS los hermanos del grupo.
--   * double_checking — el estado que acompaña a ese lock.
--   * verified_item_keys no vacío — progreso real, que sobrevive a un park.
-- Un miembro ya completado también cuenta: su `checked_by` lo dejó puesto
-- `process_picking_list`, y un grupo con trabajo terminado dentro tampoco es
-- sitio donde soltar una orden recién llegada.
CREATE OR REPLACE FUNCTION public.group_is_held(p_group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT p_group_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM picking_lists pl
    WHERE pl.group_id = p_group_id
      AND (
        pl.checked_by IS NOT NULL
        OR pl.status = 'double_checking'
        OR COALESCE(jsonb_array_length(COALESCE(pl.verified_item_keys, '[]'::jsonb)), 0) > 0
      )
  );
$$;

COMMENT ON FUNCTION public.group_is_held(uuid) IS
  'TRUE si algún miembro del grupo está bloqueado, en double_checking o con progreso de verificación. Fuente única de la regla "no se agrupa contra lo que alguien tiene en las manos" (auto_group_fedex_orders + watchdog).';

-- ── El trigger, con la puerta cerrada ────────────────────────────────────────
-- Idéntico a 20260716212500 salvo el bloque marcado más abajo.
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

      -- Sin cambios respecto a 20260716212500. Este UPDATE también puede
      -- arrancarle el group_id a una orden que alguien está verificando, pero
      -- eso parte un grupo a la vista (visible, sin efecto en inventario), no
      -- completa nada sin verificar: es otro problema y merece su propia
      -- decisión, no venir de contrabando en esta.
      UPDATE picking_lists
      SET shipping_type = 'regular', group_id = NULL
      WHERE customer_id = NEW.customer_id
        AND id != COALESCE(NEW.id, gen_random_uuid())
        AND status NOT IN ('completed', 'cancelled')
        AND is_waiting_inventory IS NOT TRUE
        AND (shipping_type = 'fedex' OR (shipping_type IS NULL AND classify_picking_list_fedex(items, transport_company)));

      RETURN NEW;
    END IF;
  END IF;

  -- Operational grouping for FedEx
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
    -- ── Lo nuevo: el hermano tiene que estar en reposo, y su grupo también ──
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
