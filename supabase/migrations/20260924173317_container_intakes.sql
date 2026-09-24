-- ============================================================================
-- El historial de containers, y su reporte contra lo que Ludlow tenía antes.
--
-- Hasta hoy un container no dejaba registro propio: sólo sus ADD sueltos en
-- inventory_logs, y el reporte de strapped pallets estaba atado a 6436N y
-- comparaba contra el stock de HOY — que, con el container ya repartido,
-- incluye las propias bicis del container (TOTAL las contaba dos veces).
--
-- 1. `container_intakes`: una fila por cada llamada a register_container (un
--    container puede registrarse en partes: la guarda sólo frena los SKUs que
--    ya tienen stock en la ubicación). Append-only; la escribe la RPC.
-- 2. register_container sella esa fila en la misma transacción.
-- 3. Relleno de los containers anteriores desde inventory_logs: todas las
--    líneas de una llamada comparten `created_at` (una transacción, un now()),
--    así que el PRIMER grupo de ADD de cada ubicación es su registro. Se
--    excluye lo que no es un registro: `system:%` (as400-sync, unpick) y lo
--    que trae order_number.
-- 4. `container_arrivals(container)`: lo que llegó = el registro + los ajustes
--    a mano (+ y −) hechos después en la ubicación del container. Un container
--    se registra antes de recibirlo y el día de la recepción se corrige la
--    lista a mano (Rafael, 24 sep 2026: 7005N). No cuentan los MOVE, lo que
--    sale para una orden (order_number / list_id) ni lo del sistema.
-- 5. `get_container_history()` y `get_container_report(container)`.
-- 6. El daily snapshot guarda la sublocation desde hoy: LOC lleva la letra del
--    cuadro en los containers nuevos; los anteriores salen sin ella.
--
-- «Lo que Ludlow tenía» es el último daily snapshot TOMADO antes del primer
-- registro del container. Se elige por la hora real de sus filas
-- (`created_at`), no por `snapshot_date`: el snapshot con fecha X se toma la
-- madrugada del día X+1 (~05:40–06:20 NY en septiembre de 2026), y un
-- container registrado antes de esa hora tiene que caer en el del día previo.
-- Ludlow excluye las ubicaciones de container (^\d{4}N$), UNKNOWN y las que
-- no son almacenamiento (`counts_as_storage = false`).
-- ============================================================================

CREATE TABLE public.container_intakes (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  container     text        NOT NULL,
  warehouse     text        NOT NULL DEFAULT 'LUDLOW',
  registered_at timestamptz NOT NULL DEFAULT now(),
  registered_by text,
  user_id       uuid,
  lines         jsonb       NOT NULL,   -- [{ "sku": "03-3995PD", "qty": 29 }, ...]
  skus          integer     NOT NULL,
  units         integer     NOT NULL,
  source        text        NOT NULL CHECK (source IN ('register_container', 'backfill'))
);

CREATE INDEX container_intakes_container_idx
  ON public.container_intakes (warehouse, container, registered_at);

COMMENT ON TABLE public.container_intakes IS
  'Una fila por registro de container (register_container o relleno desde inventory_logs). Append-only.';

ALTER TABLE public.container_intakes ENABLE ROW LEVEL SECURITY;

CREATE POLICY container_intakes_select_authenticated ON public.container_intakes
  FOR SELECT TO authenticated USING (true);
-- Sin políticas de INSERT/UPDATE/DELETE: sólo la escribe register_container
-- (SECURITY DEFINER) y esta migración.

-- La columna que get_container_report lee (ver 6.)
ALTER TABLE public.daily_inventory_snapshots
  ADD COLUMN IF NOT EXISTS sublocation text[];

-- ----------------------------------------------------------------------------
-- 2. register_container sella el registro
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_container(
  p_location text,
  p_items jsonb,
  p_user_id uuid,
  p_performed_by text,
  p_warehouse text DEFAULT 'LUDLOW'::text,
  p_order_number text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_location text := upper(trim(p_location));
  v_dup      text[];
  v_lines    jsonb;
  v_result   jsonb;
  v_id       bigint;
BEGIN
  IF v_location = '' OR v_location IS NULL THEN
    RAISE EXCEPTION 'Location is required' USING ERRCODE = '22023';
  END IF;

  -- Re-run guard, por SKU: se niega si alguno de los que llegan ya tiene stock
  -- en esta ubicación. Así un reenvío del manifiesto entero falla y una línea
  -- nueva sobre un contenedor a medio descargar entra.
  SELECT array_agg(DISTINCT i.sku ORDER BY i.sku) INTO v_dup
  FROM inventory i
  WHERE i.warehouse = p_warehouse
    AND upper(trim(coalesce(i.location, ''))) = v_location
    AND i.quantity > 0
    AND i.sku IN (SELECT canonical_sku FROM public.resolve_container_skus(p_items, p_warehouse));

  IF v_dup IS NOT NULL AND array_length(v_dup, 1) > 0 THEN
    RAISE EXCEPTION 'Location % already holds stock of % — aborting to avoid double-load: %',
      v_location, array_length(v_dup, 1), array_to_string(v_dup[1:5], ', ')
      USING ERRCODE = '23505';
  END IF;

  -- Las líneas se resuelven antes de escribir: después, `is_new` cambia, pero
  -- el SKU canónico y la cantidad son los mismos que va a escribir la carga.
  SELECT jsonb_agg(jsonb_build_object('sku', canonical_sku, 'qty', qty) ORDER BY canonical_sku)
    INTO v_lines
  FROM public.resolve_container_skus(p_items, p_warehouse);

  v_result := public.apply_intake_lines(
    p_location     => v_location,
    p_items        => p_items,
    p_user_id      => p_user_id,
    p_performed_by => p_performed_by,
    p_warehouse    => p_warehouse,
    p_order_number => p_order_number
  );

  INSERT INTO public.container_intakes
    (container, warehouse, registered_by, user_id, lines, skus, units, source)
  VALUES
    (v_location, p_warehouse, p_performed_by, p_user_id, coalesce(v_lines, '[]'::jsonb),
     coalesce((v_result->>'skus')::int, 0), coalesce((v_result->>'units')::int, 0),
     'register_container')
  RETURNING id INTO v_id;

  RETURN v_result || jsonb_build_object('intake_id', v_id);
END;
$function$;

COMMENT ON FUNCTION public.register_container(text, jsonb, uuid, text, text, text) IS
  'Registra la descarga de un contenedor en una ubicación vacía con guarda contra re-ejecución accidental (23505), y sella el registro en container_intakes.';

-- ----------------------------------------------------------------------------
-- 3. Relleno de los containers registrados antes de esta migración
-- ----------------------------------------------------------------------------
INSERT INTO public.container_intakes
  (container, warehouse, registered_at, registered_by, user_id, lines, skus, units, source)
SELECT
  g.container, g.warehouse, g.created_at, g.performed_by, g.user_id,
  jsonb_agg(jsonb_build_object('sku', g.sku, 'qty', g.qty) ORDER BY g.sku),
  count(*)::int,
  sum(g.qty)::int,
  'backfill'
FROM (
  SELECT upper(trim(l.to_location))              AS container,
         coalesce(l.to_warehouse, 'LUDLOW')      AS warehouse,
         l.created_at, l.performed_by, l.user_id, l.sku,
         sum(l.quantity_change)::int             AS qty
  FROM inventory_logs l
  WHERE l.action_type = 'ADD'
    AND l.quantity_change > 0
    AND upper(trim(l.to_location)) ~ '^\d{4}N$'
    AND l.order_number IS NULL
    AND coalesce(l.performed_by, '') NOT ILIKE 'system:%'
    AND coalesce(l.is_reversed, false) = false
  GROUP BY 1, 2, l.created_at, l.performed_by, l.user_id, l.sku
) g
WHERE g.created_at = (
  -- sólo la primera carga; lo que vino después son ajustes (container_arrivals)
  SELECT min(l2.created_at)
  FROM inventory_logs l2
  WHERE l2.action_type = 'ADD'
    AND l2.quantity_change > 0
    AND upper(trim(l2.to_location)) = g.container
    AND coalesce(l2.to_warehouse, 'LUDLOW') = g.warehouse
    AND l2.order_number IS NULL
    AND coalesce(l2.performed_by, '') NOT ILIKE 'system:%'
    AND coalesce(l2.is_reversed, false) = false
)
GROUP BY g.container, g.warehouse, g.created_at, g.performed_by, g.user_id;

-- ----------------------------------------------------------------------------
-- 4. Lo que llegó: registro + ajustes a mano
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.container_arrivals(
  p_container text,
  p_warehouse text DEFAULT 'LUDLOW'
)
RETURNS TABLE (sku text, qty integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH c AS (SELECT upper(trim(p_container)) AS name),
  intakes AS (
    SELECT ci.registered_at, ci.lines
    FROM container_intakes ci, c
    WHERE ci.container = c.name AND ci.warehouse = p_warehouse
  ),
  registered AS (
    SELECT l->>'sku' AS sku, (l->>'qty')::int AS qty
    FROM intakes i CROSS JOIN LATERAL jsonb_array_elements(i.lines) l
  ),
  -- Ajustes a mano en la ubicación del container, después del primer registro
  -- y fuera de la transacción de un registro (misma now() = mismo created_at).
  adjustments AS (
    SELECT lg.sku,
           CASE WHEN lg.action_type = 'ADD' THEN abs(lg.quantity_change)
                ELSE -abs(lg.quantity_change) END::int AS qty
    FROM inventory_logs lg, c
    WHERE lg.action_type IN ('ADD', 'DEDUCT')
      AND upper(trim(CASE WHEN lg.action_type = 'ADD' THEN lg.to_location
                          ELSE lg.from_location END)) = c.name
      AND coalesce(CASE WHEN lg.action_type = 'ADD' THEN lg.to_warehouse
                        ELSE lg.from_warehouse END, 'LUDLOW') = p_warehouse
      AND lg.created_at > (SELECT min(registered_at) FROM intakes)
      AND lg.created_at NOT IN (SELECT registered_at FROM intakes)
      AND lg.order_number IS NULL
      AND lg.list_id IS NULL
      AND coalesce(lg.performed_by, '') NOT ILIKE 'system:%'
      AND coalesce(lg.is_reversed, false) = false
  )
  SELECT u.sku, sum(u.qty)::int
  FROM (SELECT * FROM registered UNION ALL SELECT * FROM adjustments) u
  GROUP BY u.sku
  HAVING sum(u.qty) > 0;
$function$;

-- ----------------------------------------------------------------------------
-- 5a. Historial
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_container_history()
RETURNS TABLE (
  container           text,
  warehouse           text,
  first_registered_at timestamptz,
  last_registered_at  timestamptz,
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
    cs.container, cs.warehouse, cs.first_at, cs.last_at, cs.intakes,
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
-- 5b. Reporte de un container
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_container_report(
  p_container text,
  p_warehouse text DEFAULT 'LUDLOW'
)
RETURNS TABLE (
  sku                 text,
  arrived             integer,
  is_bike             boolean,
  ludlow_qty          integer,
  ludlow_locations    jsonb,   -- [{ "location": "ROW 23", "sublocation": ["C"], "qty": 16 }, ...]
  snapshot_date       date,
  snapshot_taken_at   timestamptz,
  first_registered_at timestamptz
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
  -- El último snapshot tomado del todo antes del primer registro.
  snap AS (
    SELECT s.snapshot_date, max(s.created_at) AS taken_at
    FROM daily_inventory_snapshots s
    WHERE s.warehouse = p_warehouse
    GROUP BY s.snapshot_date
    HAVING max(s.created_at) < (SELECT at FROM first_intake)
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
    LEFT JOIN locations loc
      ON loc.warehouse = s.warehouse AND loc.location = s.location
    WHERE s.warehouse = p_warehouse
      AND s.sku IN (SELECT a.sku FROM arrived a)
      AND upper(trim(s.location)) !~ '^\d{4}N$'
      AND upper(trim(s.location)) <> 'UNKNOWN'
      AND coalesce(loc.counts_as_storage, true)
      AND s.quantity > 0
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
    (SELECT snapshot_date FROM snap),
    (SELECT taken_at FROM snap),
    (SELECT at FROM first_intake)
  FROM arrived a
  LEFT JOIN sku_metadata sm ON sm.sku = a.sku
  ORDER BY a.qty DESC, a.sku;
$function$;

REVOKE ALL ON FUNCTION public.container_arrivals(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_container_history() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_container_report(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_container_history() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_container_report(text, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. El snapshot guarda la sublocation (la letra del cuadro). La columna se
--    crea arriba, antes de get_container_report, que la lee.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_daily_snapshot(
  p_snapshot_date date DEFAULT (public.current_ny_date() - 1)
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_count INTEGER;
BEGIN
  DELETE FROM daily_inventory_snapshots
  WHERE snapshot_date = p_snapshot_date;

  INSERT INTO daily_inventory_snapshots
    (snapshot_date, warehouse, location, sku, quantity, location_id, sku_note, sublocation)
  SELECT
    p_snapshot_date,
    warehouse,
    location,
    sku,
    quantity,
    location_id,
    item_name,
    sublocation
  FROM inventory
  WHERE is_active = TRUE
    AND quantity > 0
    AND location IS NOT NULL;  -- exclude orphaned rows from auto-cancel restore bug

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'success',       true,
    'snapshot_date', p_snapshot_date,
    'items_saved',   v_count,
    'created_at',    NOW()
  );
END;
$function$;
