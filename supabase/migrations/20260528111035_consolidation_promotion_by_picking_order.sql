-- Replace the hardcoded row-NAME zone filters in the consolidation /
-- promotion candidate RPCs with picking_order-based displacement logic.
--
-- Why: row names no longer map to the physical layout. ROW 34 has the LOWEST
-- picking_order (100 = slowest slot) while ROW 42 sits at 400. The promote RPC
-- only sourced from a hardcoded ROW 20-34 list, so a 30-order/month SKU parked
-- in ROW 42 (03-4081BK) was invisible to "Bring to active". Picking_order is
-- the single source of truth (same model as suggest_locations_for_sku).
--
-- Model: each SKU has an "ideal" picking_order based on how much it moves:
--   ideal = min_po + clamp(orders/5, 0, 1) * (max_po - min_po)
-- A SKU is mis-slotted when its current row's picking_order is on the wrong
-- side of its ideal:
--   Bring to active  → high mover sitting BELOW ideal  (cur_po < ideal)
--   Send to slow     → low  mover sitting ABOVE ideal  (cur_po > ideal)
-- The 999 sentinel (unplaced rows) and NULL picking_orders are excluded.

-- ─── Bring to active ────────────────────────────────────────────────────────
-- Signature changes (drops p_source_rows) → must DROP first.
DROP FUNCTION IF EXISTS public.get_promotion_candidates(int, boolean, text[], timestamptz);

CREATE OR REPLACE FUNCTION public.get_promotion_candidates(
  p_min_orders int DEFAULT 2,
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
  WITH bounds AS (
    SELECT MIN(picking_order)::numeric AS min_po, MAX(picking_order)::numeric AS max_po
    FROM public.locations
    WHERE location ILIKE 'ROW%'
      AND is_active IS NOT FALSE
      AND COALESCE(is_shipping_area, false) = false
      AND picking_order IS NOT NULL
      AND picking_order < 999
  )
  SELECT
    i.id AS inventory_id,
    i.sku,
    i.item_name,
    i.warehouse,
    i.location AS source_row,
    i.sublocation,
    i.quantity AS qty,
    stats.orders_completed,
    stats.units_shipped,
    stats.last_shipped,
    stats.alias_chain
  FROM public.inventory i
  LEFT JOIN public.sku_metadata s ON s.sku = i.sku
  CROSS JOIN bounds b
  LEFT JOIN LATERAL (
    SELECT MIN(lo.picking_order)::numeric AS po
    FROM public.locations lo
    WHERE lo.location = i.location
      AND lo.picking_order IS NOT NULL
      AND lo.picking_order < 999
  ) loc ON true
  CROSS JOIN LATERAL public.get_sku_movement_stats(i.sku, p_since) AS stats
  WHERE i.is_active = true
    AND i.quantity > 0
    AND (NOT p_only_bikes OR s.is_bike = true)
    AND stats.orders_completed >= p_min_orders
    AND loc.po IS NOT NULL
    -- Sitting below where its movement warrants → room to promote.
    AND loc.po < (b.min_po + LEAST(1.0, stats.orders_completed::numeric / 5.0) * (b.max_po - b.min_po))
  ORDER BY stats.orders_completed DESC, i.quantity DESC, i.sku;
$function$;

GRANT EXECUTE ON FUNCTION public.get_promotion_candidates(int, boolean, timestamptz)
  TO anon, authenticated, service_role;

-- ─── Send to slow ───────────────────────────────────────────────────────────
-- Signature unchanged; CREATE OR REPLACE is fine.
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
  WITH bounds AS (
    SELECT MIN(picking_order)::numeric AS min_po, MAX(picking_order)::numeric AS max_po
    FROM public.locations
    WHERE location ILIKE 'ROW%'
      AND is_active IS NOT FALSE
      AND COALESCE(is_shipping_area, false) = false
      AND picking_order IS NOT NULL
      AND picking_order < 999
  )
  SELECT
    i.id AS inventory_id,
    i.sku,
    i.item_name,
    i.warehouse,
    i.location AS source_row,
    i.sublocation,
    i.quantity AS qty,
    stats.orders_completed,
    stats.units_shipped,
    stats.last_shipped,
    stats.alias_chain
  FROM public.inventory i
  LEFT JOIN public.sku_metadata s ON s.sku = i.sku
  CROSS JOIN bounds b
  LEFT JOIN LATERAL (
    SELECT MIN(lo.picking_order)::numeric AS po
    FROM public.locations lo
    WHERE lo.location = i.location
      AND lo.picking_order IS NOT NULL
      AND lo.picking_order < 999
  ) loc ON true
  CROSS JOIN LATERAL public.get_sku_movement_stats(i.sku, p_since) AS stats
  WHERE i.is_active = true
    AND i.quantity > 0
    AND (NOT p_only_bikes OR s.is_bike = true)
    AND stats.orders_completed <= p_max_orders
    AND loc.po IS NOT NULL
    -- Sitting above where its (low) movement warrants → should go slower.
    AND loc.po > (b.min_po + LEAST(1.0, stats.orders_completed::numeric / 5.0) * (b.max_po - b.min_po))
  ORDER BY i.location, i.quantity DESC, i.sku;
$function$;

GRANT EXECUTE ON FUNCTION public.get_consolidation_candidates(int, boolean, timestamptz)
  TO anon, authenticated, service_role;
