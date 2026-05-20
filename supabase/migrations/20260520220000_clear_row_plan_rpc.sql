-- get_clear_row_plan: for a chosen source row, list every active SKU in it
-- and tag each with a suggested destination zone based on movement.
--
-- Use case: operator wants to empty out a specific row (often to free it
-- for incoming inventory). For each SKU in the row, the system suggests
-- where it should go based on the SKU's (alias-aware) completed-order
-- count:
--   - 'active' (≥ p_active_threshold orders) → moves toward ROW 1-10, 16
--   - 'slow'   (otherwise)                   → moves toward ROW 20-34
--
-- The UI uses the suggestion to pre-select the correct target row set
-- when opening the Move modal. User can still override.
--
-- The function does not pick a specific destination row — capacity is
-- live and the UI shows per-row free counts already, so picking the row
-- is left to the operator.

CREATE OR REPLACE FUNCTION public.get_clear_row_plan(
  p_source_row text,
  p_warehouse text DEFAULT 'LUDLOW',
  p_only_bikes boolean DEFAULT true,
  p_active_threshold int DEFAULT 2,
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
  alias_chain text[],
  suggested_zone text
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
    stats.alias_chain,
    CASE
      WHEN stats.orders_completed >= p_active_threshold THEN 'active'
      ELSE 'slow'
    END AS suggested_zone
  FROM public.inventory i
  LEFT JOIN public.locations l ON l.id = i.location_id
  LEFT JOIN public.sku_metadata s ON s.sku = i.sku
  CROSS JOIN LATERAL public.get_sku_movement_stats(i.sku, p_since) AS stats
  WHERE i.is_active = true
    AND i.quantity > 0
    AND i.warehouse = p_warehouse
    AND COALESCE(i.location, l.location) = p_source_row
    AND (NOT p_only_bikes OR s.is_bike = true)
  ORDER BY stats.orders_completed DESC, i.quantity DESC, i.sku;
$function$;

GRANT EXECUTE ON FUNCTION public.get_clear_row_plan(text, text, boolean, int, timestamptz)
  TO anon, authenticated, service_role;
