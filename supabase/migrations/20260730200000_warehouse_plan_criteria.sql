-- Aptitude criteria for the block plan.
--
-- Candidates were ranked by quantity alone, so a bike that ships every week
-- outranked one that has never shipped, purely for being bigger. Order history
-- is what the floor actually cares about, and `get_sku_movement_stats` has
-- carried it all along — the block RPC just never returned it.
--
-- The thresholds are a *ranking* band, not a gate. Measured against production,
-- "0 orders and >= 21 units" describes 5 bikes for 54 assignable cells; used as
-- a filter it would empty the blocks, which is the problem the auto-fill exists
-- to solve. Inside the band ranks first, outside still gets placed.
--
-- The criteria are logically global — one pool feeds both blocks — but they
-- live on warehouse_block_settings rather than a new table, to avoid a second
-- RLS surface and another entry in each of the two generated type files. The
-- map writes both rows.

ALTER TABLE public.warehouse_block_settings
  ADD COLUMN IF NOT EXISTS max_orders integer NOT NULL DEFAULT 0
    CHECK (max_orders >= 0);

ALTER TABLE public.warehouse_block_settings
  ADD COLUMN IF NOT EXISTS min_stock integer NOT NULL DEFAULT 21
    CHECK (min_stock > 0);

COMMENT ON COLUMN public.warehouse_block_settings.max_orders IS
  'Orders in the last 12 months at or below which a bike is preferred. Ranking, not a filter.';
COMMENT ON COLUMN public.warehouse_block_settings.min_stock IS
  'Units at or above which a bike is preferred. Ranking, not a floor.';

-- Returns one more column, so the signature changes and REPLACE cannot be used.
DROP FUNCTION IF EXISTS public.get_bike_block_candidates(integer);

CREATE FUNCTION public.get_bike_block_candidates(p_recency_days integer DEFAULT 30)
RETURNS TABLE (
  sku text,
  item_name text,
  total_qty numeric,
  location text,
  sublocation text[],
  last_shipped timestamptz,
  orders_completed bigint,
  is_mover boolean,
  excluded_reason text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH stock AS (
    SELECT i.sku, sum(i.quantity) AS total_qty
    FROM public.inventory i
    JOIN public.sku_metadata md ON md.sku = i.sku AND md.is_bike
    WHERE i.is_active AND i.quantity > 0
    GROUP BY i.sku
  ),
  -- The cell holding most of the SKU's units: the one worth anchoring to, and
  -- the one that tells the manager which row to pull from.
  main_cell AS (
    SELECT DISTINCT ON (i.sku) i.sku, i.location, i.sublocation, i.item_name
    FROM public.inventory i
    WHERE i.is_active AND i.quantity > 0
    ORDER BY i.sku, i.quantity DESC
  )
  SELECT s.sku,
         c.item_name,
         s.total_qty,
         c.location,
         c.sublocation,
         m.last_shipped,
         m.orders_completed,
         (m.last_shipped IS NOT NULL
           AND m.last_shipped >= now() - make_interval(days => p_recency_days)) AS is_mover,
         x.reason
  FROM stock s
  JOIN main_cell c ON c.sku = s.sku
  LEFT JOIN public.warehouse_excluded_skus x ON x.sku = s.sku
  CROSS JOIN LATERAL public.get_sku_movement_stats(s.sku, now() - interval '12 months') m
  ORDER BY s.total_qty DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_bike_block_candidates(integer) TO authenticated, anon;
