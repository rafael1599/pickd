-- Inventory Accuracy KPI — redefinition (honest coverage + 180d window + sticky counts + picks).
--
-- WHY. The old KPI plateaued at ~69% and could never reach/hold 100% because:
--   1. Rolling 90-day window: any bike untouched for 90 days "expired" and
--      dragged the % down, even if its count was still correct.
--   2. Numerator was NOT a subset of the denominator: it counted bike SKUs
--      touched in logs even after they left stock (qty=0). Deployed reads
--      showed 367/532 = 68.98% while only 326 of those 367 were still in
--      active stock — an inflated, incoherent ratio.
--   3. Cycle counts expired on the same 90-day clock as incidental movements,
--      so deliberate audits earned no lasting credit.
--
-- NEW DEFINITION (single source of truth: get_inventory_accuracy).
--   Denominator = distinct active bike SKUs in LUDLOW with quantity > 0
--                 (identical set to get_inventory_stats(false).total_skus).
--   A denominator SKU is VERIFIED if EITHER:
--     (a) it has a cycle count (counted/verified) OR a physical log
--         (MOVE / ADD / PHYSICAL_DISTRIBUTION / EDIT-with-qty-change / DEDUCT pick)
--         within the 180-day window ending at the report date, OR
--     (b) STICKY: its most recent cycle count is at or after its most recent
--         quantity-changing log — i.e. nothing has altered the stock since we
--         last physically confirmed it, so the count is still trustworthy
--         regardless of age.
--   Numerator is intersected with the denominator set, so it is always a
--   subset (0..100%, coherent).
--
-- Projected against production the day this shipped: 470/532 = 88.3%
-- (vs 68.98% before). The remaining ~62 bikes have had no movement in 180d
-- and were never cycle-counted — a one-time count sweep + sticky takes it to
-- ~100% and HOLDS it (each future pick/move re-verifies its SKU).
--
-- Additive & idempotent: creates get_inventory_accuracy and CREATE OR REPLACEs
-- compute_daily_report_data to delegate to it. Output shape of the daily report
-- is unchanged except the breakdown gains a 'picked' key (older frontends
-- tolerate the extra key).

BEGIN;

-- ---------------------------------------------------------------------------
-- Single source of truth for the Inventory Accuracy KPI.
-- Used by compute_daily_report_data (snapshots) AND the live hook (today),
-- so the two can never drift.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_inventory_accuracy(
  p_as_of date DEFAULT current_date,
  p_window_days int DEFAULT 180
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH bounds AS (
    SELECT ends_at FROM public.ny_day_bounds(p_as_of)
  ),
  win AS (
    SELECT (SELECT ends_at FROM bounds) AS ends_at,
           (SELECT ends_at FROM bounds) - (p_window_days || ' days')::interval AS starts_at
  ),
  -- Denominator: active bike SKUs currently in stock (LUDLOW, qty>0).
  active_bikes AS (
    SELECT DISTINCT i.sku
    FROM public.inventory i
    JOIN public.sku_metadata sm ON sm.sku = i.sku
    WHERE i.is_active = true
      AND i.quantity > 0
      AND i.warehouse = 'LUDLOW'
      AND sm.is_bike = true
  ),
  -- (a) window verification: cycle counts within the window
  cycle_win AS (
    SELECT DISTINCT cci.sku
    FROM public.cycle_count_items cci
    WHERE cci.status IN ('counted', 'verified')
      AND cci.counted_at >= (SELECT starts_at FROM win)
      AND cci.counted_at <= (SELECT ends_at FROM win)
      AND cci.sku IN (SELECT sku FROM active_bikes)
  ),
  -- (a) window verification: physical inventory logs within the window
  log_win AS (
    SELECT il.sku,
      CASE il.action_type
        WHEN 'MOVE'                  THEN 'movements'
        WHEN 'ADD'                   THEN 'additions'
        WHEN 'PHYSICAL_DISTRIBUTION' THEN 'on_site_checked'
        WHEN 'EDIT'                  THEN 'quantity_edited'
        WHEN 'DEDUCT'                THEN 'picked'
      END AS category
    FROM public.inventory_logs il
    WHERE il.is_reversed = false
      AND il.created_at >= (SELECT starts_at FROM win)
      AND il.created_at <= (SELECT ends_at FROM win)
      AND il.sku IN (SELECT sku FROM active_bikes)
      AND (
        il.action_type IN ('MOVE', 'ADD', 'PHYSICAL_DISTRIBUTION', 'DEDUCT')
        OR (il.action_type = 'EDIT' AND COALESCE(il.quantity_change, 0) <> 0)
      )
  ),
  -- (b) sticky: last cycle count >= last quantity-changing log (count still valid).
  sticky AS (
    SELECT ab.sku
    FROM active_bikes ab
    JOIN LATERAL (
      SELECT max(c.counted_at) AS last_count
      FROM public.cycle_count_items c
      WHERE c.sku = ab.sku AND c.status IN ('counted', 'verified')
    ) cc ON true
    LEFT JOIN LATERAL (
      SELECT max(l.created_at) AS last_change
      FROM public.inventory_logs l
      WHERE l.sku = ab.sku AND l.is_reversed = false AND COALESCE(l.quantity_change, 0) <> 0
    ) qq ON true
    WHERE cc.last_count IS NOT NULL
      AND (qq.last_change IS NULL OR cc.last_count >= qq.last_change)
  ),
  -- cycle-verified = within window OR sticky
  cycle_verified AS (
    SELECT sku FROM cycle_win
    UNION
    SELECT sku FROM sticky
  ),
  verified AS (
    SELECT sku FROM cycle_verified
    UNION
    SELECT sku FROM log_win
  ),
  agg AS (
    SELECT
      (SELECT count(*) FROM active_bikes)                                          AS total_skus,
      (SELECT count(*) FROM verified)                                              AS verified_skus,
      (SELECT count(*) FROM cycle_verified)                                        AS b_cycle_counted,
      (SELECT count(DISTINCT sku) FROM log_win WHERE category = 'movements')       AS b_movements,
      (SELECT count(DISTINCT sku) FROM log_win WHERE category = 'additions')       AS b_additions,
      (SELECT count(DISTINCT sku) FROM log_win WHERE category = 'on_site_checked') AS b_on_site_checked,
      (SELECT count(DISTINCT sku) FROM log_win WHERE category = 'quantity_edited') AS b_quantity_edited,
      (SELECT count(DISTINCT sku) FROM log_win WHERE category = 'picked')          AS b_picked
  )
  SELECT jsonb_build_object(
    'pct', CASE WHEN total_skus > 0
                THEN round((verified_skus::numeric / total_skus::numeric) * 100, 2)
                ELSE 0 END,
    'verified_skus_2m', verified_skus,   -- key kept for backward compatibility
    'total_skus',       total_skus,
    'window_days',      p_window_days,
    'verified_skus_breakdown', jsonb_build_object(
      'cycle_counted',   b_cycle_counted,
      'movements',       b_movements,
      'additions',       b_additions,
      'on_site_checked', b_on_site_checked,
      'quantity_edited', b_quantity_edited,
      'picked',          b_picked
    )
  )
  FROM agg;
$$;

REVOKE ALL ON FUNCTION public.get_inventory_accuracy(date, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_inventory_accuracy(date, int) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Delegate the accuracy block of the daily report to the new function.
-- Everything else in compute_daily_report_data is unchanged.
-- ---------------------------------------------------------------------------
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
  v_warehouse_team_id uuid;
  v_orders_completed  int := 0;
  v_total_items       int := 0;
  v_correction_count  int := 0;
  v_accuracy          jsonb;
  v_verified_skus_2m  int := 0;
  v_total_skus        bigint := 0;
  v_accuracy_pct      numeric := 0;
  v_breakdown         jsonb;
  v_users             jsonb;
BEGIN
  SELECT starts_at, ends_at
  INTO v_starts_at, v_ends_at
  FROM public.ny_day_bounds(p_report_date);

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

  -- Inventory Accuracy — single source of truth (honest set + 180d + sticky + picks).
  v_accuracy := public.get_inventory_accuracy(p_report_date);
  v_verified_skus_2m := (v_accuracy->>'verified_skus_2m')::int;
  v_total_skus       := (v_accuracy->>'total_skus')::bigint;
  v_accuracy_pct     := (v_accuracy->>'pct')::numeric;
  v_breakdown        := v_accuracy->'verified_skus_breakdown';

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
    'schema_version',   3
  );
END;
$$;

REVOKE ALL ON FUNCTION public.compute_daily_report_data(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compute_daily_report_data(date) TO authenticated, service_role;

COMMIT;
