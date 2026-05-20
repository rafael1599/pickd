-- get_clear_row_plan v2: smart per-SKU destination suggestion.
--
-- Extends the previous version (which only tagged 'active' / 'slow') with
-- a concrete suggested_row and a short suggestion_reason string. The choice
-- of suggested_row factors in:
--
--   1. The SKU's movement zone (active vs slow) — same threshold as before.
--   2. Live free capacity per candidate row (`locations.max_capacity` minus
--      the sum of active `inventory.quantity` for that row). Only rows
--      where free >= qty are considered.
--   3. Each row's `picking_order`:
--        - active zone: prefer the HIGHEST picking_order row that fits
--          (closest to packing → fastest pick for hot SKUs).
--        - slow zone:   prefer the LOWEST picking_order row that fits
--          (deepest into the warehouse → out of the way).
--   4. Capacity tiebreak: when picking_order is equal, prefer the row with
--      more free space (spreads load).
--
-- Function signature changes (return columns added), so we DROP first.

DROP FUNCTION IF EXISTS public.get_clear_row_plan(text, text, boolean, int, timestamptz);

CREATE OR REPLACE FUNCTION public.get_clear_row_plan(
  p_source_row text,
  p_warehouse text DEFAULT 'LUDLOW',
  p_only_bikes boolean DEFAULT true,
  p_active_threshold int DEFAULT 2,
  p_active_rows text[] DEFAULT ARRAY[
    'ROW 1','ROW 2','ROW 3','ROW 4','ROW 5','ROW 6',
    'ROW 7','ROW 8','ROW 9','ROW 10','ROW 16'
  ],
  p_slow_rows text[] DEFAULT ARRAY[
    'ROW 20','ROW 21','ROW 22','ROW 23','ROW 24','ROW 25',
    'ROW 26','ROW 27','ROW 28','ROW 29','ROW 30','ROW 31'
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
  alias_chain text[],
  suggested_zone text,
  suggested_row text,
  suggested_row_free integer,
  suggested_row_picking_order integer,
  suggestion_reason text
)
LANGUAGE sql STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH source_items AS (
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
      END AS zone
    FROM public.inventory i
    LEFT JOIN public.locations l ON l.id = i.location_id
    LEFT JOIN public.sku_metadata s ON s.sku = i.sku
    CROSS JOIN LATERAL public.get_sku_movement_stats(i.sku, p_since) AS stats
    WHERE i.is_active = true
      AND i.quantity > 0
      AND i.warehouse = p_warehouse
      AND COALESCE(i.location, l.location) = p_source_row
      AND (NOT p_only_bikes OR s.is_bike = true)
  ),
  target_caps AS (
    SELECT
      l.location,
      l.picking_order,
      l.max_capacity,
      GREATEST(
        COALESCE(l.max_capacity, 0) - COALESCE((
          SELECT SUM(inv.quantity)
          FROM public.inventory inv
          WHERE inv.location_id = l.id
            AND inv.is_active = true
            AND inv.quantity > 0
        ), 0),
        0
      ) AS free
    FROM public.locations l
    WHERE l.warehouse = p_warehouse
      AND l.is_active = true
      AND l.location = ANY(p_active_rows || p_slow_rows)
  ),
  ranked AS (
    SELECT
      s.inventory_id,
      t.location AS target_loc,
      t.picking_order,
      t.free,
      ROW_NUMBER() OVER (
        PARTITION BY s.inventory_id
        ORDER BY
          -- Active zone: high picking_order = prime (closer to packing).
          -- Slow zone:   low picking_order  = deepest.
          CASE s.zone
            WHEN 'active' THEN -COALESCE(t.picking_order, 0)
            ELSE COALESCE(t.picking_order, 999999)
          END,
          -- Tiebreak: prefer emptier rows to spread load.
          t.free DESC
      ) AS rn
    FROM source_items s
    JOIN target_caps t
      ON t.free >= s.qty
     AND (
          (s.zone = 'active' AND t.location = ANY(p_active_rows))
       OR (s.zone = 'slow'   AND t.location = ANY(p_slow_rows))
     )
  )
  SELECT
    s.inventory_id,
    s.sku,
    s.item_name,
    s.warehouse,
    s.source_row,
    s.sublocation,
    s.qty,
    s.orders_completed,
    s.units_shipped,
    s.last_shipped,
    s.alias_chain,
    s.zone AS suggested_zone,
    r.target_loc AS suggested_row,
    r.free AS suggested_row_free,
    r.picking_order AS suggested_row_picking_order,
    CASE
      WHEN r.target_loc IS NULL THEN
        'No row in ' || s.zone || ' zone with ' || s.qty || 'u free'
      WHEN s.zone = 'active' THEN
        r.target_loc || ' · ' || r.free || 'u free · prime spot (picking ' || r.picking_order || ')'
      ELSE
        r.target_loc || ' · ' || r.free || 'u free · deep slot (picking ' || r.picking_order || ')'
    END AS suggestion_reason
  FROM source_items s
  LEFT JOIN ranked r ON r.inventory_id = s.inventory_id AND r.rn = 1
  ORDER BY s.orders_completed DESC, s.qty DESC, s.sku;
$function$;

GRANT EXECUTE ON FUNCTION public.get_clear_row_plan(text, text, boolean, int, text[], text[], timestamptz)
  TO anon, authenticated, service_role;
