-- Recount que llega al personal (idea-263, docs/prds/recount-suggestions.md).
--
-- Rafael, 9 oct 2026: «AS400 no es la verdad absoluta y no debe usarse para
-- reconciliar. Necesito una manera de sugerir recount al personal» y «casi nadie
-- entra a recount, debemos trabajarlo ahora mismo».
--
-- Una petición es «que alguien cuente este SKU en esta ubicación». Se cierra
-- contando — nunca por reloj (regla del 8 oct, .claude/rules/picking.md).
-- El conteo es lo que la persona escribe: Stock Count copiaba el número del
-- sistema como si fuera contado, y eso se acaba aquí.
--
-- Unidades en órdenes abiertas: el pick no descuenta hasta completar, así que
-- un estante con unidades en un carrito no se puede contar contra el sistema.
--   * Desde Double Check (p_list_id): lo contado es lo que QUEDA tras tomar las
--     de esta orden; se suma lo de esta orden. Si otra orden abierta tiene ese
--     SKU en esa ubicación, se rechaza (la app ni pregunta).
--   * Desde Stock: si cualquier orden abierta lo tiene ahí, se rechaza.
-- Diferencia de más de 5 unidades: no se aplica; la cuenta otra persona
-- (Rafael, 9 oct: ok a los defaults del estudio).

CREATE TABLE IF NOT EXISTS public.recount_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku               text NOT NULL,
  warehouse         text NOT NULL DEFAULT 'LUDLOW',
  location          text NOT NULL,
  reason            text NOT NULL,
  requested_by      uuid REFERENCES public.profiles(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  status            text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  -- Primer conteo que no cuadró por más de 5: el siguiente lo hace otra persona.
  first_counted_by  uuid REFERENCES public.profiles(id),
  first_counted_qty integer,
  closed_at         timestamptz,
  closed_by         uuid REFERENCES public.profiles(id),
  counted_qty       integer,
  expected_qty      integer,
  applied_delta     integer,
  CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_recount_open
  ON public.recount_requests (sku, warehouse, upper(trim(location)))
  WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_recount_status ON public.recount_requests (status, created_at);

ALTER TABLE public.recount_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read recount_requests" ON public.recount_requests;
DROP POLICY IF EXISTS "Authenticated insert recount_requests" ON public.recount_requests;
CREATE POLICY "Authenticated read recount_requests" ON public.recount_requests
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert recount_requests" ON public.recount_requests
  FOR INSERT TO authenticated WITH CHECK (true);
GRANT SELECT, INSERT ON public.recount_requests TO authenticated;
GRANT ALL ON public.recount_requests TO service_role;

-- Unidades de un SKU en una ubicación dentro de órdenes que aún no descontaron.
-- `reopened` ya descontó al completarse, así que no retiene estante.
CREATE OR REPLACE FUNCTION public.units_held_by_open_orders(
  p_sku text, p_warehouse text, p_location text, p_exclude_list uuid DEFAULT NULL
) RETURNS TABLE(list_id uuid, order_number text, units integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT pl.id, pl.order_number, SUM((it->>'pickingQty')::int)::int
  FROM picking_lists pl, jsonb_array_elements(COALESCE(pl.items, '[]'::jsonb)) it
  WHERE pl.status IN ('active', 'ready_to_double_check', 'double_checking', 'needs_correction')
    AND (p_exclude_list IS NULL OR pl.id <> p_exclude_list)
    AND it->>'sku' = p_sku
    AND COALESCE(it->>'warehouse', 'LUDLOW') = p_warehouse
    AND upper(trim(COALESCE(it->>'location', ''))) = upper(trim(p_location))
  GROUP BY pl.id, pl.order_number
  HAVING SUM((it->>'pickingQty')::int) > 0;
$function$;

-- Lo que se pide al personal es sólo lo que se puede contar AHORA (Rafael, 9 oct:
-- «con el SKU en una orden abierta debería no mostrar la alerta y filtrar para
-- que solo se pida recount de los que se pueden contar en ese momento»).
-- `held_by_orders` = órdenes abiertas que tienen ese SKU en esa ubicación.
-- Stock, el menú y Stock Count enseñan sólo `held_by_orders = 0`; Double Check
-- usa todas, porque ahí la orden que lo tiene es la del picker.
CREATE OR REPLACE VIEW public.v_recount_requests_open
WITH (security_invoker = true) AS
SELECT r.*,
  (SELECT count(DISTINCT pl.id)::int
     FROM picking_lists pl, jsonb_array_elements(COALESCE(pl.items, '[]'::jsonb)) it
    WHERE pl.status IN ('active', 'ready_to_double_check', 'double_checking', 'needs_correction')
      AND it->>'sku' = r.sku
      AND COALESCE(it->>'warehouse', 'LUDLOW') = r.warehouse
      AND upper(trim(COALESCE(it->>'location', ''))) = upper(trim(r.location))
      AND COALESCE((it->>'pickingQty')::int, 0) > 0) AS held_by_orders
FROM public.recount_requests r
WHERE r.status = 'open';
GRANT SELECT ON public.v_recount_requests_open TO authenticated;

-- Un conteo. Devuelve qué pasó: applied | matched | second_count.
CREATE OR REPLACE FUNCTION public.submit_recount(
  p_sku text, p_warehouse text, p_location text, p_counted integer,
  p_list_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_name text;
  v_loc text;
  v_item_id bigint;
  v_system integer;
  v_mine integer := 0;
  v_others text;
  v_target integer;
  v_delta integer;
  v_req public.recount_requests%ROWTYPE;
  v_snapshot jsonb;
  v_location_id uuid;
BEGIN
  IF p_counted IS NULL OR p_counted < 0 THEN
    RAISE EXCEPTION 'Count must be 0 or more' USING ERRCODE = '22023';
  END IF;

  SELECT location, id, quantity, location_id, row_to_json(inventory.*)::jsonb
    INTO v_loc, v_item_id, v_system, v_location_id, v_snapshot
  FROM inventory
  WHERE sku = p_sku AND warehouse = p_warehouse
    AND upper(trim(COALESCE(location, ''))) = upper(trim(p_location))
  FOR UPDATE;
  v_loc := COALESCE(v_loc, upper(trim(p_location)));
  v_system := COALESCE(v_system, 0);

  SELECT string_agg('#' || h.order_number, ', ') INTO v_others
  FROM public.units_held_by_open_orders(p_sku, p_warehouse, v_loc, p_list_id) h;
  IF v_others IS NOT NULL THEN
    RAISE EXCEPTION 'Open orders still hold % at %: %. Count after they ship.', p_sku, v_loc, v_others
      USING ERRCODE = '55006';
  END IF;

  IF p_list_id IS NOT NULL THEN
    SELECT COALESCE(SUM(h.units), 0) INTO v_mine
    FROM public.units_held_by_open_orders(p_sku, p_warehouse, v_loc) h
    WHERE h.list_id = p_list_id;
  END IF;

  -- Lo contado queda en el estante; lo de esta orden sigue en el sistema hasta completarla.
  v_target := p_counted + v_mine;
  v_delta := v_target - v_system;

  SELECT * INTO v_req FROM recount_requests
  WHERE sku = p_sku AND warehouse = p_warehouse AND status = 'open'
    AND upper(trim(location)) = upper(trim(v_loc))
  FOR UPDATE;

  IF v_req.first_counted_by IS NOT NULL AND v_req.first_counted_by = v_user AND abs(v_delta) > 5 THEN
    RAISE EXCEPTION 'Another person has to count this one' USING ERRCODE = '42501';
  END IF;

  IF abs(v_delta) > 5 AND v_req.first_counted_by IS NULL THEN
    IF v_req.id IS NULL THEN
      INSERT INTO recount_requests (sku, warehouse, location, reason, requested_by, first_counted_by, first_counted_qty)
      VALUES (p_sku, p_warehouse, v_loc,
              format('Second count: first count was off by %s', v_delta), v_user, v_user, p_counted)
      RETURNING * INTO v_req;
    ELSE
      UPDATE recount_requests SET first_counted_by = v_user, first_counted_qty = p_counted,
        reason = reason || format(' · Second count: first count was off by %s', v_delta)
      WHERE id = v_req.id;
    END IF;
    RETURN jsonb_build_object('result', 'second_count', 'counted', p_counted,
                              'system', v_system - v_mine, 'delta', v_delta);
  END IF;

  SELECT COALESCE(full_name, 'Unknown') INTO v_name FROM profiles WHERE id = v_user;

  IF v_delta <> 0 THEN
    PERFORM public.adjust_inventory_quantity(p_sku, p_warehouse, v_loc, v_delta,
      COALESCE(v_name, 'Unknown'), v_user, 'staff', NULL, NULL, NULL, true, NULL);
    SELECT id, location_id INTO v_item_id, v_location_id FROM inventory
    WHERE sku = p_sku AND warehouse = p_warehouse AND upper(trim(location)) = upper(trim(v_loc));
  END IF;

  PERFORM public.upsert_inventory_log(
    p_sku, p_warehouse, v_loc, p_warehouse, v_loc, v_delta, v_system, v_target, 'EDIT',
    -- snapshot_before: el Undo de History restaura la fila tal como estaba.
    v_item_id, v_location_id, v_location_id, COALESCE(v_name, 'Unknown'), v_user, p_list_id, NULL, v_snapshot, false,
    format('Recount: counted %s, system had %s', p_counted, v_system - v_mine), NULL);

  IF v_req.id IS NOT NULL THEN
    UPDATE recount_requests SET status = 'closed', closed_at = now(), closed_by = v_user,
      counted_qty = p_counted, expected_qty = v_system - v_mine, applied_delta = v_delta
    WHERE id = v_req.id;
  END IF;

  RETURN jsonb_build_object('result', CASE WHEN v_delta = 0 THEN 'matched' ELSE 'applied' END,
                            'counted', p_counted, 'system', v_system - v_mine, 'delta', v_delta);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.submit_recount(text, text, text, integer, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.units_held_by_open_orders(text, text, text, uuid) TO authenticated;

-- Pedir un recount: una por SKU y ubicación; si ya hay una abierta, no duplica.
CREATE OR REPLACE FUNCTION public.request_recount(
  p_sku text, p_warehouse text, p_location text, p_reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM recount_requests
  WHERE sku = p_sku AND warehouse = p_warehouse AND status = 'open'
    AND upper(trim(location)) = upper(trim(p_location));
  IF v_id IS NULL THEN
    INSERT INTO recount_requests (sku, warehouse, location, reason, requested_by)
    VALUES (p_sku, p_warehouse, upper(trim(p_location)), p_reason, auth.uid())
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.request_recount(text, text, text, text) TO authenticated;

-- Semilla (Rafael, 9 oct): los cinco que escribió el as400-sync del 14 sep y
-- nadie contó, y los dos que conservan unidades fantasma del auto-cancel.
-- Una petición por cada ubicación donde el SKU tiene unidades hoy; si no tiene
-- en ninguna (03-4637MN), en la última donde estuvo: contar un cero también vale.
WITH s(sku, reason) AS (VALUES
  ('03-4623BL', 'Written by AS400 sync (Sep 14), never counted'),
  ('03-4635MN', 'Written by AS400 sync (Sep 14), never counted'),
  ('03-4637MN', 'Written by AS400 sync (Sep 14), never counted'),
  ('03-4638RD', 'Written by AS400 sync (Sep 14), never counted'),
  ('03-4639MN', 'Written by AS400 sync (Sep 14), never counted'),
  ('03-4516BL', 'Phantom +1 from auto-cancel (Jul 11)'),
  ('06-4284TL', 'Phantom +3 from auto-cancel (Jul 16)')
), r AS (
  SELECT i.sku, i.warehouse, upper(trim(i.location)) AS location, i.quantity, i.updated_at, s.reason
  FROM s JOIN public.inventory i ON i.sku = s.sku AND i.warehouse = 'LUDLOW'
  WHERE i.location IS NOT NULL AND i.location !~ '^[0-9]{4}N$'
), pick AS (
  SELECT sku, warehouse, location, reason FROM r WHERE quantity > 0
  UNION ALL
  SELECT * FROM (
    SELECT DISTINCT ON (sku) sku, warehouse, location, reason FROM r
    WHERE NOT EXISTS (SELECT 1 FROM r r2 WHERE r2.sku = r.sku AND r2.quantity > 0)
    ORDER BY sku, updated_at DESC
  ) z
)
INSERT INTO public.recount_requests (sku, warehouse, location, reason)
SELECT sku, warehouse, location, reason FROM pick
ON CONFLICT DO NOTHING;
