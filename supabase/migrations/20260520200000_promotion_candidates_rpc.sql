-- get_promotion_candidates: the inverse of get_consolidation_candidates.
--
-- Surfaces SKUs that are currently sitting in the slow zone (default
-- ROW 20-34) but whose completed-order history shows they're actually
-- high-rotation — i.e. they're slotted wrong and should be promoted back
-- to the active zone (ROW 1-10, 16) for faster picker access.
--
-- Same shape as get_consolidation_candidates so the screen can reuse the
-- card component verbatim.

CREATE OR REPLACE FUNCTION public.get_promotion_candidates(
  p_min_orders int DEFAULT 2,
  p_only_bikes boolean DEFAULT true,
  p_source_rows text[] DEFAULT ARRAY[
    'ROW 20','ROW 21','ROW 22','ROW 23','ROW 24','ROW 25','ROW 26','ROW 27',
    'ROW 28','ROW 29','ROW 30','ROW 31','ROW 32','ROW 33','ROW 34'
  ],
  p_since timestamptz DEFAULT NULL
)
RETURNS TABLE(
  inventory_id bigint,
  sku text,
  item_name text,
  warehouse text,
  source_row text,
  sublocation text[],
  qty integer,
  orders_completed bigint,
  units_shipped numeric,
  last_shipped timestamptz,
  alias_chain text[]
)
LANGUAGE sql STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    i.id AS inventory_id,
    i.sku,
    i.item_name,
    i.warehouse,
    COALESCE(i.location, l.location) AS source_row,
    i.sublocation,
    i.quantity AS qty,
    stats.orders_completed,
    stats.units_shipped,
    stats.last_shipped,
    stats.alias_chain
  FROM public.inventory i
  LEFT JOIN public.locations l ON l.id = i.location_id
  LEFT JOIN public.sku_metadata s ON s.sku = i.sku
  CROSS JOIN LATERAL public.get_sku_movement_stats(i.sku, p_since) AS stats
  WHERE i.is_active = true
    AND i.quantity > 0
    AND (NOT p_only_bikes OR s.is_bike = true)
    AND stats.orders_completed >= p_min_orders
    AND COALESCE(i.location, l.location) = ANY(p_source_rows)
  -- Highest movement first so the most impactful slotting wins are at the top.
  ORDER BY stats.orders_completed DESC, i.quantity DESC, i.sku;
$function$;

GRANT EXECUTE ON FUNCTION public.get_promotion_candidates(int, boolean, text[], timestamptz)
  TO anon, authenticated, service_role;
