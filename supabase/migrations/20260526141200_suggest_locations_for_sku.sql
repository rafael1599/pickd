-- suggest_locations_for_sku — given a SKU, rank destination locations
-- for a potential move/consolidation. Score is 0–100, weighted sum of:
--
--   velocity_match           : 40 pts  (SKU velocity tier ↔ row zone)
--   free_capacity_ratio      : 25 pts  (free_units / max_capacity)
--   consolidation_bonus      : 25 pts  (SKU already has stock in this row)
--   picking_order_proximity  : 10 pts  (close to row(s) where SKU lives)
--
-- The RPC also returns the SKU's current footprint (where it lives now
-- and how many units in each), the velocity tier we classified it into,
-- and short text reasons for the score so the UI can show "why".
--
-- Velocity tier classification (same alias-aware logic as
-- get_sku_movement_stats — picks up renames):
--   HOT   : orders_30d >= 5
--   WARM  : orders_30d >= 1
--   COLD  : orders_30d  = 0
--
-- Zone match scoring (zone is on locations.zone — HOT/WARM/COLD/UNASSIGNED):
--   exact match           → 40
--   one tier off          → 20
--   two tiers off (HOT↔COLD) →  0
--   row zone UNASSIGNED   → 10 (better than mismatch, worse than match)
--
-- Bay-level note (per CLAUDE.md context): the warehouse has bays that
-- stack 3–5 units high. That detail is NOT in the schema. We trust
-- locations.max_capacity as the row's total ceiling. If a row's
-- max_capacity is misconfigured (e.g. set to the default 550 when the
-- physical row only fits 100), the capacity score here will overstate
-- that row's suitability. Fix the row's max_capacity to fix the
-- recommendation; don't add complexity here.

CREATE OR REPLACE FUNCTION public.suggest_locations_for_sku(
  p_sku text,
  p_top_n int DEFAULT 10
)
RETURNS TABLE(
  -- SKU context (same on every row)
  sku_velocity_tier text,    -- 'HOT' | 'WARM' | 'COLD'
  sku_orders_30d   bigint,
  sku_orders_90d   bigint,
  sku_total_qty    integer,  -- current total units across all locations

  -- Suggestion
  location          text,
  zone              text,    -- HOT | WARM | COLD | UNASSIGNED | null
  picking_order     integer,
  max_capacity      integer,
  current_units     integer, -- sum of inventory.quantity at this location
  free_units        integer, -- max_capacity - current_units (clamped >= 0)
  has_same_sku      boolean,
  same_sku_qty      integer,

  -- Score and explanations
  score             integer, -- 0..100
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
  v_tier          text;
  v_total_qty     integer;
  v_current_locs  text[];      -- rows where SKU currently lives (non-zero qty)
  v_current_orders int[];      -- picking_order of those rows
BEGIN
  -- Resolve alias chain so a renamed SKU still picks up history.
  -- resolve_sku_chain is defined in 20260519120000_sku_alias_chain.sql.
  v_chain := public.resolve_sku_chain(p_sku);

  -- Movement stats (orders shipped, last 30 / 90 days) across alias chain.
  SELECT
    COUNT(DISTINCT pl.id) FILTER (WHERE pl.updated_at >= NOW() - INTERVAL '30 days'),
    COUNT(DISTINCT pl.id) FILTER (WHERE pl.updated_at >= NOW() - INTERVAL '90 days')
  INTO v_orders_30d, v_orders_90d
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

  -- Current footprint: where the SKU lives now (active rows only).
  -- We look up by the canonical alias the caller passed — alias_chain
  -- could span multiple physical rows after a rename, but the operator
  -- is moving the row they searched, not its historical aliases.
  SELECT
    COALESCE(SUM(quantity), 0)::integer,
    COALESCE(ARRAY_AGG(DISTINCT location) FILTER (WHERE quantity > 0), ARRAY[]::text[])
  INTO v_total_qty, v_current_locs
  FROM public.inventory
  WHERE sku = p_sku AND is_active = true;

  -- picking_order of the current locations (for proximity scoring).
  SELECT COALESCE(ARRAY_AGG(picking_order ORDER BY picking_order) FILTER (WHERE picking_order IS NOT NULL), ARRAY[]::int[])
  INTO v_current_orders
  FROM public.locations
  WHERE location = ANY(v_current_locs);

  RETURN QUERY
  WITH loc_summary AS (
    SELECT
      l.location,
      l.zone,
      l.picking_order,
      COALESCE(l.max_capacity, 0)            AS max_capacity,
      COALESCE(SUM(i.quantity), 0)::integer  AS current_units
    FROM public.locations l
    LEFT JOIN public.inventory i
      ON i.location = l.location AND i.is_active = true
    WHERE l.is_active IS NOT FALSE
      AND COALESCE(l.is_shipping_area, false) = false
    GROUP BY l.location, l.zone, l.picking_order, l.max_capacity
  ),
  sku_in_loc AS (
    SELECT location, COALESCE(SUM(quantity), 0)::integer AS same_qty
    FROM public.inventory
    WHERE sku = p_sku AND is_active = true
    GROUP BY location
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

      -- Velocity match: 40 pts max.
      CASE
        WHEN ls.zone = v_tier                         THEN 40
        WHEN ls.zone IS NULL OR ls.zone = 'UNASSIGNED'THEN 10
        WHEN (v_tier = 'HOT'  AND ls.zone = 'WARM')
          OR (v_tier = 'WARM' AND ls.zone = 'HOT')
          OR (v_tier = 'WARM' AND ls.zone = 'COLD')
          OR (v_tier = 'COLD' AND ls.zone = 'WARM')   THEN 20
        ELSE 0                                                 -- HOT↔COLD mismatch
      END AS velocity_pts,

      -- Capacity: 25 pts × (free_units / max_capacity). 0 if no max set.
      CASE
        WHEN ls.max_capacity > 0 THEN
          LEAST(
            25,
            FLOOR(25.0 * GREATEST(ls.max_capacity - ls.current_units, 0)::numeric / ls.max_capacity)
          )::int
        ELSE 0
      END AS capacity_pts,

      -- Consolidation bonus: +25 if SKU already lives here.
      CASE WHEN COALESCE(sl.same_qty, 0) > 0 THEN 25 ELSE 0 END AS consolidation_pts,

      -- Proximity: 10 × (1 - normalized distance to nearest current location).
      -- If SKU has no current locations, score 0 for everyone (neutral).
      -- Picking_order is integer-ish across the floor; we normalize by max - min
      -- across the candidate set in the outer query… but to keep this SQL flat,
      -- we use a fixed normalizer (10 picking-order units = max distance). This
      -- is a coarse heuristic; refine later if needed.
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

    -- Build the explanation array. Keep each reason short — UI puts them
    -- in chips. Skip empty reasons.
    ARRAY(
      SELECT r FROM (VALUES
        (CASE WHEN sc.velocity_pts = 40 THEN
              format('Velocity match (%s ↔ %s)', v_tier, sc.zone) END),
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

COMMENT ON FUNCTION public.suggest_locations_for_sku(text, int) IS
  'Rank destination locations for moving a SKU, scored 0-100 across velocity match, free capacity, same-SKU consolidation, and picking-order proximity.';
