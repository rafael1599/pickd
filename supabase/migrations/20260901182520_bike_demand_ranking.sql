-- Which bike boxes are worth measuring next.
--
-- The Dimensions export already says *which* SKUs FedEx has no carton for --
-- 155 of them at the time of writing. What it cannot say is which one to walk
-- to first. A bike ordered ninety times since January is a carton FedEx
-- mis-rates every week; a bike ordered once is a tape-measure trip that buys
-- nothing. So this ranks by demand, and the screen that consumes it works the
-- list top-down.
--
-- Three deliberate choices:
--
--   * `completed` orders only. An order that never shipped is not evidence
--     that this box went through FedEx.
--   * `created_at`, not `updated_at`. `updated_at` moves every time anybody
--     edits an order, so a stale order re-opened last week would read as
--     demand from last week. (`source_order_date` would be truer still -- it
--     is the AS400 order date -- but it is NULL on 1035 of the 1748 completed
--     orders in the window, so it cannot carry the ranking.)
--   * Renames are folded forward. `inventory.service.ts` records a rename as an
--     inventory_logs EDIT with `previous_sku`, and orders keep the name they
--     were written under, so without this a renamed SKU reads as barely
--     ordered. Same fact `resolve_sku_chain` walks backwards for one SKU; here
--     it is walked forwards for all of them at once, because 733 per-SKU
--     recursive calls would not be worth the accuracy.
--
-- It returns every bike on hand in the window, measured or not, plus the raw
-- carton columns. Deciding whether FedEx has a usable carton is one rule that
-- already lives in `src/utils/fedexCarton.ts` and is shared by the export and
-- the double-check warning; re-stating it in SQL would be a fourth copy that
-- can disagree with the file it is supposed to describe.

CREATE OR REPLACE FUNCTION public.get_bike_demand_ranking(
  p_months int DEFAULT 12,
  p_min_stock int DEFAULT 3
)
RETURNS TABLE(
  sku text,
  model text,
  size text,
  image_url text,
  length_in numeric,
  width_in numeric,
  height_in numeric,
  dimensions_verified boolean,
  dimensions_measured_at timestamptz,
  orders bigint,
  units numeric,
  last_ordered timestamptz,
  stock bigint,
  location text,
  sublocation text[]
)
LANGUAGE sql STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH RECURSIVE edges AS (
    -- The most recent rename per old name: old -> new, one hop.
    SELECT DISTINCT ON (l.previous_sku) l.previous_sku AS old_sku, l.sku AS new_sku
    FROM public.inventory_logs l
    WHERE l.previous_sku IS NOT NULL
      AND l.previous_sku <> ''
      AND l.previous_sku <> l.sku
    ORDER BY l.previous_sku, l.created_at DESC
  ),
  chain AS (
    SELECT e.old_sku, e.new_sku, 1 AS hops FROM edges e
    UNION ALL
    SELECT c.old_sku, e.new_sku, c.hops + 1
    FROM chain c
    JOIN edges e ON e.old_sku = c.new_sku
    WHERE c.hops < 10 AND e.new_sku <> c.old_sku   -- cycle + runaway guard
  ),
  canonical AS (
    -- Furthest hop forward is the name the SKU answers to today.
    SELECT DISTINCT ON (c.old_sku) c.old_sku, c.new_sku
    FROM chain c ORDER BY c.old_sku, c.hops DESC
  ),
  lines AS (
    SELECT pl.id,
           pl.created_at,
           COALESCE(cn.new_sku, it->>'sku') AS sku,
           COALESCE((it->>'pickingQty')::numeric, 0) AS qty
    FROM public.picking_lists pl
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(pl.items, '[]'::jsonb)) it
    LEFT JOIN canonical cn ON cn.old_sku = (it->>'sku')
    WHERE pl.status = 'completed'
      AND pl.created_at >= now() - make_interval(months => GREATEST(COALESCE(p_months, 12), 1))
  ),
  demand AS (
    SELECT l.sku,
           count(DISTINCT l.id)::bigint AS orders,
           COALESCE(sum(l.qty), 0) AS units,
           max(l.created_at) AS last_ordered
    FROM lines l
    GROUP BY l.sku
  ),
  stock AS (
    SELECT i.sku, sum(i.quantity)::bigint AS qty
    FROM public.inventory i
    WHERE i.is_active AND i.quantity > 0
    GROUP BY i.sku
  ),
  -- Where to walk to: the shelf holding the most of it. A bike spread over
  -- four rows has one box worth measuring and three worth ignoring.
  home AS (
    SELECT DISTINCT ON (i.sku) i.sku, i.location, i.sublocation
    FROM public.inventory i
    WHERE i.is_active AND i.quantity > 0
    ORDER BY i.sku, i.quantity DESC, i.location
  )
  SELECT m.sku,
         m.model,
         m.size,
         m.image_url,
         m.length_in,
         m.width_in,
         m.height_in,
         COALESCE(m.dimensions_verified, false),
         m.dimensions_measured_at,
         d.orders,
         d.units,
         d.last_ordered,
         s.qty,
         h.location,
         h.sublocation
  FROM demand d
  JOIN public.sku_metadata m ON m.sku = d.sku
  JOIN stock s ON s.sku = d.sku
  LEFT JOIN home h ON h.sku = d.sku
  WHERE m.is_bike IS TRUE
    AND COALESCE(m.is_scratch_dent, false) = false
    AND s.qty >= GREATEST(COALESCE(p_min_stock, 0), 0)
  -- Most ordered first; a tie goes to whichever sold most recently.
  ORDER BY d.orders DESC, d.last_ordered DESC, m.sku;
$function$;

GRANT EXECUTE ON FUNCTION public.get_bike_demand_ranking(int, int)
  TO authenticated, service_role;
