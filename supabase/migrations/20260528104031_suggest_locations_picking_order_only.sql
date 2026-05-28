-- idea-118 rework: drop zone (HOT/WARM/COLD) entirely. Rank purely by
-- picking_order aligned to the SKU's movement.
--
-- Operator's model: picking_order is the single source of truth for "where
-- things go". Slow-moving SKUs belong at the LOWEST picking_order (e.g. ROW
-- 32 = 120, ROW 31 = 130); fast movers at the HIGHEST (ROW 45 = 670, ROW 47
-- = 690). Zone labels were redundant noise on top of this.
--
-- New scoring (no zone):
--   position_pts (0-60): how close the row's picking_order is to the SKU's
--     ideal slot. ideal = min_po + velocity_factor * (max_po - min_po), where
--     velocity_factor scales 0 (no recent orders) → 1 (5+ orders / 30d).
--   capacity_pts (0-20): free capacity ratio.
--   consolidation_pts (0/20): SKU already lives here.
--
-- Velocity is still computed (orders/30d) to decide the target position, but
-- it is NOT returned as a label — the UI shows a plain ranked list.

DROP FUNCTION IF EXISTS public.suggest_locations_for_sku(text, int);

CREATE OR REPLACE FUNCTION public.suggest_locations_for_sku(
  p_sku text,
  p_top_n int DEFAULT 10
)
RETURNS TABLE(
  sku_orders_30d   bigint,
  sku_orders_90d   bigint,
  sku_total_qty    integer,
  sku_last_order_at timestamptz,
  location          text,
  picking_order     integer,
  max_capacity      integer,
  current_units     integer,
  free_units        integer,
  has_same_sku      boolean,
  same_sku_qty      integer,
  score             integer,
  position_pts      integer,
  capacity_pts      integer,
  consolidation_pts integer,
  reasons           text[]
)
LANGUAGE plpgsql STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_chain          text[];
  v_orders_30d     bigint;
  v_orders_90d     bigint;
  v_last_order     timestamptz;
  v_total_qty      integer;
  v_min_po         numeric;
  v_max_po         numeric;
  v_span           numeric;
  v_velocity_factor numeric;
  v_target_po      numeric;
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

  SELECT COALESCE(SUM(inv.quantity), 0)::integer
  INTO v_total_qty
  FROM public.inventory inv
  WHERE inv.sku = p_sku AND inv.is_active = true;

  -- Real picking_order span across ROW locations. Exclude the 999 sentinel
  -- (unplaced rows) so it doesn't skew the target.
  SELECT MIN(l.picking_order), MAX(l.picking_order)
  INTO v_min_po, v_max_po
  FROM public.locations l
  WHERE l.location ILIKE 'ROW%'
    AND l.is_active IS NOT FALSE
    AND COALESCE(l.is_shipping_area, false) = false
    AND l.picking_order IS NOT NULL
    AND l.picking_order < 999;

  v_min_po := COALESCE(v_min_po, 0);
  v_max_po := COALESCE(v_max_po, v_min_po + 1);
  v_span := GREATEST(v_max_po - v_min_po, 1);

  -- 0 orders → slowest → target lowest picking_order. 5+ orders → fastest →
  -- target highest picking_order. Linear in between.
  v_velocity_factor := LEAST(1.0, GREATEST(0.0, v_orders_30d::numeric / 5.0));
  v_target_po := v_min_po + v_velocity_factor * v_span;

  RETURN QUERY
  WITH loc_summary AS (
    SELECT
      l.location::text  AS location,
      l.picking_order,
      COALESCE(l.max_capacity, 0)            AS max_capacity,
      COALESCE(SUM(i.quantity), 0)::integer  AS current_units
    FROM public.locations l
    LEFT JOIN public.inventory i
      ON i.location = l.location AND i.is_active = true
    WHERE l.is_active IS NOT FALSE
      AND COALESCE(l.is_shipping_area, false) = false
      AND l.location ILIKE 'ROW%'
    GROUP BY l.location, l.picking_order, l.max_capacity
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
      ls.picking_order,
      ls.max_capacity,
      ls.current_units,
      GREATEST(ls.max_capacity - ls.current_units, 0) AS free_units,
      COALESCE(sl.same_qty, 0) > 0                    AS has_same_sku,
      COALESCE(sl.same_qty, 0)                        AS same_sku_qty,

      -- Position match: 60 pts max, decaying with distance from target.
      -- Rows without a picking_order (or the 999 sentinel) get 0.
      CASE
        WHEN ls.picking_order IS NULL OR ls.picking_order >= 999 THEN 0
        ELSE ROUND(
          60 * (1 - LEAST(1, ABS(ls.picking_order - v_target_po) / v_span))
        )::int
      END AS position_pts,

      -- Capacity: 20 pts × (free / max). 0 if no max set.
      CASE
        WHEN ls.max_capacity > 0 THEN
          LEAST(20, FLOOR(20.0 * GREATEST(ls.max_capacity - ls.current_units, 0)::numeric / ls.max_capacity))::int
        ELSE 0
      END AS capacity_pts,

      -- Consolidation: +20 if the SKU already lives here.
      CASE WHEN COALESCE(sl.same_qty, 0) > 0 THEN 20 ELSE 0 END AS consolidation_pts
    FROM loc_summary ls
    LEFT JOIN sku_in_loc sl USING (location)
  )
  SELECT
    v_orders_30d                    AS sku_orders_30d,
    v_orders_90d                    AS sku_orders_90d,
    v_total_qty                     AS sku_total_qty,
    v_last_order                    AS sku_last_order_at,
    sc.location,
    sc.picking_order,
    sc.max_capacity,
    sc.current_units,
    sc.free_units,
    sc.has_same_sku,
    sc.same_sku_qty,
    LEAST(100, sc.position_pts + sc.capacity_pts + sc.consolidation_pts) AS score,
    sc.position_pts,
    sc.capacity_pts,
    sc.consolidation_pts,
    ARRAY(
      SELECT r FROM (VALUES
        (CASE WHEN sc.has_same_sku THEN
              format('Already %s units of this SKU here', sc.same_sku_qty) END),
        (CASE WHEN sc.position_pts >= 45 THEN
              'Good spot for how often this SKU moves' END),
        (CASE WHEN sc.free_units > 0 AND sc.max_capacity > 0 THEN
              format('%s free units of %s', sc.free_units, sc.max_capacity) END),
        (CASE WHEN sc.free_units = 0 AND sc.max_capacity > 0 THEN
              'Row is full' END)
      ) AS t(r)
      WHERE r IS NOT NULL
    ) AS reasons
  FROM scored sc
  ORDER BY
    (sc.position_pts + sc.capacity_pts + sc.consolidation_pts) DESC,
    sc.picking_order ASC NULLS LAST
  LIMIT GREATEST(p_top_n, 1);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.suggest_locations_for_sku(text, int)
  TO anon, authenticated, service_role;
