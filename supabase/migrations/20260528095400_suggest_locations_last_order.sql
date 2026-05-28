-- idea-118 follow-up: add sku_last_order_at to suggest_locations_for_sku.
--
-- The client previously computed "Last order" with a separate query that
-- matched only the LITERAL sku, while the 30/90d order counts inside this RPC
-- use the full alias chain (resolve_sku_chain). For a renamed SKU that meant
-- "1 order / 90d" but "Last order: never" — a confusing contradiction.
--
-- Fix: compute MAX(updated_at) across the same alias chain + completed status
-- and return it, so the client reads one consistent source. Everything else
-- identical to 20260528083212 (ROW-only destinations).

-- Adding a column to RETURNS TABLE changes the function's return type, which
-- CREATE OR REPLACE rejects (42P13). Drop first, then recreate.
DROP FUNCTION IF EXISTS public.suggest_locations_for_sku(text, int);

CREATE OR REPLACE FUNCTION public.suggest_locations_for_sku(
  p_sku text,
  p_top_n int DEFAULT 10
)
RETURNS TABLE(
  sku_velocity_tier text,
  sku_orders_30d   bigint,
  sku_orders_90d   bigint,
  sku_total_qty    integer,
  sku_last_order_at timestamptz,
  location          text,
  zone              text,
  picking_order     integer,
  max_capacity      integer,
  current_units     integer,
  free_units        integer,
  has_same_sku      boolean,
  same_sku_qty      integer,
  score             integer,
  velocity_pts      integer,
  capacity_pts      integer,
  consolidation_pts integer,
  proximity_pts     integer,
  reasons           text[]
)
LANGUAGE plpgsql STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_chain         text[];
  v_orders_30d    bigint;
  v_orders_90d    bigint;
  v_last_order    timestamptz;
  v_tier          text;
  v_total_qty     integer;
  v_current_locs  text[];
  v_current_orders int[];
BEGIN
  v_chain := public.resolve_sku_chain(p_sku);

  SELECT
    COUNT(DISTINCT pl.id) FILTER (WHERE pl.updated_at >= NOW() - INTERVAL '30 days'),
    COUNT(DISTINCT pl.id) FILTER (WHERE pl.updated_at >= NOW() - INTERVAL '90 days'),
    MAX(pl.updated_at)
  INTO v_orders_30d, v_orders_90d, v_last_order
  FROM public.picking_lists pl,
       jsonb_array_elements(COALESCE(pl.items, '[]'::jsonb)) it
  WHERE pl.status = 'completed'
    AND (it->>'sku') = ANY(v_chain);

  v_orders_30d := COALESCE(v_orders_30d, 0);
  v_orders_90d := COALESCE(v_orders_90d, 0);

  v_tier := CASE
    WHEN v_orders_30d >= 5 THEN 'HOT'
    WHEN v_orders_30d >= 1 THEN 'WARM'
    ELSE 'COLD'
  END;

  SELECT
    COALESCE(SUM(inv.quantity), 0)::integer,
    COALESCE(ARRAY_AGG(DISTINCT inv.location) FILTER (WHERE inv.quantity > 0), ARRAY[]::text[])
  INTO v_total_qty, v_current_locs
  FROM public.inventory inv
  WHERE inv.sku = p_sku AND inv.is_active = true;

  SELECT COALESCE(ARRAY_AGG(loc.picking_order ORDER BY loc.picking_order) FILTER (WHERE loc.picking_order IS NOT NULL), ARRAY[]::int[])
  INTO v_current_orders
  FROM public.locations loc
  WHERE loc.location = ANY(v_current_locs);

  RETURN QUERY
  WITH loc_summary AS (
    SELECT
      l.location::text  AS location,
      l.zone::text      AS zone,
      l.picking_order,
      COALESCE(l.max_capacity, 0)            AS max_capacity,
      COALESCE(SUM(i.quantity), 0)::integer  AS current_units
    FROM public.locations l
    LEFT JOIN public.inventory i
      ON i.location = l.location AND i.is_active = true
    WHERE l.is_active IS NOT FALSE
      AND COALESCE(l.is_shipping_area, false) = false
      AND l.location ILIKE 'ROW%'
    GROUP BY l.location, l.zone, l.picking_order, l.max_capacity
  ),
  sku_in_loc AS (
    SELECT inv.location::text AS location, COALESCE(SUM(inv.quantity), 0)::integer AS same_qty
    FROM public.inventory inv
    WHERE inv.sku = p_sku AND inv.is_active = true
    GROUP BY inv.location
  ),
  scored AS (
    SELECT
      ls.location,
      ls.zone,
      ls.picking_order,
      ls.max_capacity,
      ls.current_units,
      GREATEST(ls.max_capacity - ls.current_units, 0) AS free_units,
      COALESCE(sl.same_qty, 0) > 0                    AS has_same_sku,
      COALESCE(sl.same_qty, 0)                        AS same_sku_qty,
      CASE
        WHEN ls.zone = v_tier                         THEN 40
        WHEN ls.zone IS NULL OR ls.zone = 'UNASSIGNED'THEN 10
        WHEN (v_tier = 'HOT'  AND ls.zone = 'WARM')
          OR (v_tier = 'WARM' AND ls.zone = 'HOT')
          OR (v_tier = 'WARM' AND ls.zone = 'COLD')
          OR (v_tier = 'COLD' AND ls.zone = 'WARM')   THEN 20
        ELSE 0
      END AS velocity_pts,
      CASE
        WHEN ls.max_capacity > 0 THEN
          LEAST(
            25,
            FLOOR(25.0 * GREATEST(ls.max_capacity - ls.current_units, 0)::numeric / ls.max_capacity)
          )::int
        ELSE 0
      END AS capacity_pts,
      CASE WHEN COALESCE(sl.same_qty, 0) > 0 THEN 25 ELSE 0 END AS consolidation_pts,
      CASE
        WHEN array_length(v_current_orders, 1) IS NULL OR ls.picking_order IS NULL THEN 0
        ELSE GREATEST(
          0,
          10 - LEAST(
            10,
            (SELECT MIN(ABS(ls.picking_order - co)) FROM unnest(v_current_orders) AS co)::int
          )
        )
      END AS proximity_pts
    FROM loc_summary ls
    LEFT JOIN sku_in_loc sl USING (location)
  )
  SELECT
    v_tier                          AS sku_velocity_tier,
    v_orders_30d                    AS sku_orders_30d,
    v_orders_90d                    AS sku_orders_90d,
    v_total_qty                     AS sku_total_qty,
    v_last_order                    AS sku_last_order_at,
    sc.location,
    sc.zone,
    sc.picking_order,
    sc.max_capacity,
    sc.current_units,
    sc.free_units,
    sc.has_same_sku,
    sc.same_sku_qty,
    LEAST(100, sc.velocity_pts + sc.capacity_pts + sc.consolidation_pts + sc.proximity_pts) AS score,
    sc.velocity_pts,
    sc.capacity_pts,
    sc.consolidation_pts,
    sc.proximity_pts,
    ARRAY(
      SELECT r FROM (VALUES
        (CASE WHEN sc.velocity_pts = 40 THEN
              format('Velocity match (%s <-> %s)', v_tier, sc.zone) END),
        (CASE WHEN sc.has_same_sku THEN
              format('Already %s units of this SKU here', sc.same_sku_qty) END),
        (CASE WHEN sc.free_units > 0 AND sc.max_capacity > 0 THEN
              format('%s free units of %s', sc.free_units, sc.max_capacity) END),
        (CASE WHEN sc.proximity_pts >= 8 THEN
              'Close to current location' END),
        (CASE WHEN sc.velocity_pts = 0 AND v_tier IS NOT NULL AND sc.zone IS NOT NULL THEN
              format('Velocity mismatch (%s SKU in %s row)', v_tier, sc.zone) END),
        (CASE WHEN sc.free_units = 0 AND sc.max_capacity > 0 THEN
              'Row is full' END)
      ) AS t(r)
      WHERE r IS NOT NULL
    ) AS reasons
  FROM scored sc
  ORDER BY
    (sc.velocity_pts + sc.capacity_pts + sc.consolidation_pts + sc.proximity_pts) DESC,
    sc.free_units DESC
  LIMIT GREATEST(p_top_n, 1);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.suggest_locations_for_sku(text, int)
  TO anon, authenticated, service_role;
