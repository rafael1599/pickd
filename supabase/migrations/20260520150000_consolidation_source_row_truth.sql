-- get_consolidation_candidates: prefer inventory.location (raw text) over
-- the FK-joined locations.location as the source-of-truth row.
--
-- Problem: 03-4227BL had inventory.location='ROW 23' but
-- inventory.location_id pointed to a locations row whose name='ROW 1'. The
-- inventory list (Stock screen) reads i.location directly and showed
-- 'ROW 23'. The consolidation RPC used COALESCE(l.location, i.location)
-- which prefers the FK side — so it showed 'ROW 1'. Users see contradictory
-- locations for the same SKU between screens.
--
-- The text column is the source of truth across the rest of the app
-- (InventoryScreen, ItemDetailView, move_inventory_stock RPC parameters,
-- picking_lists.items[].location snapshots). Flip the coalesce so this RPC
-- agrees with everyone else. Falls back to the FK only when i.location is
-- somehow NULL.

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
    AND stats.orders_completed <= p_max_orders
  ORDER BY COALESCE(i.location, l.location), i.quantity DESC, i.sku;
$function$;

GRANT EXECUTE ON FUNCTION public.get_consolidation_candidates(int, boolean, timestamptz)
  TO anon, authenticated, service_role;
