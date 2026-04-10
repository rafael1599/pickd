-- Migration: daily_reports RPCs (Activity Report Phase 2 — idea-052)
--
-- Three functions:
--   1. compute_daily_report_data(date) -> jsonb
--      Pure computation. Replicates what useActivityReport does client-side today,
--      so the snapshot is identical to live compute. SECURITY DEFINER because it
--      reads cycle_count_items and inventory_logs which have admin-restricted RLS.
--
--   2. create_daily_report_snapshot(date) -> jsonb
--      Cron entry point. Calls compute_daily_report_data, writes ONLY data_computed.
--      Idempotent: re-running for the same date overwrites computed but never touches
--      data_manual. SECURITY DEFINER bypasses RLS so the cron can write yesterday's
--      row even though RLS restricts authenticated users to today.
--
--   3. save_daily_report_manual(date, jsonb) -> void
--      UI entry point for the Save button. Whitelists allowed top-level keys, then
--      upserts ONLY data_manual (never touches data_computed). SECURITY INVOKER so
--      RLS applies — only admins can save, only for today.
--
-- Plan: ~/.claude/plans/activity-report-fase-2-snapshots.md
-- Depends on: 20260410200000_daily_reports_table.sql
-- Depends on: 20260410100000_ny_timezone_helpers.sql (current_ny_date, ny_day_bounds)
-- Depends on: 20260402140000_inventory_stats_rpc.sql (get_inventory_stats)

BEGIN;

-- ============================================================================
-- compute_daily_report_data(p_report_date date) -> jsonb
-- ============================================================================
--
-- Returns a JSONB matching the DailyReportComputed TypeScript interface:
-- {
--   warehouse_totals: { orders_completed: int, total_items: int },
--   accuracy: { pct: numeric, verified_skus_2m: int, total_skus: bigint },
--   correction_count: int,
--   users: UserActivity[],
--   schema_version: 1
-- }
--
-- Computation rules — must match useActivityReport.ts (src/features/reports/hooks/):
--   - "orders_completed" anchored on picking_lists.updated_at, status='completed'
--   - "total_items" sums (item->>'pickingQty')::int across each completed order's items
--   - "verified_skus_2m" union of distinct SKUs from cycle_count_items + inventory_logs
--     (MOVE/ADD), looking back 60 days from end of report date
--   - inventory_logs aggregation: filter is_reversed=false, exclude DEDUCTs tied to a list_id
--     (those are auto-deducts from order completion, not independent staff actions)
--   - cycle_count_items: only status IN ('counted','verified')
--   - "Warehouse Team" profile (matched by full_name) is excluded from per-user metrics
--
-- task_buckets (done_today / in_progress / coming_up_next) intentionally NOT computed here.
-- That bucketing stays in client JS (historicalTaskStatus.ts is pure and tested in Phase 1).

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
  v_two_months_ago    timestamptz;
  v_warehouse_team_id uuid;
  v_orders_completed  int := 0;
  v_total_items       int := 0;
  v_correction_count  int := 0;
  v_verified_skus_2m  int := 0;
  v_total_skus        bigint := 0;
  v_accuracy_pct      numeric := 0;
  v_users             jsonb;
BEGIN
  -- 1. Day bounds (NY-correct UTC range, DST-safe)
  SELECT starts_at, ends_at
  INTO v_starts_at, v_ends_at
  FROM public.ny_day_bounds(p_report_date);

  -- 2. 60-day rolling window for accuracy lookback (anchored on report end, NOT now)
  v_two_months_ago := v_ends_at - interval '60 days';

  -- 3. Warehouse Team profile id (excluded from per-user aggregates)
  SELECT id INTO v_warehouse_team_id
  FROM public.profiles
  WHERE full_name = 'Warehouse Team' AND is_active = true
  LIMIT 1;

  -- 4. Warehouse totals (orders + items)
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

  -- 5. Correction count (rows in picking_list_notes for the day)
  SELECT COUNT(*)::int
  INTO v_correction_count
  FROM public.picking_list_notes
  WHERE created_at >= v_starts_at
    AND created_at <= v_ends_at;

  -- 6. Verified SKUs (60-day rolling window ending at v_ends_at)
  SELECT COUNT(DISTINCT sku)::int
  INTO v_verified_skus_2m
  FROM (
    SELECT sku FROM public.cycle_count_items
      WHERE status IN ('counted', 'verified')
        AND counted_at >= v_two_months_ago
        AND counted_at <= v_ends_at
        AND sku IS NOT NULL
    UNION ALL
    SELECT sku FROM public.inventory_logs
      WHERE action_type IN ('MOVE', 'ADD')
        AND is_reversed = false
        AND created_at >= v_two_months_ago
        AND created_at <= v_ends_at
        AND sku IS NOT NULL
  ) all_skus;

  -- 7. Total SKUs (denominator for accuracy)
  SELECT total_skus
  INTO v_total_skus
  FROM public.get_inventory_stats(true);

  -- 8. Accuracy percentage (rounded to 2 decimals)
  IF v_total_skus > 0 THEN
    v_accuracy_pct := round((v_verified_skus_2m::numeric / v_total_skus::numeric) * 100, 2);
  END IF;

  -- 9. Per-user activity aggregation
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
      -- DEDUCT: only manual deducts (no list_id). list_id-tied deducts are
      -- auto-deductions from order completion and must NOT count as staff activity.
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

  -- 10. Final assembly
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

COMMENT ON FUNCTION public.compute_daily_report_data(date) IS
  'Pure computation of daily activity report data for the given NY date. Mirrors useActivityReport client logic so live and snapshot reads are identical. Used by create_daily_report_snapshot and (read-only) by clients that need on-demand recomputation.';

REVOKE ALL ON FUNCTION public.compute_daily_report_data(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compute_daily_report_data(date) TO authenticated, service_role;

-- ============================================================================
-- create_daily_report_snapshot(p_report_date date) -> jsonb
-- ============================================================================
--
-- Cron entry point. Idempotent. Writes ONLY data_computed; never touches data_manual.
-- SECURITY DEFINER bypasses RLS so the cron (running as service_role) can write
-- yesterday's row even though RLS restricts authenticated users to today.

CREATE OR REPLACE FUNCTION public.create_daily_report_snapshot(p_report_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_computed jsonb;
BEGIN
  v_computed := public.compute_daily_report_data(p_report_date);

  INSERT INTO public.daily_reports (report_date, data_computed)
  VALUES (p_report_date, v_computed)
  ON CONFLICT (report_date) DO UPDATE SET
    data_computed = EXCLUDED.data_computed;
  -- IMPORTANT: data_manual is NEVER touched here. The touch_updated_at trigger
  -- will refresh updated_at automatically on the conflict path.

  RETURN jsonb_build_object(
    'success',     true,
    'report_date', p_report_date,
    'computed',    v_computed
  );
END;
$$;

COMMENT ON FUNCTION public.create_daily_report_snapshot(date) IS
  'Cron entry point: computes and persists data_computed for the given NY date. Idempotent. Never touches data_manual. SECURITY DEFINER so the cron bypasses RLS.';

REVOKE ALL ON FUNCTION public.create_daily_report_snapshot(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_daily_report_snapshot(date) TO service_role;

-- ============================================================================
-- save_daily_report_manual(p_report_date date, p_manual jsonb) -> void
-- ============================================================================
--
-- UI entry point for the Save button. Whitelists allowed top-level keys (defensive),
-- then upserts ONLY data_manual. Never touches data_computed. SECURITY INVOKER so RLS
-- applies — only admins can save, only for today.

CREATE OR REPLACE FUNCTION public.save_daily_report_manual(p_report_date date, p_manual jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cleaned jsonb;
BEGIN
  -- Whitelist of allowed top-level keys (matches DailyReportManual TS interface).
  -- Anything outside the whitelist is silently dropped — a buggy or malicious client
  -- cannot inject arbitrary keys into data_manual.
  WITH cleaned AS (
    SELECT jsonb_object_agg(key, value) AS data
    FROM jsonb_each(COALESCE(p_manual, '{}'::jsonb))
    WHERE key IN ('win_of_the_day', 'pickd_updates', 'routine_checklist', 'user_notes', 'schema_version')
  )
  SELECT COALESCE(data, '{}'::jsonb) INTO v_cleaned FROM cleaned;

  -- Upsert. RLS controls who can do this and for which dates (admin + today only).
  INSERT INTO public.daily_reports (report_date, data_manual, created_by, updated_by)
  VALUES (p_report_date, v_cleaned, auth.uid(), auth.uid())
  ON CONFLICT (report_date) DO UPDATE SET
    data_manual = EXCLUDED.data_manual,
    updated_by  = auth.uid();
  -- updated_at is refreshed automatically by trg_daily_reports_touch_updated_at
END;
$$;

COMMENT ON FUNCTION public.save_daily_report_manual(date, jsonb) IS
  'UI entry point for the Save button: upserts data_manual with whitelisted keys. SECURITY INVOKER so RLS applies — admins only, today only.';

REVOKE ALL ON FUNCTION public.save_daily_report_manual(date, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_daily_report_manual(date, jsonb) TO authenticated;

COMMIT;
