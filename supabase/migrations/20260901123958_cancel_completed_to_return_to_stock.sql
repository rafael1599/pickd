-- ============================================================================
-- Cancelar una orden COMPLETADA deja sus unidades en RETURN TO STOCK, no en el
-- estante del que salieron.
--
-- Por qué (Rafael, 31 ago 2026): cuando una orden se completa las bicis ya no
-- están en la fila — están en un pallet junto a la puerta. Cancelarla no las
-- teletransporta de vuelta a ROW 8: alguien tiene que caminarlas. Devolver las
-- unidades a su fila original hace que la app afirme stock que no está ahí, y
-- #881310 (28 ago 2026) es el caso claro: la única unidad de 03-4807RD salió de
-- ROW 37, y ROW 37 hoy está en cero.
--
-- Lo segundo que arregla esta migración es que la restauración NUNCA CORRIÓ.
-- `cancel_completed_order` solo restauraba las líneas con `picked: true`, y esa
-- bandera la escribía el toggle de pick que dejó de usarse en mayo de 2026 (el
-- último log `system: pick` es del 2026-05-22). En toda la base no existe ni un
-- solo log `system: order-deleted`. Simulado contra prod sobre #881310 antes de
-- esta migración, dentro de una transacción con rollback:
--     {"status":"cancelled","items_restored":0,"restored_units":0}
-- 19 unidades se habrían evaporado.
--
-- Así que la restauración deja de leer una bandera del array `items` y
-- reproduce los DEDUCT que esa lista escribió de verdad en `inventory_logs` —
-- la misma fuente en la que `cancel_reopen` ya confía — depositándolos en
-- RETURN TO STOCK. Cada DEDUCT original queda `is_reversed = true`, así que
-- correrlo dos veces no duplica nada y el History pinta el movimiento como
-- deshecho.
--
-- Por qué NO hay respaldo al array `items` cuando no hay logs: 658 de las 1746
-- órdenes completadas no tienen ningún DEDUCT, y no es que se hayan perdido los
-- logs — son órdenes cuyas líneas eran todas `insufficient_stock` /
-- `sku_not_found` con `location: null` (881329, 881280…). Nunca se dedujo nada,
-- así que no hay nada que devolver; recorrer `items` ahí inventaría stock y
-- `adjust_inventory_quantity` reventaría por location vacía. Por lo mismo se
-- saltan los DEDUCT de `system: auto-zero out-of-stock`: ese descuento significa
-- "el estante estaba vacío", no hay nada en el pallet que traer de vuelta.
--
-- Una orden que NUNCA se completó no la toca esta migración: el trigger
-- `compensate_picking_list_changes` sigue devolviendo esas líneas a sus propias
-- ubicaciones, que es lo correcto — nadie las movió de sitio.
--
-- Y una orden ya marcada como enviada no se bloquea ni se cancela a la ligera:
-- la RPC devuelve `requires_unship` y el que llama tiene que volver diciendo que
-- el camión nunca se la llevó (`p_unship := true`), lo que desmarca el envío y
-- sigue el flujo normal (Rafael, 1 sep 2026).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. La ubicación. Se recoge justo después de ROW 43 (410) y antes de ROW 44
--    (660) — es la posición que pidió Rafael. No es almacenamiento: su
--    capacidad no es espacio del edificio, igual que MAS o INCOMING.
-- ---------------------------------------------------------------------------
INSERT INTO public.locations (
  warehouse, location, zone, picking_order, max_capacity,
  counts_as_storage, is_shipping_area, is_active, notes
)
VALUES (
  'LUDLOW', 'RETURN TO STOCK', 'UNASSIGNED', 420, NULL,
  false, false, true,
  'Piso donde esperan las unidades que salieron del estante para una orden que después se canceló. Se recoge después de ROW 43 y antes de ROW 44 (Rafael, 31 ago 2026). No es almacenamiento: su capacidad no cuenta como espacio del almacén.'
)
ON CONFLICT (warehouse, location) DO UPDATE SET
  picking_order     = EXCLUDED.picking_order,
  counts_as_storage = EXCLUDED.counts_as_storage,
  is_active         = true,
  notes             = COALESCE(NULLIF(public.locations.notes, ''), EXCLUDED.notes);

-- ---------------------------------------------------------------------------
-- 2. La nota que PickD escribe al cancelar es suya, no de una persona. Sin un
--    tag reconocido entraría con `kind IS NULL` — o sea, se leería como prosa
--    tecleada por alguien y podría ganar el preview de una línea de la orden.
--    Séptimo tag: una rama aquí y una línea en `src/utils/systemNotes.ts`.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.classify_picking_note(p_message text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_message LIKE '[Waiting]:%' THEN jsonb_build_object(
      'kind', 'waiting',
      'metadata', jsonb_build_object('reason', NULLIF(btrim(substring(p_message from 11)), '')))
    WHEN p_message LIKE '[Resumed from waiting]%' THEN
      jsonb_build_object('kind', 'resumed_from_waiting', 'metadata', NULL)
    WHEN p_message LIKE '[Cancelled from waiting]%' THEN
      jsonb_build_object('kind', 'cancelled_from_waiting', 'metadata', NULL)
    WHEN p_message LIKE '[Cancelled]:%' THEN jsonb_build_object(
      'kind', 'cancelled_order',
      'metadata', jsonb_build_object(
        'units', NULLIF(substring(p_message from '(\d+)\s*units?'), '')::int))
    WHEN p_message LIKE '[Parked]:%' THEN jsonb_build_object(
      'kind', 'parked',
      'metadata', jsonb_build_object('location', NULLIF(btrim(substring(p_message from 10)), '')))
    WHEN p_message LIKE '[AUTO]%' THEN
      jsonb_build_object('kind', 'auto_stale_location', 'metadata', NULL)
    WHEN p_message LIKE '[Daylight]:%' THEN jsonb_build_object(
      'kind', 'daylight_pickup_sms',
      'metadata', jsonb_build_object(
        'pallets', NULLIF(substring(p_message from '(\d+)\s*pallets?'), '')::int))
    ELSE NULL
  END;
$$;

-- ---------------------------------------------------------------------------
-- 3. La RPC. Se borra la versión de dos argumentos y se crea con `p_unship`
--    por defecto en false: PostgREST sigue resolviendo la llamada de dos
--    argumentos que hace el frontend desplegado, así que la app vieja no se
--    rompe entre esta migración y su push.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.cancel_completed_order(uuid, uuid);

CREATE OR REPLACE FUNCTION public.cancel_completed_order(
  p_list_id uuid,
  p_user_id uuid,
  p_unship boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_list RECORD;
  v_log RECORD;
  v_units integer;
  v_total_restored integer := 0;
  v_lines_restored integer := 0;
  v_was_reopened boolean := false;
  v_was_shipped boolean := false;
  v_remaining_in_group integer;
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

  -- Enviada: no se niega, se pregunta. Sin `p_unship` no se escribe nada y el
  -- que llamó tiene que volver confirmando que nunca salió.
  IF COALESCE(v_list.is_shipped, false) AND NOT p_unship THEN
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

  -- Lo que la lista descontó de verdad, en reversa y hacia RETURN TO STOCK.
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
    ORDER BY l.created_at DESC
    FOR UPDATE
  LOOP
    v_units := -v_log.quantity_change;

    PERFORM public.adjust_inventory_quantity(
      p_sku          := v_log.sku,
      p_warehouse    := v_log.warehouse,
      p_location     := 'RETURN TO STOCK',
      p_delta        := v_units,
      p_performed_by := 'system: order-cancelled',
      p_user_id      := p_user_id,
      p_list_id      := p_list_id,
      p_order_number := v_list.order_number,
      -- Sin merge_note a propósito: RETURN TO STOCK recibe unidades de muchas
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
        v_total_restored::text || ' units returned to RETURN TO STOCK across ' ||
        v_lines_restored::text || ' line(s).'
      ELSE
        'Nothing had been deducted, so no units were returned.'
    END ||
    CASE WHEN v_was_reopened THEN ' Reopen was cancelled first.' ELSE '' END ||
    CASE WHEN p_unship AND v_was_shipped THEN ' Order was un-marked as shipped.' ELSE '' END
  );

  -- Limpieza de grupo: si era la última orden viva del grupo, se disuelve.
  IF v_list.group_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_remaining_in_group
    FROM picking_lists
    WHERE group_id = v_list.group_id
      AND status NOT IN ('cancelled')
      AND id != p_list_id;

    IF v_remaining_in_group = 0 THEN
      DELETE FROM order_groups WHERE id = v_list.group_id;
    ELSIF v_remaining_in_group = 1 THEN
      UPDATE picking_lists SET group_id = NULL
      WHERE group_id = v_list.group_id AND id != p_list_id;
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
    'location', 'RETURN TO STOCK',
    'already_cancelled', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_completed_order(uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_completed_order(uuid, uuid, boolean) TO service_role;
