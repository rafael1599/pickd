-- Carry `weight_lbs` in the measuring queue.
--
-- Whoever is standing at the box with a tape measure is also standing at it
-- with a scale, and the trip is the expensive part. 613 of the bikes in the
-- catalog sit at exactly 45 lbs -- the trigger's default for a boxed bicycle,
-- not a number anybody read off a scale -- and that default is what Ship adds
-- up into the total the station types into Audit Source.
--
-- The screen needs the stored weight for two things: to say what it is
-- replacing, and to tell a default apart from a real reading. Unlike
-- dimensions there is no `weight_verified` flag, so the screen compares
-- against the type default. That comparison is wrong for a bike that genuinely
-- weighs 45.0 -- and the cost of being wrong is somebody re-weighing a box and
-- typing 45 again, not a carton shipping under a number nobody took. For
-- dimensions the same shortcut would have put unmeasured cartons in the FedEx
-- file as verified, which is why that one got a column.
--
-- RETURNS TABLE changes, so this drops and recreates rather than replaces. The
-- only caller is the measuring queue, and its arguments do not change: a
-- frontend deployed before this migration keeps working and ignores the new
-- column.

DROP FUNCTION IF EXISTS public.get_bike_demand_ranking(int, int);

CREATE FUNCTION public.get_bike_demand_ranking(
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
  weight_lbs numeric,
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
         m.weight_lbs,
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
