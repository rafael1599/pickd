-- Extend the accuracy lookback window in compute_daily_report_data from 60 to 90 days.
-- Additive: CREATE OR REPLACE FUNCTION with the same signature and shape, only the
-- window constant changes. All other logic is copied verbatim from
-- 20260410210000_daily_report_rpcs.sql so live and snapshot reads stay aligned with
-- useActivityReport.ts (which also now uses 90 days).

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
  v_users             jsonb;
BEGIN
  SELECT starts_at, ends_at
  INTO v_starts_at, v_ends_at
  FROM public.ny_day_bounds(p_report_date);

  -- 90-day rolling window for accuracy lookback (anchored on report end, NOT now).
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

  -- Verified SKUs (90-day rolling window ending at v_ends_at).
  SELECT COUNT(DISTINCT sku)::int
  INTO v_verified_skus_2m
  FROM (
    SELECT sku FROM public.cycle_count_items
      WHERE status IN ('counted', 'verified')
        AND counted_at >= v_window_start
        AND counted_at <= v_ends_at
        AND sku IS NOT NULL
    UNION ALL
    SELECT sku FROM public.inventory_logs
      WHERE action_type IN ('MOVE', 'ADD')
        AND is_reversed = false
        AND created_at >= v_window_start
        AND created_at <= v_ends_at
        AND sku IS NOT NULL
  ) all_skus;

  SELECT total_skus
  INTO v_total_skus
  FROM public.get_inventory_stats(true);

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
    'correction_count', v_correction_count,
    'users',            COALESCE(v_users, '[]'::jsonb),
    'schema_version',   1
  );
END;
$$;

REVOKE ALL ON FUNCTION public.compute_daily_report_data(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compute_daily_report_data(date) TO authenticated, service_role;

COMMIT;
