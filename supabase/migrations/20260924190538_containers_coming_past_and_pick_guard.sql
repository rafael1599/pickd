-- ============================================================================
-- Containers: «coming» y «past», y ninguna orden saca unidades de uno.
--
-- 1. La llegada no es el registro. Un container se registra por adelantado
--    (Rafael, 24 sep 2026: «registramos por adelantado un container que
--    sabemos que está por llegar… cuando llega se hacen los movimientos al
--    lugar donde se puso el contenido»). `container_arrived_at` fecha la
--    llegada en el primer día NY en que salió por MOVE al menos la mitad de lo
--    que trajo: un MOVE suelto de una bici (7006N, 16 sep: 1 de 261) no es la
--    descarga. Si ningún día llega a la mitad pero en total sí, cuenta el
--    primer MOVE (6430N, partes que se sacan de a poco); si el container está
--    vacío sin eso, su primera salida. Sin llegada = coming.
-- 2. El reporte de un container que llegó compara contra el último daily
--    snapshot tomado antes de la llegada; uno que viene, contra el stock de
--    ahora (`ludlow_source` = 'snapshot' | 'live').
-- 3. `adjust_inventory_quantity` se niega a que una orden (list_id u
--    order_number) descuente de un container con stock (23514).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.adjust_inventory_quantity(p_sku text, p_warehouse text, p_location text, p_delta integer, p_performed_by text, p_user_id uuid, p_user_role text DEFAULT 'staff'::text, p_list_id uuid DEFAULT NULL::uuid, p_order_number text DEFAULT NULL::text, p_merge_note text DEFAULT NULL::text, p_skip_log boolean DEFAULT false, p_internal_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_item_id INTEGER;
    v_location_id UUID;
    v_location_name TEXT;
    v_prev_qty INTEGER;
    v_new_qty INTEGER;
    v_actual_delta INTEGER;
    v_snapshot JSONB;
BEGIN
    -- ─── Defensive guard (added in migration 20260410130000) ──────────────
    IF p_location IS NULL OR TRIM(p_location) = '' THEN
        IF p_delta > 0 THEN
            RAISE EXCEPTION 'adjust_inventory_quantity called with NULL/empty location for SKU % and positive delta % — refusing to create phantom inventory. Caller: %, list_id: %, order: %',
                p_sku, p_delta, p_performed_by, p_list_id, p_order_number;
        ELSIF p_delta < 0 THEN
            RAISE WARNING 'adjust_inventory_quantity called with NULL/empty location for SKU % and DEDUCT delta % — proceeding but this likely indicates upstream data quality issue. Caller: %, list_id: %, order: %',
                p_sku, p_delta, p_performed_by, p_list_id, p_order_number;
        END IF;
    END IF;

    v_location_id := public.resolve_location(p_warehouse, p_location, p_user_role);
    SELECT location INTO v_location_name FROM locations WHERE id = v_location_id;

    IF v_location_id IS NOT NULL AND v_location_name IS NULL THEN
        v_location_name := UPPER(TRIM(p_location));
    END IF;

    v_actual_delta := p_delta;

    SELECT id, quantity, row_to_json(inventory.*)::jsonb INTO v_item_id, v_prev_qty, v_snapshot
    FROM inventory
    WHERE sku = p_sku
      AND warehouse = p_warehouse
      AND UPPER(TRIM(COALESCE(location, ''))) = UPPER(TRIM(COALESCE(v_location_name, '')))
    FOR UPDATE;

    -- ─── Un container no es un estante para una orden (20260924) ──────────
    -- Rafael, 24 sep 2026: «las órdenes no deben tomar items de un container».
    -- La app ya no planea picks desde un `NNNNN` (isWarehouseContainer), pero
    -- una ubicación escrita a mano llegaba hasta aquí y se descontaba. Sólo
    -- frena lo que de verdad sacaría unidades: una línea que apunta a un
    -- container ya vacío no descuenta nada y se deja pasar.
    IF p_delta < 0
       AND (p_list_id IS NOT NULL OR p_order_number IS NOT NULL)
       AND UPPER(TRIM(COALESCE(v_location_name, p_location, ''))) ~ '^[0-9]{4}N$'
       AND COALESCE(v_prev_qty, 0) > 0 THEN
        RAISE EXCEPTION 'Container % is not a shelf: order % cannot take % x % from it. Move the units to a shelf first.',
            UPPER(TRIM(COALESCE(v_location_name, p_location))), COALESCE(p_order_number, p_list_id::text), -p_delta, p_sku
            USING ERRCODE = '23514';
    END IF;

    IF v_item_id IS NULL THEN
        v_prev_qty := 0;
        IF p_delta < 0 THEN
            v_actual_delta := 0;
            v_new_qty := 0;
        ELSE
            v_new_qty := p_delta;
        END IF;

        -- A new row is named after its SKU's other rows, never after the
        -- note that created it (bug-018: 'auto-restore on cancel' used to
        -- become the item's name and from there the catalog model).
        INSERT INTO inventory (sku, warehouse, location, location_id, quantity, is_active, item_name, internal_note)
        VALUES (p_sku, p_warehouse, v_location_name, v_location_id, v_new_qty, (v_new_qty > 0),
                (SELECT i.item_name FROM inventory i
                  WHERE i.sku = p_sku AND i.item_name IS NOT NULL AND LENGTH(TRIM(i.item_name)) > 0
                  ORDER BY i.quantity DESC NULLS LAST, i.updated_at DESC NULLS LAST
                  LIMIT 1),
                COALESCE(p_internal_note, NULLIF(TRIM(p_merge_note), '')))
        RETURNING id INTO v_item_id;
    ELSE
        v_new_qty := v_prev_qty + p_delta;
        IF v_new_qty < 0 THEN
            v_new_qty := 0;
            v_actual_delta := -v_prev_qty;
        END IF;

        UPDATE inventory SET
            quantity    = v_new_qty,
            location_id = v_location_id,
            location    = v_location_name,
            -- Bidirectional: activate when stock arrives, deactivate when depleted
            is_active   = (v_new_qty > 0),
            updated_at  = NOW(),
            -- The merge note is a note: it goes to internal_note (once per
            -- distinct note), and item_name is never touched by a stock move.
            internal_note = CASE
                WHEN p_internal_note IS NOT NULL THEN p_internal_note
                WHEN p_merge_note IS NOT NULL AND LENGTH(TRIM(p_merge_note)) > 0 THEN
                    CASE
                        WHEN internal_note IS NULL OR LENGTH(TRIM(internal_note)) = 0 THEN p_merge_note
                        WHEN internal_note NOT LIKE '%' || p_merge_note || '%' THEN internal_note || ' | ' || p_merge_note
                        ELSE internal_note
                    END
                ELSE internal_note
            END
        WHERE id = v_item_id;

        -- Adjust distribution when deducting
        IF v_actual_delta < 0 THEN
            PERFORM public.adjust_distribution(v_item_id, (-v_actual_delta));
        END IF;
    END IF;

    IF NOT p_skip_log AND v_actual_delta != 0 THEN
        PERFORM public.upsert_inventory_log(
            p_sku, p_warehouse, v_location_name, p_warehouse, v_location_name,
            v_actual_delta, v_prev_qty, v_new_qty, (CASE WHEN v_actual_delta > 0 THEN 'ADD' ELSE 'DEDUCT' END),
            v_item_id, v_location_id, v_location_id, p_performed_by, p_user_id, p_list_id, p_order_number, v_snapshot
        );
    END IF;

    RETURN (SELECT row_to_json(i)::jsonb FROM inventory i WHERE id = v_item_id);
END;
$function$;

-- ----------------------------------------------------------------------------
-- La llegada
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.container_arrived_at(
  p_container text,
  p_warehouse text DEFAULT 'LUDLOW'
)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH c AS (SELECT upper(trim(p_container)) AS name),
  first_reg AS (
    SELECT min(ci.registered_at) AS at
    FROM container_intakes ci, c
    WHERE ci.container = c.name AND ci.warehouse = p_warehouse
  ),
  total AS (
    SELECT coalesce(sum(a.qty), 0) AS units
    FROM public.container_arrivals(p_container, p_warehouse) a
  ),
  outflow AS (
    SELECT lg.created_at, lg.action_type, abs(lg.quantity_change) AS q
    FROM inventory_logs lg, c
    WHERE upper(trim(lg.from_location)) = c.name
      AND coalesce(lg.from_warehouse, 'LUDLOW') = p_warehouse
      AND lg.created_at >= (SELECT at FROM first_reg)
      AND coalesce(lg.is_reversed, false) = false
      AND (lg.action_type = 'MOVE' OR lg.quantity_change < 0)
  ),
  move_days AS (
    SELECT (o.created_at AT TIME ZONE 'America/New_York')::date AS d,
           min(o.created_at) AS first_at, sum(o.q) AS q
    FROM outflow o
    WHERE o.action_type = 'MOVE'
    GROUP BY 1
  ),
  remaining AS (
    SELECT coalesce(sum(i.quantity), 0) AS units
    FROM inventory i, c
    WHERE i.warehouse = p_warehouse AND upper(trim(i.location)) = c.name AND i.quantity > 0
  )
  SELECT CASE WHEN (SELECT units FROM total) <= 0 THEN NULL ELSE coalesce(
    (SELECT min(md.first_at) FROM move_days md WHERE md.q * 2 >= (SELECT units FROM total)),
    (SELECT min(md.first_at) FROM move_days md
      WHERE (SELECT sum(q) FROM move_days) * 2 >= (SELECT units FROM total)),
    (SELECT min(o.created_at) FROM outflow o WHERE (SELECT units FROM remaining) = 0)
  ) END;
$function$;

REVOKE ALL ON FUNCTION public.container_arrived_at(text, text) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Historial, con la llegada (la firma cambia: DROP + CREATE)
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_container_history();

CREATE FUNCTION public.get_container_history()
RETURNS TABLE (
  container           text,
  warehouse           text,
  first_registered_at timestamptz,
  last_registered_at  timestamptz,
  arrived_at          timestamptz,   -- NULL = coming
  intakes             integer,
  skus                integer,
  units               integer,
  bikes               integer,
  parts               integer,
  registered_by       text[],
  remaining_units     integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH cs AS (
    SELECT ci.container, ci.warehouse,
           min(ci.registered_at) AS first_at,
           max(ci.registered_at) AS last_at,
           count(*)::int         AS intakes,
           array_agg(DISTINCT ci.registered_by) FILTER (WHERE ci.registered_by IS NOT NULL) AS who
    FROM container_intakes ci
    GROUP BY ci.container, ci.warehouse
  )
  SELECT
    cs.container, cs.warehouse, cs.first_at, cs.last_at,
    public.container_arrived_at(cs.container, cs.warehouse),
    cs.intakes,
    count(a.sku)::int,
    coalesce(sum(a.qty), 0)::int,
    coalesce(sum(a.qty) FILTER (WHERE coalesce(sm.is_bike, true)), 0)::int,
    coalesce(sum(a.qty) FILTER (WHERE sm.is_bike = false), 0)::int,
    cs.who,
    coalesce((SELECT sum(i.quantity)::int FROM inventory i
               WHERE i.warehouse = cs.warehouse
                 AND upper(trim(i.location)) = cs.container
                 AND i.quantity > 0), 0)
  FROM cs
  LEFT JOIN LATERAL public.container_arrivals(cs.container, cs.warehouse) a ON true
  LEFT JOIN sku_metadata sm ON sm.sku = a.sku
  GROUP BY cs.container, cs.warehouse, cs.first_at, cs.last_at, cs.intakes, cs.who
  ORDER BY cs.first_at DESC;
$function$;

-- ----------------------------------------------------------------------------
-- Reporte: snapshot antes de la llegada, o stock de ahora si todavía viene
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_container_report(text, text);

CREATE FUNCTION public.get_container_report(
  p_container text,
  p_warehouse text DEFAULT 'LUDLOW'
)
RETURNS TABLE (
  sku                 text,
  arrived             integer,
  is_bike             boolean,
  ludlow_qty          integer,
  ludlow_locations    jsonb,   -- [{ "location": "ROW 23", "sublocation": ["C"], "qty": 16 }, ...]
  ludlow_source       text,    -- 'snapshot' (llegó) | 'live' (viene)
  snapshot_date       date,
  snapshot_taken_at   timestamptz,
  first_registered_at timestamptz,
  arrived_at          timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH first_intake AS (
    SELECT min(registered_at) AS at
    FROM container_intakes
    WHERE container = upper(trim(p_container)) AND warehouse = p_warehouse
  ),
  arr AS (SELECT public.container_arrived_at(p_container, p_warehouse) AS at),
  -- El último snapshot tomado del todo antes de la llegada.
  snap AS (
    SELECT s.snapshot_date, max(s.created_at) AS taken_at
    FROM daily_inventory_snapshots s
    WHERE s.warehouse = p_warehouse
      AND (SELECT at FROM arr) IS NOT NULL
    GROUP BY s.snapshot_date
    HAVING max(s.created_at) < (SELECT at FROM arr)
    ORDER BY s.snapshot_date DESC
    LIMIT 1
  ),
  arrived AS (
    SELECT * FROM public.container_arrivals(p_container, p_warehouse)
  ),
  lraw AS (
    SELECT s.sku, s.location, s.quantity, s.sublocation
    FROM daily_inventory_snapshots s
    JOIN snap ON snap.snapshot_date = s.snapshot_date
    LEFT JOIN locations loc ON loc.warehouse = s.warehouse AND loc.location = s.location
    WHERE s.warehouse = p_warehouse
      AND s.sku IN (SELECT a.sku FROM arrived a)
      AND upper(trim(s.location)) !~ '^\d{4}N$'
      AND upper(trim(s.location)) <> 'UNKNOWN'
      AND coalesce(loc.counts_as_storage, true)
      AND s.quantity > 0
    UNION ALL
    SELECT i.sku, i.location, i.quantity, i.sublocation
    FROM inventory i
    LEFT JOIN locations loc ON loc.warehouse = i.warehouse AND loc.location = i.location
    WHERE (SELECT at FROM arr) IS NULL
      AND i.warehouse = p_warehouse
      AND i.is_active
      AND i.quantity > 0
      AND i.sku IN (SELECT a.sku FROM arrived a)
      AND upper(trim(i.location)) !~ '^\d{4}N$'
      AND upper(trim(i.location)) <> 'UNKNOWN'
      AND coalesce(loc.counts_as_storage, true)
  ),
  lsub AS (
    SELECT r.sku, r.location, array_agg(DISTINCT u ORDER BY u) AS subs
    FROM lraw r CROSS JOIN LATERAL unnest(coalesce(r.sublocation, '{}'::text[])) u
    GROUP BY r.sku, r.location
  ),
  ludlow AS (
    SELECT r.sku, r.location, sum(r.quantity)::int AS qty,
           coalesce(ls.subs, '{}'::text[]) AS subs
    FROM lraw r
    LEFT JOIN lsub ls ON ls.sku = r.sku AND ls.location = r.location
    GROUP BY r.sku, r.location, ls.subs
  )
  SELECT
    a.sku,
    a.qty,
    coalesce(sm.is_bike, true),
    coalesce((SELECT sum(lu.qty)::int FROM ludlow lu WHERE lu.sku = a.sku), 0),
    coalesce((SELECT jsonb_agg(jsonb_build_object('location', lu.location,
                                                  'sublocation', to_jsonb(lu.subs),
                                                  'qty', lu.qty)
                               ORDER BY lu.location)
              FROM ludlow lu WHERE lu.sku = a.sku), '[]'::jsonb),
    CASE WHEN (SELECT at FROM arr) IS NULL THEN 'live' ELSE 'snapshot' END,
    (SELECT snapshot_date FROM snap),
    (SELECT taken_at FROM snap),
    (SELECT at FROM first_intake),
    (SELECT at FROM arr)
  FROM arrived a
  LEFT JOIN sku_metadata sm ON sm.sku = a.sku
  ORDER BY a.qty DESC, a.sku;
$function$;

REVOKE ALL ON FUNCTION public.get_container_history() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_container_report(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_container_history() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_container_report(text, text) TO authenticated;
