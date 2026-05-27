-- Inventory Accuracy KPI: scope to bikes only.
--
-- The report's accuracy KPI was dividing bike-driven verifications by a
-- parts-only denominator. Two contributing factors:
--   1. Numerator (cycle_count_items + inventory_logs MOVE/ADD/PHYSICAL_DISTRIBUTION
--      /EDIT) had no is_bike filter, so it mixed bike + part SKUs.
--   2. Denominator called get_inventory_stats(true), whose semantics flipped
--      on 2026-04-14 from "include parts" → "parts only" (see
--      20260414110000_stats_add_total_capacity.sql).
--
-- Fix: filter both sides to is_bike = true.
--   - Numerator joins sku_metadata and keeps only is_bike = true SKUs.
--   - Denominator calls get_inventory_stats(false) (bikes only).
--
-- Additive: CREATE OR REPLACE with same signature; output shape unchanged.

BEGIN;

CREATE OR REPLACE FUNCTION public.compute_daily_report_data(p_report_date date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_starts_at         timestamptz;
  v_ends_at           timestamptz;
  v_window_start      timestamptz;
  v_warehouse_team_id uuid;
  v_orders_completed  int := 0;
  v_total_items       int := 0;
  v_correction_count  int := 0;
  v_verified_skus_2m  int := 0;
  v_total_skus        bigint := 0;
  v_accuracy_pct      numeric := 0;
  v_breakdown         jsonb;
  v_users             jsonb;
BEGIN
  SELECT starts_at, ends_at
  INTO v_starts_at, v_ends_at
  FROM public.ny_day_bounds(p_report_date);

  v_window_start := v_ends_at - interval '90 days';

  SELECT id INTO v_warehouse_team_id
  FROM public.profiles
  WHERE full_name = 'Warehouse Team' AND is_active = true
  LIMIT 1;

  SELECT
    COUNT(*)::int,
    COALESCE(SUM(item_count), 0)::int
  INTO v_orders_completed, v_total_items
  FROM (
    SELECT
      COALESCE((
        SELECT SUM(COALESCE((item->>'pickingQty')::int, 0))::int
        FROM jsonb_array_elements(pl.items) item
      ), 0) AS item_count
    FROM public.picking_lists pl
    WHERE pl.status = 'completed'
      AND pl.updated_at >= v_starts_at
      AND pl.updated_at <= v_ends_at
  ) sub;

  SELECT COUNT(*)::int
  INTO v_correction_count
  FROM public.picking_list_notes
  WHERE created_at >= v_starts_at
    AND created_at <= v_ends_at;

  WITH cycle_skus AS (
    SELECT DISTINCT cci.sku, 'cycle_counted'::text AS category
    FROM public.cycle_count_items cci
    JOIN public.sku_metadata sm ON sm.sku = cci.sku
    WHERE cci.status IN ('counted', 'verified')
      AND cci.counted_at >= v_window_start
      AND cci.counted_at <= v_ends_at
      AND cci.sku IS NOT NULL
      AND sm.is_bike = true
  ),
  log_skus AS (
    SELECT DISTINCT il.sku,
      CASE il.action_type
        WHEN 'MOVE' THEN 'movements'
        WHEN 'ADD' THEN 'additions'
        WHEN 'PHYSICAL_DISTRIBUTION' THEN 'on_site_checked'
        WHEN 'EDIT' THEN 'quantity_edited'
      END AS category
    FROM public.inventory_logs il
    JOIN public.sku_metadata sm ON sm.sku = il.sku
    WHERE il.is_reversed = false
      AND il.created_at >= v_window_start
      AND il.created_at <= v_ends_at
      AND il.sku IS NOT NULL
      AND sm.is_bike = true
      AND (
        il.action_type IN ('MOVE', 'ADD', 'PHYSICAL_DISTRIBUTION')
        OR (il.action_type = 'EDIT' AND COALESCE(il.quantity_change, 0) <> 0)
      )
  ),
  all_skus AS (
    SELECT sku, category FROM cycle_skus
    UNION ALL
    SELECT sku, category FROM log_skus
  ),
  per_category AS (
    SELECT
      COUNT(DISTINCT sku) FILTER (WHERE category = 'cycle_counted')::int   AS cycle_counted,
      COUNT(DISTINCT sku) FILTER (WHERE category = 'movements')::int       AS movements,
      COUNT(DISTINCT sku) FILTER (WHERE category = 'additions')::int       AS additions,
      COUNT(DISTINCT sku) FILTER (WHERE category = 'on_site_checked')::int AS on_site_checked,
      COUNT(DISTINCT sku) FILTER (WHERE category = 'quantity_edited')::int AS quantity_edited,
      COUNT(DISTINCT sku)::int                                              AS total_distinct
    FROM all_skus
  )
  SELECT
    total_distinct,
    jsonb_build_object(
      'cycle_counted',   cycle_counted,
      'movements',       movements,
      'additions',       additions,
      'on_site_checked', on_site_checked,
      'quantity_edited', quantity_edited
    )
  INTO v_verified_skus_2m, v_breakdown
  FROM per_category;

  IF v_breakdown IS NULL THEN
    v_breakdown := jsonb_build_object(
      'cycle_counted', 0,
      'movements', 0,
      'additions', 0,
      'on_site_checked', 0,
      'quantity_edited', 0
    );
    v_verified_skus_2m := 0;
  END IF;

  -- Bikes-only denominator (matches the bikes-only numerator above).
  SELECT total_skus
  INTO v_total_skus
  FROM public.get_inventory_stats(false);

  IF v_total_skus > 0 THEN
    v_accuracy_pct := round((v_verified_skus_2m::numeric / v_total_skus::numeric) * 100, 2);
  END IF;

  WITH items_per_order AS (
    SELECT
      pl.id,
      pl.user_id,
      pl.checked_by,
      COALESCE((
        SELECT SUM(COALESCE((item->>'pickingQty')::int, 0))::int
        FROM jsonb_array_elements(pl.items) item
      ), 0) AS item_count
    FROM public.picking_lists pl
    WHERE pl.status = 'completed'
      AND pl.updated_at >= v_starts_at
      AND pl.updated_at <= v_ends_at
  ),
  picking_metrics AS (
    SELECT user_id,
      COUNT(*)::int AS orders_picked,
      COALESCE(SUM(item_count), 0)::int AS items_picked
    FROM items_per_order
    WHERE user_id IS NOT NULL
      AND (v_warehouse_team_id IS NULL OR user_id <> v_warehouse_team_id)
    GROUP BY user_id
  ),
  checking_metrics AS (
    SELECT checked_by AS user_id,
      COUNT(*)::int AS orders_checked,
      COALESCE(SUM(item_count), 0)::int AS items_checked
    FROM items_per_order
    WHERE checked_by IS NOT NULL
      AND (v_warehouse_team_id IS NULL OR checked_by <> v_warehouse_team_id)
    GROUP BY checked_by
  ),
  inventory_metrics AS (
    SELECT user_id,
      COALESCE(SUM(ABS(quantity_change)) FILTER (WHERE action_type = 'ADD'), 0)::int AS inventory_adds,
      COALESCE(SUM(ABS(quantity_change)) FILTER (WHERE action_type = 'MOVE'), 0)::int AS inventory_moves,
      COALESCE(SUM(ABS(quantity_change)) FILTER (WHERE action_type = 'DEDUCT' AND list_id IS NULL), 0)::int AS inventory_deducts
    FROM public.inventory_logs
    WHERE is_reversed = false
      AND created_at >= v_starts_at
      AND created_at <= v_ends_at
      AND user_id IS NOT NULL
      AND (v_warehouse_team_id IS NULL OR user_id <> v_warehouse_team_id)
    GROUP BY user_id
  ),
  cycle_metrics AS (
    SELECT counted_by AS user_id,
      COUNT(*)::int AS cycle_count_items,
      COUNT(*) FILTER (WHERE variance IS NOT NULL AND variance <> 0)::int AS cycle_count_discrepancies
    FROM public.cycle_count_items
    WHERE status IN ('counted', 'verified')
      AND counted_at >= v_starts_at
      AND counted_at <= v_ends_at
      AND counted_by IS NOT NULL
      AND (v_warehouse_team_id IS NULL OR counted_by <> v_warehouse_team_id)
    GROUP BY counted_by
  ),
  all_users AS (
    SELECT user_id FROM picking_metrics
    UNION
    SELECT user_id FROM checking_metrics
    UNION
    SELECT user_id FROM inventory_metrics
    UNION
    SELECT user_id FROM cycle_metrics
  ),
  joined AS (
    SELECT
      au.user_id,
      COALESCE(p.full_name, 'Unknown') AS full_name,
      COALESCE(pm.orders_picked, 0)               AS orders_picked,
      COALESCE(pm.items_picked, 0)                AS items_picked,
      COALESCE(cm.orders_checked, 0)              AS orders_checked,
      COALESCE(cm.items_checked, 0)               AS items_checked,
      COALESCE(im.inventory_adds, 0)              AS inventory_adds,
      COALESCE(im.inventory_moves, 0)             AS inventory_moves,
      COALESCE(im.inventory_deducts, 0)           AS inventory_deducts,
      COALESCE(cyc.cycle_count_items, 0)          AS cycle_count_items,
      COALESCE(cyc.cycle_count_discrepancies, 0)  AS cycle_count_discrepancies
    FROM all_users au
    LEFT JOIN public.profiles p   ON p.id = au.user_id
    LEFT JOIN picking_metrics pm  ON pm.user_id = au.user_id
    LEFT JOIN checking_metrics cm ON cm.user_id = au.user_id
    LEFT JOIN inventory_metrics im ON im.user_id = au.user_id
    LEFT JOIN cycle_metrics cyc   ON cyc.user_id = au.user_id
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'user_id',                   user_id,
      'full_name',                 full_name,
      'orders_picked',             orders_picked,
      'items_picked',              items_picked,
      'orders_checked',            orders_checked,
      'items_checked',             items_checked,
      'inventory_adds',            inventory_adds,
      'inventory_moves',           inventory_moves,
      'inventory_deducts',         inventory_deducts,
      'cycle_count_items',         cycle_count_items,
      'cycle_count_discrepancies', cycle_count_discrepancies
    )
    ORDER BY full_name
  )
  INTO v_users
  FROM joined
  WHERE
    orders_picked > 0 OR orders_checked > 0
    OR inventory_adds > 0 OR inventory_moves > 0 OR inventory_deducts > 0
    OR cycle_count_items > 0;

  RETURN jsonb_build_object(
    'warehouse_totals', jsonb_build_object(
      'orders_completed', v_orders_completed,
      'total_items',      v_total_items
    ),
    'accuracy', jsonb_build_object(
      'pct',              v_accuracy_pct,
      'verified_skus_2m', v_verified_skus_2m,
      'total_skus',       v_total_skus
    ),
    'verified_skus_breakdown', v_breakdown,
    'correction_count', v_correction_count,
    'users',            COALESCE(v_users, '[]'::jsonb),
    'schema_version',   2
  );
END;
$$;

REVOKE ALL ON FUNCTION public.compute_daily_report_data(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compute_daily_report_data(date) TO authenticated, service_role;

COMMIT;
