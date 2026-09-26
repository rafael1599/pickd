-- ============================================================================
-- El envío como entidad: public.shipments y picking_lists.shipment_id
-- (26 sep 2026; docs/prds/shipments.md, backlog idea-230, bug-032, bug-045)
-- Fase 3: Re-sincronización y espejo picking_lists → shipments (PickD) - Corregido
-- ============================================================================
--
-- CORRECCIONES APLICADAS RESPECTO A LA REVISIÓN INICIAL:
--   1. Eliminación de la guarda `pg_trigger_depth() > 1`:
--      Permite sincronizar legítimamente actualizaciones en picking_lists originadas
--      dentro de otros triggers (ej. auto_group_fedex_orders BEFORE INSERT al convertir
--      a regular con >=5 bicis o al agrupar hermanas FedEx, reevaluate_shipping_type_on_ungroup
--      BEFORE UPDATE, y acciones referenciales en cancel_combined_order). La recursión
--      queda completamente protegida por la cláusula WHEN (que omite shipment_id) y la
--      variable transaccional local `pickd.shipments_mirror`.
--   2. Reordenamiento en Caso B (descombinación de ancla con load_number):
--      Al salir el ancla de un grupo, primero se remueve su vinculación (`shipment_id = NULL`),
--      se refresca el envío del grupo previo (que recalcula la nueva ancla y libera el
--      load_number anterior evitando la colisión 23505 en el índice UNIQUE parcial), y
--      posteriormente se crea, vincula y refresca el nuevo envío propio de la orden.
-- ============================================================================

-- ── 1) Función centralizada: refresh_shipment ───────────────────────────────

CREATE OR REPLACE FUNCTION public.refresh_shipment(p_shipment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_count integer;
  v_customer_id uuid;
  v_ship_to_address_id uuid;
  v_transport_company text;
  v_load_number text;
  v_total_weight_lbs numeric;
  v_pallet_dims jsonb;
  v_pallets_qty integer;
  v_pallet_photos jsonb;
  v_is_shipped boolean;
  v_old_shipped_at timestamptz;
  v_new_shipped_at timestamptz;
BEGIN
  IF p_shipment_id IS NULL THEN
    RETURN;
  END IF;

  -- 1. Contar órdenes asociadas a este envío
  SELECT count(*) INTO v_count
  FROM public.picking_lists
  WHERE shipment_id = p_shipment_id;

  -- Si un envío queda sin órdenes vivas, se deja como historia (docs/prds/shipments.md §4).
  -- Se limpian sus tarimas y su load_number para evitar colisiones con el UNIQUE parcial.
  IF v_count = 0 THEN
    UPDATE public.shipments
    SET load_number = NULL,
        pallets_qty = 0,
        pallet_dims = '[]'::jsonb,
        pallet_photos = '[]'::jsonb,
        is_shipped = false,
        shipped_at = NULL,
        updated_at = now()
    WHERE id = p_shipment_id
      AND (
        load_number IS NOT NULL OR
        pallets_qty <> 0 OR
        pallet_dims <> '[]'::jsonb OR
        pallet_photos <> '[]'::jsonb OR
        is_shipped IS NOT FALSE OR
        shipped_at IS NOT NULL
      );
    RETURN;
  END IF;

  -- 2. Obtener shipped_at previo para preservarlo si ya estaba despachado
  SELECT shipped_at INTO v_old_shipped_at
  FROM public.shipments
  WHERE id = p_shipment_id;

  -- 3. Calcular hechos del ancla y agregaciones
  WITH ranked_orders AS (
    SELECT 
      pl.id,
      pl.customer_id,
      pl.ship_to_address_id,
      pl.transport_company,
      pl.shipping_type,
      pl.load_number,
      pl.pallets_qty,
      pl.total_weight_lbs,
      pl.pallet_dims,
      pl.is_shipped,
      ROW_NUMBER() OVER (ORDER BY pl.created_at ASC, pl.id ASC) as rk
    FROM public.picking_lists pl
    WHERE pl.shipment_id = p_shipment_id
  )
  SELECT 
    (array_agg(customer_id ORDER BY rk))[1],
    (array_agg(ship_to_address_id ORDER BY rk))[1],
    (array_agg(transport_company ORDER BY rk))[1],
    CASE 
      WHEN (array_agg(shipping_type ORDER BY rk))[1] = 'fedex'
           OR UPPER(TRIM(COALESCE((array_agg(transport_company ORDER BY rk))[1], ''))) = 'FEDEX' THEN NULL
      ELSE (array_agg(load_number ORDER BY rk))[1]
    END,
    (array_agg(total_weight_lbs ORDER BY rk))[1],
    COALESCE(
      (array_agg(pallet_dims ORDER BY rk)
         FILTER (WHERE jsonb_typeof(COALESCE(pallet_dims, '[]'::jsonb)) = 'array' 
                   AND jsonb_array_length(COALESCE(pallet_dims, '[]'::jsonb)) > 0))[1],
      '[]'::jsonb
    ),
    SUM(COALESCE(pallets_qty, 0))::integer,
    BOOL_AND(COALESCE(is_shipped, false))
  INTO
    v_customer_id,
    v_ship_to_address_id,
    v_transport_company,
    v_load_number,
    v_total_weight_lbs,
    v_pallet_dims,
    v_pallets_qty,
    v_is_shipped
  FROM ranked_orders;

  -- 4. Unión de fotos sin duplicados conservando el orden de antigüedad
  WITH unnested_photos AS (
    SELECT 
      elem,
      ROW_NUMBER() OVER (ORDER BY pl.created_at ASC, pl.id ASC, ord ASC) as overall_ord
    FROM public.picking_lists pl
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE 
        WHEN jsonb_typeof(COALESCE(pl.pallet_photos, '[]'::jsonb)) = 'array' THEN pl.pallet_photos 
        ELSE '[]'::jsonb 
      END
    ) WITH ORDINALITY AS t(elem, ord)
    WHERE pl.shipment_id = p_shipment_id
  ),
  deduped_photos AS (
    SELECT elem, MIN(overall_ord) as first_seen
    FROM unnested_photos
    GROUP BY elem
  )
  SELECT COALESCE(jsonb_agg(elem ORDER BY first_seen), '[]'::jsonb)
  INTO v_pallet_photos
  FROM deduped_photos;

  -- 5. Determinar shipped_at
  IF v_is_shipped IS TRUE THEN
    v_new_shipped_at := COALESCE(v_old_shipped_at, now());
  ELSE
    v_new_shipped_at := NULL;
  END IF;

  -- 6. Actualizar public.shipments únicamente si existen cambios
  UPDATE public.shipments
  SET customer_id = v_customer_id,
      ship_to_address_id = v_ship_to_address_id,
      transport_company = v_transport_company,
      load_number = v_load_number,
      pallets_qty = v_pallets_qty,
      total_weight_lbs = v_total_weight_lbs,
      pallet_dims = v_pallet_dims,
      pallet_photos = v_pallet_photos,
      is_shipped = v_is_shipped,
      shipped_at = v_new_shipped_at,
      updated_at = now()
  WHERE id = p_shipment_id
    AND (
      customer_id IS DISTINCT FROM v_customer_id OR
      ship_to_address_id IS DISTINCT FROM v_ship_to_address_id OR
      transport_company IS DISTINCT FROM v_transport_company OR
      load_number IS DISTINCT FROM v_load_number OR
      pallets_qty IS DISTINCT FROM v_pallets_qty OR
      total_weight_lbs IS DISTINCT FROM v_total_weight_lbs OR
      pallet_dims IS DISTINCT FROM v_pallet_dims OR
      pallet_photos IS DISTINCT FROM v_pallet_photos OR
      is_shipped IS DISTINCT FROM v_is_shipped OR
      shipped_at IS DISTINCT FROM v_new_shipped_at
    );
END;
$$;

COMMENT ON FUNCTION public.refresh_shipment(uuid) IS
  'Recalcula los hechos consolidados de un envío a partir de sus órdenes vinculadas en picking_lists. '
  'Garantiza estricta paridad de reglas con el backfill inicial.';

REVOKE ALL ON FUNCTION public.refresh_shipment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_shipment(uuid) TO authenticated, service_role;

-- ── 2) Función y Trigger AFTER UPDATE: sync_picking_list_to_shipment ─────────

CREATE OR REPLACE FUNCTION public.sync_picking_list_to_shipment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_old_group_type text := NULL;
  v_new_group_type text := NULL;
  v_anchor_id uuid;
  v_anchor_shipment_id uuid;
  v_new_shipment_id uuid;
  v_prev_shipment_id uuid;
BEGIN
  -- 1. Guarda contra recursión infinita (la bandera local transaccional previene ciclos)
  -- Nota: Eliminada la guarda de pg_trigger_depth() > 1 para no saltar actualizaciones
  -- legítimas originadas en triggers previos (ej. auto_group_fedex_orders, reevaluate_shipping_type).
  IF current_setting('pickd.shipments_mirror', true) = 'on' THEN
    RETURN NEW;
  END IF;

  -- Instrumentación opcional de pruebas
  PERFORM set_config(
    'pickd.test_sync_calls',
    (COALESCE(NULLIF(current_setting('pickd.test_sync_calls', true), ''), '0')::int + 1)::text,
    true
  );

  -- Activar guarda transaccional local
  PERFORM set_config('pickd.shipments_mirror', 'on', true);

  -- 2. Pertenencia: cuando cambia group_id
  IF OLD.group_id IS DISTINCT FROM NEW.group_id THEN
    IF OLD.group_id IS NOT NULL THEN
      SELECT group_type INTO v_old_group_type
      FROM public.order_groups
      WHERE id = OLD.group_id;
    END IF;

    IF NEW.group_id IS NOT NULL THEN
      SELECT group_type INTO v_new_group_type
      FROM public.order_groups
      WHERE id = NEW.group_id;
    END IF;

    -- Caso A: La orden entra a un grupo general o pickup
    IF v_new_group_type IN ('general', 'pickup') THEN
      -- Identificar el ancla del grupo (la orden más vieja por created_at, id)
      SELECT pl.id, pl.shipment_id
      INTO v_anchor_id, v_anchor_shipment_id
      FROM public.picking_lists pl
      WHERE pl.group_id = NEW.group_id
      ORDER BY pl.created_at ASC, pl.id ASC
      LIMIT 1;

      -- Unificar cualquier miembro del grupo cuyo shipment_id no coincida con el del ancla
      FOR v_prev_shipment_id IN
        SELECT DISTINCT pl.shipment_id
        FROM public.picking_lists pl
        WHERE pl.group_id = NEW.group_id
          AND pl.shipment_id IS DISTINCT FROM v_anchor_shipment_id
      LOOP
        UPDATE public.picking_lists
        SET shipment_id = v_anchor_shipment_id
        WHERE group_id = NEW.group_id
          AND shipment_id = v_prev_shipment_id;

        PERFORM public.refresh_shipment(v_prev_shipment_id);
      END LOOP;

      -- Asegurar que la orden misma quede apuntando al envío del ancla
      IF NEW.shipment_id IS DISTINCT FROM v_anchor_shipment_id THEN
        UPDATE public.picking_lists
        SET shipment_id = v_anchor_shipment_id
        WHERE id = NEW.id;

        IF OLD.shipment_id IS DISTINCT FROM v_anchor_shipment_id THEN
          PERFORM public.refresh_shipment(OLD.shipment_id);
        END IF;
      END IF;

      -- Refrescar el envío consolidado del grupo
      PERFORM public.refresh_shipment(v_anchor_shipment_id);

    -- Caso B: La orden sale de un grupo general o pickup (o pasa a fedex, o deja de compartir un envío)
    ELSIF OLD.group_id IS NOT NULL 
          AND (
            v_old_group_type IN ('general', 'pickup') 
            OR EXISTS (
              SELECT 1 FROM public.picking_lists pl 
              WHERE pl.shipment_id = OLD.shipment_id AND pl.id <> NEW.id
            )
          )
          AND (NEW.group_id IS NULL OR v_new_group_type = 'fedex') THEN

      v_prev_shipment_id := OLD.shipment_id;

      -- 1. Sacar la orden del envío previo de forma inmediata
      UPDATE public.picking_lists
      SET shipment_id = NULL
      WHERE id = NEW.id;

      -- 2. Refrescar el envío anterior (del grupo), que recalcula el nuevo ancla y libera load_number
      -- si correspondía al ancla saliente, eliminando cualquier colisión con el índice UNIQUE parcial.
      IF v_prev_shipment_id IS NOT NULL THEN
        PERFORM public.refresh_shipment(v_prev_shipment_id);
      END IF;

      -- 3. Crear el envío nuevo propio (ahora sin riesgo de colisión 23505)
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
        NEW.customer_id,
        NEW.ship_to_address_id,
        NEW.transport_company,
        CASE
          WHEN NEW.shipping_type = 'fedex' OR UPPER(TRIM(COALESCE(NEW.transport_company, ''))) = 'FEDEX' THEN NULL
          ELSE NEW.load_number
        END,
        COALESCE(NEW.pallets_qty, 0),
        NEW.total_weight_lbs,
        COALESCE(NEW.pallet_dims, '[]'::jsonb),
        COALESCE(NEW.pallet_photos, '[]'::jsonb),
        COALESCE(NEW.is_shipped, false),
        CASE WHEN NEW.is_shipped IS TRUE THEN now() ELSE NULL END
      ) RETURNING id INTO v_new_shipment_id;

      -- 4. Asignar el nuevo envío a la orden
      UPDATE public.picking_lists
      SET shipment_id = v_new_shipment_id
      WHERE id = NEW.id;

      -- 5. Refrescar el nuevo envío
      PERFORM public.refresh_shipment(v_new_shipment_id);

    -- Caso C: Lote FedEx u otros (cada orden conserva su propio envío)
    ELSE
      IF OLD.shipment_id IS DISTINCT FROM NEW.shipment_id AND OLD.shipment_id IS NOT NULL THEN
        PERFORM public.refresh_shipment(OLD.shipment_id);
      END IF;
      PERFORM public.refresh_shipment(NEW.shipment_id);
    END IF;

  -- 3. Si no cambió group_id pero cambiaron hechos físicos o logísticos
  ELSE
    PERFORM public.refresh_shipment(NEW.shipment_id);
  END IF;

  -- Desactivar guarda transaccional local
  PERFORM set_config('pickd.shipments_mirror', 'off', true);

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.sync_picking_list_to_shipment() IS
  'Trigger AFTER UPDATE que sincroniza cambios en hechos de picking_lists y pertenencia de grupos hacia shipments.';

REVOKE ALL ON FUNCTION public.sync_picking_list_to_shipment() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_picking_list_to_shipment() TO authenticated, service_role;

DROP TRIGGER IF EXISTS trg_shipments_mirror_update ON public.picking_lists;
CREATE TRIGGER trg_shipments_mirror_update
  AFTER UPDATE ON public.picking_lists
  FOR EACH ROW
  WHEN (
    OLD.group_id IS DISTINCT FROM NEW.group_id OR
    OLD.pallets_qty IS DISTINCT FROM NEW.pallets_qty OR
    OLD.pallet_dims IS DISTINCT FROM NEW.pallet_dims OR
    OLD.pallet_photos IS DISTINCT FROM NEW.pallet_photos OR
    OLD.transport_company IS DISTINCT FROM NEW.transport_company OR
    OLD.load_number IS DISTINCT FROM NEW.load_number OR
    OLD.ship_to_address_id IS DISTINCT FROM NEW.ship_to_address_id OR
    OLD.total_weight_lbs IS DISTINCT FROM NEW.total_weight_lbs OR
    OLD.is_shipped IS DISTINCT FROM NEW.is_shipped OR
    OLD.shipping_type IS DISTINCT FROM NEW.shipping_type
  )
  EXECUTE FUNCTION public.sync_picking_list_to_shipment();

-- ── 3) Función y Trigger AFTER DELETE: sync_picking_list_delete_to_shipment ──

CREATE OR REPLACE FUNCTION public.sync_picking_list_delete_to_shipment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF current_setting('pickd.shipments_mirror', true) = 'on' THEN
    RETURN OLD;
  END IF;

  PERFORM set_config('pickd.shipments_mirror', 'on', true);

  IF OLD.shipment_id IS NOT NULL THEN
    PERFORM public.refresh_shipment(OLD.shipment_id);
  END IF;

  PERFORM set_config('pickd.shipments_mirror', 'off', true);

  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION public.sync_picking_list_delete_to_shipment() IS
  'Trigger AFTER DELETE que recalcula el envío si se elimina una orden en picking_lists.';

REVOKE ALL ON FUNCTION public.sync_picking_list_delete_to_shipment() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_picking_list_delete_to_shipment() TO authenticated, service_role;

DROP TRIGGER IF EXISTS trg_shipments_mirror_delete ON public.picking_lists;
CREATE TRIGGER trg_shipments_mirror_delete
  AFTER DELETE ON public.picking_lists
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_picking_list_delete_to_shipment();

-- ── 4) Re-sincronización inicial de todos los envíos existentes ─────────────
-- Recalcula los hechos de todos los envíos existentes en public.shipments
-- garantizando consistencia absoluta antes de activar lecturas.
DO $$
BEGIN
  PERFORM public.refresh_shipment(id) FROM public.shipments;
END $$;
