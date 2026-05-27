-- get_consolidation_candidates(max_orders, only_bikes, since)
--
-- One-shot fetch for the consolidation / slotting screen. Returns every active
-- inventory row whose SKU has shipped no more than `max_orders` completed
-- orders (rename-aware via resolve_sku_chain). Joins to the inventory row so
-- the screen can show current qty + sublocation + source row without N+1.

CREATE OR REPLACE FUNCTION public.get_consolidation_candidates(
  p_max_orders int DEFAULT 0,
  p_only_bikes boolean DEFAULT true,
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
    COALESCE(l.location, i.location) AS source_row,
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
    AND stats.orders_completed <= p_max_orders
  ORDER BY COALESCE(l.location, i.location), i.quantity DESC, i.sku;
$function$;

GRANT EXECUTE ON FUNCTION public.get_consolidation_candidates(int, boolean, timestamptz)
  TO anon, authenticated, service_role;
