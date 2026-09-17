-- ============================================================================
-- Cancelar una orden combinada cancela el pallet entero, no solo el ancla.
--
-- Rafael, 17 sep 2026: "vi estos mensajes que no cuadran con la cantidad total:
-- Order cancelled - 5 units to RETURN TO STOCK. la cantidad total era mayor".
--
-- La tarjeta combinada de Ship es un pseudo-pedido: `combineGeneralGroupSiblings`
-- suma pallets, unidades e items de todos los miembros del grupo pero hereda el
-- `id` del ancla (el miembro más viejo por `created_at`). `handleDeleteOrder`
-- cancelaba ese id, así que la tarjeta decía 8 unidades y volvían 3. Los otros
-- miembros se quedaban en `completed`, con sus unidades descontadas del estante
-- y ninguna en RETURN TO STOCK: stock fantasma. Medido en prod el 17 sep:
--   · tarjeta 881415/881373/881347 = 8 u → volvieron 3 (881347 4 u y 881373 1 u
--     se quedaron completed)
--   · tarjeta 881416/881348       = 8 u → volvieron 5 (881348 3 u se quedó)
--   · 881420 iba sola             = 11 u → volvieron 11 ✓
--
-- El camino lo eligió Rafael: **descombinar en el backend y cancelar una por
-- una**. Va en una sola RPC, no en un bucle del cliente, porque a mitad de un
-- bucle que falla quedan dos canceladas y una viva — que es exactamente el
-- estado que este archivo viene a arreglar.
--
-- ---------------------------------------------------------------------------
-- Y de paso, el error que hacía imposible arreglarlo a mano (verificado contra
-- prod dentro de una transacción con rollback):
--
--   cancel_completed_order('881347') →
--   ERROR 27000: tuple to be updated was already modified by an operation
--   triggered by the current command
--
-- La limpieza de grupo hacía `UPDATE picking_lists SET group_id = NULL WHERE
-- group_id = … AND id != …`, que toca VARIAS filas a la vez; el trigger BEFORE
-- `reevaluate_shipping_type_on_ungroup` escribe sobre las otras filas del mismo
-- grupo, o sea sobre filas del mismo comando. Con un grupo de tres donde ya
-- había una cancelada, cancelar la segunda reventaba entera: ni unidades
-- devueltas ni orden cancelada. Dos cambios, cada uno suficiente por su cuenta:
--   1. la limpieza pasa a ser fila por fila (un comando, una fila);
--   2. un descombinado hecho para cancelar no reclasifica el envío de nadie.
--
-- (2) no es solo higiene. En la simulación, soltar las órdenes del grupo dejó a
-- las cuatro en `shipping_type = 'fedex'` sin que nadie lo decidiera: el trigger
-- existe para reclasificar a los que SIGUEN VIVOS cuando uno se va, y cuando se
-- cancela el grupo entero no queda nadie a quien reclasificar. Si además se
-- deshace la cancelación (idea del undo), resucitaría órdenes que dicen FedEx
-- por un efecto colateral.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. El registro de quién formaba el grupo.
--
--    Al cancelar, el grupo se disuelve y `order_groups` se borra; la FK de
--    `picking_lists.group_id` es ON DELETE SET NULL, así que el rastro
--    desaparece de las filas también. Sin esto, "deshacer la cancelación de una
--    combinada" no tiene a quién volver a juntar.
--
--    Append-only, como `sublocation_relabels` y `sku_canonical_renames`: sin
--    políticas de UPDATE ni DELETE. No va en `combine_meta` porque su esquema
--    (`CombineMetaSchema`, src/schemas/picking.schema.ts) exige `is_combined` y
--    `source_orders`, y en las filas reales ese campo es NULL a propósito — el
--    `is_combined: true` solo existe en el pseudo-pedido que arma la pantalla.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cancelled_order_groups (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id      uuid NOT NULL,
  group_type    text,
  cancelled_at  timestamptz NOT NULL DEFAULT NOW(),
  cancelled_by  uuid REFERENCES public.profiles(id),
  -- [{list_id, order_number, status_before, shipping_type_before, is_shipped_before}]
  members       jsonb NOT NULL,
  member_ids    uuid[] NOT NULL
);

COMMENT ON TABLE public.cancelled_order_groups IS
  'Quién formaba una orden combinada cuando se canceló. El grupo se borra al cancelar (FK ON DELETE SET NULL), así que esta fila es lo único que permite rehacerlo al deshacer la cancelación. Append-only.';

CREATE INDEX IF NOT EXISTS cancelled_order_groups_member_ids_idx
  ON public.cancelled_order_groups USING GIN (member_ids);
CREATE INDEX IF NOT EXISTS cancelled_order_groups_group_id_idx
  ON public.cancelled_order_groups (group_id);

ALTER TABLE public.cancelled_order_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cancelled_order_groups readable by authenticated"
  ON public.cancelled_order_groups;
CREATE POLICY "cancelled_order_groups readable by authenticated"
  ON public.cancelled_order_groups FOR SELECT TO authenticated USING (true);

GRANT SELECT ON public.cancelled_order_groups TO authenticated;
GRANT SELECT, INSERT ON public.cancelled_order_groups TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Un descombinado hecho para cancelar no reclasifica el envío de nadie.
--
--    Misma forma que el `pickd.weight_source` de `set_dimensions_verified`
--    (20260912054645): quien escribe puede decir por qué lo hace, y el ajuste
--    es local a la transacción. Cuerpo idéntico al de antes salvo la guarda.
-- ---------------------------------------------------------------------------
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

    -- 1. Evaluate the removed order itself
    IF OLD.shipping_type = 'regular' THEN
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
        AND pl.shipping_type = 'regular'
        AND classify_picking_list_fedex(pl.items, pl.transport_company);

      UPDATE order_groups SET group_type = 'fedex' WHERE id = v_group_id;
    END IF;

  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. `cancel_completed_order`: la limpieza de grupo, fila por fila.
--
--    Idéntica a 20260901123958 salvo ese bloque final. Se mantiene la firma de
--    tres argumentos para no romper la llamada del frontend desplegado.
-- ---------------------------------------------------------------------------
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
    'location', 'RETURN TO STOCK',
    'already_cancelled', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_completed_order(uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_completed_order(uuid, uuid, boolean) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. La cancelación de la tarjeta combinada: descombina y cancela una por una.
--
--    Una sola transacción. El orden importa: primero la pregunta del envío
--    (si alguna salió y nadie lo desmiente, no se escribe NADA), después el
--    registro de quién era el grupo, luego el descombinado y por último las
--    cancelaciones — con `group_id` ya en NULL, cada `cancel_completed_order`
--    se salta su propia limpieza de grupo.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_combined_order(
  p_group_id uuid,
  p_user_id uuid,
  p_unship boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_group RECORD;
  v_member RECORD;
  v_members jsonb := '[]'::jsonb;
  v_member_ids uuid[] := ARRAY[]::uuid[];
  v_shipped text[] := ARRAY[]::text[];
  v_live integer := 0;
  v_orders_cancelled integer := 0;
  v_total_restored integer := 0;
  v_lines_restored integer := 0;
  v_res jsonb;
  v_numbers text;
BEGIN
  SELECT * INTO v_group FROM order_groups WHERE id = p_group_id FOR UPDATE;

  -- El grupo ya no existe (otra cancelación lo disolvió, o alguien descombinó).
  -- No es un error: el que llama cancela la orden suelta como siempre.
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'group_missing', true,
      'orders_cancelled', 0,
      'restored_units', 0,
      'items_restored', 0,
      'requires_unship', false,
      'shipped_orders', '[]'::jsonb,
      'location', NULL
    );
  END IF;

  FOR v_member IN
    SELECT id, order_number, status, shipping_type, is_shipped
    FROM picking_lists
    WHERE group_id = p_group_id
    ORDER BY created_at
    FOR UPDATE
  LOOP
    v_member_ids := v_member_ids || v_member.id;
    v_members := v_members || jsonb_build_object(
      'list_id', v_member.id,
      'order_number', v_member.order_number,
      'status_before', v_member.status,
      'shipping_type_before', v_member.shipping_type,
      'is_shipped_before', COALESCE(v_member.is_shipped, false)
    );
    IF v_member.status <> 'cancelled' THEN
      v_live := v_live + 1;
      IF COALESCE(v_member.is_shipped, false) THEN
        v_shipped := v_shipped || COALESCE(v_member.order_number, v_member.id::text);
      END IF;
    END IF;
  END LOOP;

  -- Una sola pregunta por el grupo entero: si alguna salió en el camión, no se
  -- escribe nada hasta que el que llama diga que nunca se envió.
  IF array_length(v_shipped, 1) IS NOT NULL AND NOT p_unship THEN
    RETURN jsonb_build_object(
      'group_missing', false,
      'orders_cancelled', 0,
      'restored_units', 0,
      'items_restored', 0,
      'requires_unship', true,
      'shipped_orders', to_jsonb(v_shipped),
      'location', NULL
    );
  END IF;

  INSERT INTO cancelled_order_groups (
    group_id, group_type, cancelled_by, members, member_ids
  ) VALUES (
    p_group_id, v_group.group_type, p_user_id, v_members, v_member_ids
  );

  -- Descombinar, fila por fila y sin reclasificar a nadie.
  PERFORM set_config('pickd.ungroup_reason', 'cancel', true);
  FOR v_member IN
    SELECT id FROM picking_lists WHERE group_id = p_group_id ORDER BY created_at
  LOOP
    UPDATE picking_lists SET group_id = NULL WHERE id = v_member.id;
  END LOOP;
  PERFORM set_config('pickd.ungroup_reason', '', true);

  DELETE FROM order_groups WHERE id = p_group_id;

  -- Y ahora sí, una por una.
  SELECT string_agg('#' || COALESCE(m->>'order_number', '?'), ' / ')
  INTO v_numbers
  FROM jsonb_array_elements(v_members) m;

  FOR v_member IN
    SELECT (m->>'list_id')::uuid AS id,
           m->>'status_before'   AS status_before
    FROM jsonb_array_elements(v_members) m
    WHERE m->>'status_before' <> 'cancelled'
  LOOP
    IF v_member.status_before IN ('completed', 'reopened') THEN
      v_res := public.cancel_completed_order(v_member.id, p_user_id, p_unship);
      v_total_restored := v_total_restored + COALESCE((v_res->>'restored_units')::int, 0);
      v_lines_restored := v_lines_restored + COALESCE((v_res->>'items_restored')::int, 0);
    ELSE
      -- Un miembro que nunca se completó no descontó nada del estante; el
      -- trigger `compensate_picking_list_changes` se encarga de lo suyo y
      -- devuelve a la ubicación propia, que para ese caso es lo correcto.
      UPDATE picking_lists SET
        status           = 'cancelled',
        updated_at       = NOW(),
        last_activity_at = NOW()
      WHERE id = v_member.id;

      INSERT INTO picking_list_notes (list_id, user_id, message)
      VALUES (
        v_member.id, p_user_id,
        '[Cancelled]: Cancelled with the combined order (' || COALESCE(v_numbers, '') ||
        '). It had not been completed, so nothing was returned.'
      );
    END IF;

    v_orders_cancelled := v_orders_cancelled + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'group_missing', false,
    'orders_cancelled', v_orders_cancelled,
    'restored_units', v_total_restored,
    'items_restored', v_lines_restored,
    'requires_unship', false,
    'shipped_orders', '[]'::jsonb,
    'location', CASE WHEN v_total_restored > 0 THEN 'RETURN TO STOCK' ELSE NULL END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_combined_order(uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_combined_order(uuid, uuid, boolean) TO service_role;
