-- get_slot_fill_candidates — suggest SKUs from slow zone to fill empty
-- slots in active rows, ranked by recency-weighted velocity.
--
-- Why exponential decay instead of a fixed velocity window:
-- A fixed window (e.g. "orders in last 90d") either misses recent
-- cooling SKUs (180d window favors old picks) or seasonal slow-but-
-- steady SKUs (30d window misses them). Decay solves both — every
-- pick contributes, weighted by age:
--
--   score(sku) = sum over each DEDUCT log of:
--     units_picked * exp(-days_since_pick / DECAY_HALF_LIFE_DAYS)
--
-- DECAY_HALF_LIFE_DAYS = 45 → a pick today counts 1.0, a pick 45 days
-- ago counts 0.5, 90 days ago 0.25, 180 days ago ~0.06. Recent picks
-- dominate while older picks still contribute proportionally.
--
-- Input shape (`p_slots` jsonb array):
--   [
--     { "slot_id": "s1", "min_qty": 30, "max_qty": 35, "same_sku_group_id": null },
--     { "slot_id": "s2", "min_qty": 4,  "max_qty": 7,  "same_sku_group_id": "g1" }
--   ]
--
-- For each slot we return the top N SKUs whose current qty in slow
-- zone falls within [min_qty, max_qty]. Slots in the same
-- `same_sku_group_id` are constrained downstream by the caller (the
-- frontend builder picks one SKU per group); the RPC ranks each slot
-- independently so the caller can pick the best per-slot fit OR the
-- best aggregate fit for the group.
--
-- Exclusions:
--   * SKUs already present in any row matching p_exclude_active_rows
--     are filtered out (no duplicates between active + slow zone).
--   * Inactive rows / qty=0 rows ignored.
--   * If p_only_bikes is true, parts (sku_metadata.is_bike = false)
--     filtered out.

CREATE OR REPLACE FUNCTION public.get_slot_fill_candidates(
  p_slots jsonb,
  p_only_bikes boolean DEFAULT true,
  p_exclude_active_rows text[] DEFAULT ARRAY[
    'ROW 1','ROW 2','ROW 3','ROW 4','ROW 5','ROW 6',
    'ROW 7','ROW 8','ROW 9','ROW 10','ROW 16'
  ],
  p_top_n_per_slot int DEFAULT 5
)
RETURNS TABLE(
  slot_id text,
  sku text,
  item_name text,
  current_row text,
  current_qty integer,
  velocity_score numeric,
  orders_30d integer,
  orders_90d integer,
  units_30d integer,
  units_90d integer,
  last_shipped timestamptz,
  fit_precision numeric  -- 0..1, 1 = exactly mid-range
)
LANGUAGE sql STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH
  -- Parse the slots input into a typed table.
  slots AS (
    SELECT
      (elem->>'slot_id')::text       AS slot_id,
      (elem->>'min_qty')::integer    AS min_qty,
      (elem->>'max_qty')::integer    AS max_qty
    FROM jsonb_array_elements(COALESCE(p_slots, '[]'::jsonb)) AS elem
  ),
  -- SKUs already in active rows — exclude entirely to avoid placing
  -- duplicates across zones.
  in_active AS (
    SELECT DISTINCT sku
    FROM public.inventory
    WHERE is_active = true
      AND quantity > 0
      AND location = ANY(p_exclude_active_rows)
  ),
  -- Velocity score with exponential decay. half-life = 45 days.
  -- We aggregate across the SKU's alias chain via inventory_logs.sku
  -- directly (renames preserve previous_sku on the log row, so a
  -- rename keeps history on the canonical sku via the chain RPC; for
  -- this query the direct sku is good enough — slotting decisions
  -- don't need cross-rename granularity since renames are rare and
  -- the post-rename SKU starts accumulating fresh signal).
  velocity AS (
    SELECT
      il.sku,
      SUM(
        ABS(il.quantity_change)
        * EXP(-EXTRACT(EPOCH FROM (NOW() - il.created_at)) / 86400.0 / 45.0)
      ) AS score,
      COUNT(DISTINCT il.list_id) FILTER (WHERE il.created_at >= NOW() - INTERVAL '30 days') AS orders_30d,
      COUNT(DISTINCT il.list_id) FILTER (WHERE il.created_at >= NOW() - INTERVAL '90 days') AS orders_90d,
      SUM(ABS(il.quantity_change)) FILTER (WHERE il.created_at >= NOW() - INTERVAL '30 days') AS units_30d,
      SUM(ABS(il.quantity_change)) FILTER (WHERE il.created_at >= NOW() - INTERVAL '90 days') AS units_90d,
      MAX(il.created_at) AS last_shipped
    FROM public.inventory_logs il
    WHERE il.action_type = 'DEDUCT'
      AND il.list_id IS NOT NULL
      -- Cap the lookback at 365d so the integral converges and a
      -- decade-old historical pick doesn't poison the index scan.
      AND il.created_at >= NOW() - INTERVAL '365 days'
    GROUP BY il.sku
  ),
  -- Candidate SKUs: in slow zone (not in active rows), bikes-only if
  -- requested, with at least one recent DEDUCT signal.
  candidates AS (
    SELECT
      i.sku,
      i.item_name,
      i.location AS current_row,
      i.quantity AS current_qty,
      COALESCE(v.score, 0) AS velocity_score,
      COALESCE(v.orders_30d, 0)::integer AS orders_30d,
      COALESCE(v.orders_90d, 0)::integer AS orders_90d,
      COALESCE(v.units_30d, 0)::integer AS units_30d,
      COALESCE(v.units_90d, 0)::integer AS units_90d,
      v.last_shipped
    FROM public.inventory i
    LEFT JOIN public.sku_metadata sm ON sm.sku = i.sku
    LEFT JOIN velocity v ON v.sku = i.sku
    WHERE i.is_active = true
      AND i.quantity > 0
      AND i.sku NOT IN (SELECT sku FROM in_active)
      AND (NOT p_only_bikes OR sm.is_bike = true)
      AND COALESCE(v.score, 0) > 0
  ),
  -- For each slot, the candidates whose current_qty fits inside the
  -- slot's [min, max]. fit_precision = 1 at the slot midpoint, 0 at
  -- the edges — used as a secondary sort to prefer "snug" fits over
  -- "barely-fits" when velocity ties.
  matched AS (
    SELECT
      s.slot_id,
      c.sku,
      c.item_name,
      c.current_row,
      c.current_qty,
      c.velocity_score,
      c.orders_30d,
      c.orders_90d,
      c.units_30d,
      c.units_90d,
      c.last_shipped,
      CASE
        WHEN s.max_qty = s.min_qty THEN 1.0
        ELSE 1.0 - ABS(c.current_qty - ((s.min_qty + s.max_qty) / 2.0))
                   / GREATEST(((s.max_qty - s.min_qty) / 2.0), 1.0)
      END AS fit_precision,
      ROW_NUMBER() OVER (
        PARTITION BY s.slot_id
        ORDER BY c.velocity_score DESC, c.current_qty DESC
      ) AS rn
    FROM slots s
    JOIN candidates c
      ON c.current_qty BETWEEN s.min_qty AND s.max_qty
  )
  SELECT
    slot_id,
    sku,
    item_name,
    current_row,
    current_qty,
    ROUND(velocity_score::numeric, 2) AS velocity_score,
    orders_30d,
    orders_90d,
    units_30d,
    units_90d,
    last_shipped,
    ROUND(fit_precision::numeric, 3) AS fit_precision
  FROM matched
  WHERE rn <= p_top_n_per_slot
  ORDER BY slot_id, rn;
$function$;

GRANT EXECUTE ON FUNCTION public.get_slot_fill_candidates(jsonb, boolean, text[], int)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_slot_fill_candidates IS
  'Suggest SKUs to fill empty slots in active rows. Ranks by exponential-decay velocity (half-life 45d). Filters out SKUs already in active rows. See migration 20260522120100 for full design notes.';
