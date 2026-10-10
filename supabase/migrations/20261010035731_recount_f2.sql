-- Recount F2: faltante en Edit Order es evidencia, confirmación de cero en completar,
-- y petición/cancelación de recount desde el menú (idea-263, docs/prds/recount-f2-study.md).
--
-- Rafael, 9 oct 2026:
-- 1. «Un faltante declarado por el picker en Edit Order no pide recount; es la evidencia.
--    Con Out of stock, la ubicación queda en 0 y se le avisa antes de guardar».
-- 2. «Si el picker se olvida de actualizar, al completar la orden PickD tiene que pedir
--    confirmación para registrar la cantidad como 0».
-- 3. «El recount queda para lo que nadie ha contado: el ⋯ de la tarjeta de Stock y de la ficha».

-- Columna aditiva para marcar cancelados
ALTER TABLE public.recount_requests ADD COLUMN IF NOT EXISTS cancelled boolean NOT NULL DEFAULT false;

-- Recrear vista con la columna nueva
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

-- RPC declare_shelf_short:
-- Deja la fila de inventario de esa ubicación en `p_keep + unidades que OTRAS órdenes abiertas tienen ahí`,
-- así la deducción al completar deja el estante en lo real.
-- Log EDIT con nota 'Short in #<orden>: <razón>' y snapshot_before (para Undo).
-- Si había un recount abierto para ese SKU/ubicación, ciérralo (es un conteo).
CREATE OR REPLACE FUNCTION public.declare_shelf_short(
  p_sku text,
  p_warehouse text,
  p_location text,
  p_list_id uuid,
  p_keep integer,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_name text;
  v_loc text;
  v_item_id bigint;
  v_system integer;
  v_location_id uuid;
  v_snapshot jsonb;
  v_others_units integer := 0;
  v_target integer;
  v_delta integer;
  v_order_number text;
BEGIN
  IF p_keep IS NULL OR p_keep < 0 THEN
    RAISE EXCEPTION 'Keep quantity must be 0 or more' USING ERRCODE = '22023';
  END IF;

  SELECT order_number INTO v_order_number FROM picking_lists WHERE id = p_list_id;

  SELECT location, id, quantity, location_id, row_to_json(inventory.*)::jsonb
    INTO v_loc, v_item_id, v_system, v_location_id, v_snapshot
  FROM inventory
  WHERE sku = p_sku AND warehouse = p_warehouse
    AND upper(trim(COALESCE(location, ''))) = upper(trim(p_location))
  FOR UPDATE;

  v_loc := COALESCE(v_loc, upper(trim(p_location)));
  v_system := COALESCE(v_system, 0);

  SELECT COALESCE(SUM(h.units), 0)::integer INTO v_others_units
  FROM public.units_held_by_open_orders(p_sku, p_warehouse, v_loc, p_list_id) h;

  v_target := p_keep + v_others_units;
  v_delta := v_target - v_system;

  SELECT COALESCE(full_name, 'Unknown') INTO v_name FROM profiles WHERE id = v_user;

  IF v_delta <> 0 THEN
    PERFORM public.adjust_inventory_quantity(p_sku, p_warehouse, v_loc, v_delta,
      COALESCE(v_name, 'Unknown'), v_user, 'staff', NULL, NULL, NULL, true, NULL);
    SELECT id, location_id INTO v_item_id, v_location_id FROM inventory
    WHERE sku = p_sku AND warehouse = p_warehouse AND upper(trim(location)) = upper(trim(v_loc));
  END IF;

  PERFORM public.upsert_inventory_log(
    p_sku, p_warehouse, v_loc, p_warehouse, v_loc, v_delta, v_system, v_target, 'EDIT',
    v_item_id, v_location_id, v_location_id, COALESCE(v_name, 'Unknown'), v_user, p_list_id, NULL, v_snapshot, false,
    format('Short in #%s: %s', COALESCE(v_order_number, 'unknown'), COALESCE(p_reason, 'shelf short')), NULL);

  UPDATE recount_requests
  SET status = 'closed',
      closed_at = now(),
      closed_by = v_user,
      counted_qty = p_keep,
      expected_qty = v_system,
      applied_delta = v_delta
  WHERE sku = p_sku AND warehouse = p_warehouse AND status = 'open'
    AND upper(trim(location)) = upper(trim(v_loc));

  RETURN jsonb_build_object(
    'sku', p_sku,
    'warehouse', p_warehouse,
    'location', v_loc,
    'keep', p_keep,
    'target', v_target,
    'delta', v_delta,
    'system_before', v_system
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.declare_shelf_short(text, text, text, uuid, integer, text) TO authenticated;

-- RPC cancel_recount:
-- Cancela una petición de recount abierta. Sólo el solicitante original o un admin pueden cancelarla.
CREATE OR REPLACE FUNCTION public.cancel_recount(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_req public.recount_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_req FROM recount_requests WHERE id = p_id FOR UPDATE;
  IF v_req.id IS NULL THEN
    RETURN;
  END IF;
  IF v_req.status = 'closed' THEN
    RETURN;
  END IF;
  IF v_req.requested_by IS DISTINCT FROM v_user AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized to cancel this recount request' USING ERRCODE = '42501';
  END IF;

  UPDATE recount_requests
  SET status = 'closed',
      closed_at = now(),
      closed_by = v_user,
      cancelled = true
  WHERE id = p_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.cancel_recount(uuid) TO authenticated;
