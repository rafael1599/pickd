-- Widens the DS-Pallet candidate pool past the block's own rows.
--
-- The blocks cannot be filled from what already sits in them: ROW 28-33 holds
-- 8 non-mover SKUs that reach a pallet, for 54 assignable cells. Every other
-- pallet has to be hauled in from elsewhere in the warehouse, which the
-- classification screen had no way to even list — it only ever queried the
-- block's own rows.
--
-- Two things this needs that the block-scoped query did not:
--
--   1. `is_bike`, not the SKU prefix. Two `06-` SKUs in the running are Taxi
--      spare parts (a chainguard and a crank arm, both in bin H28) that the
--      prefix accepts and the flag rejects.
--   2. A place to record the bikes that must never enter a block. Juveniles
--      live in ROW 17 and the oversize models in ROW 10, but the row is only
--      where you find them — the exclusion belongs to the SKU, or it
--      evaporates the moment the bike is moved.

CREATE TABLE IF NOT EXISTS public.warehouse_excluded_skus (
  sku text PRIMARY KEY,
  -- Free text on purpose: 'juvenile' and 'oversize' are today's reasons, and
  -- the next one should not need a migration.
  reason text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

COMMENT ON TABLE public.warehouse_excluded_skus IS
  'Bikes that never enter a DS-Pallet block, whatever their stock or movement says.';

ALTER TABLE public.warehouse_excluded_skus ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all users to read warehouse excluded skus" ON public.warehouse_excluded_skus;
CREATE POLICY "Allow all users to read warehouse excluded skus"
  ON public.warehouse_excluded_skus
  FOR SELECT
  TO authenticated, anon
  USING (true);

DROP POLICY IF EXISTS "Allow all users to write warehouse excluded skus" ON public.warehouse_excluded_skus;
CREATE POLICY "Allow all users to write warehouse excluded skus"
  ON public.warehouse_excluded_skus
  FOR ALL
  TO authenticated, anon
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.warehouse_excluded_skus TO authenticated, anon;

-- Every bike in the warehouse with stock, with what the classification screen
-- needs to decide: how much there is, where it sits, when it last shipped, and
-- whether it has already been ruled out.
CREATE OR REPLACE FUNCTION public.get_bike_block_candidates(p_recency_days integer DEFAULT 30)
RETURNS TABLE (
  sku text,
  item_name text,
  total_qty numeric,
  location text,
  sublocation text[],
  last_shipped timestamptz,
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
