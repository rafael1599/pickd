-- Extend get_audit_rows with per-row accuracy %, waiting-inventory flag, and
-- missing-sublocation count. Powers the priority pills and accuracy badges
-- in the Cycle Count BY ROW view.

BEGIN;

DROP FUNCTION IF EXISTS public.get_audit_rows(text);

CREATE OR REPLACE FUNCTION public.get_audit_rows(p_warehouse text DEFAULT 'LUDLOW')
RETURNS TABLE(
  row_label text,
  sku_count int,
  skus_touched_90d int,
  last_touched_at timestamptz,
  has_waiting_skus boolean,
  missing_sublocation_count int
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH window_start AS (
    SELECT (now() - interval '90 days') AS ts
  ),
  row_items AS (
    SELECT
      upper(trim(location)) AS row_label,
      sku,
      sublocation
    FROM public.inventory
    WHERE warehouse = p_warehouse
      AND location ILIKE 'ROW%'
      AND is_active = true
  ),
  row_skus AS (
    SELECT DISTINCT row_label, sku FROM row_items
  ),
  sku_last_cc AS (
    SELECT sku, MAX(counted_at) AS ts
    FROM public.cycle_count_items
    WHERE status IN ('counted', 'verified') AND counted_at IS NOT NULL
    GROUP BY sku
  ),
  sku_last_log AS (
    SELECT sku, MAX(created_at) AS ts
    FROM public.inventory_logs
    WHERE action_type IN ('MOVE', 'ADD') AND is_reversed = false
    GROUP BY sku
  ),
  sku_touch AS (
    SELECT
      rs.row_label,
      rs.sku,
      GREATEST(cc.ts, logs.ts) AS last_ts
    FROM row_skus rs
    LEFT JOIN sku_last_cc cc ON cc.sku = rs.sku
    LEFT JOIN sku_last_log logs ON logs.sku = rs.sku
  ),
  -- SKUs blocking orders (long-waiting inventory, idea-053)
  waiting_skus AS (
    SELECT DISTINCT upper(item->>'sku') AS sku
    FROM public.picking_lists pl,
         jsonb_array_elements(pl.items) item
    WHERE pl.is_waiting_inventory = true
      AND pl.status = 'needs_correction'
      AND item->>'sku' IS NOT NULL
  ),
  -- Items in ROWs missing their sublocation letter
  missing_subloc AS (
    SELECT row_label, COUNT(*)::int AS cnt
    FROM row_items
    WHERE sublocation IS NULL
    GROUP BY row_label
  )
  SELECT
    st.row_label,
    COUNT(DISTINCT st.sku)::int AS sku_count,
    COUNT(DISTINCT st.sku) FILTER (
      WHERE st.last_ts >= (SELECT ts FROM window_start)
    )::int AS skus_touched_90d,
    MAX(st.last_ts) AS last_touched_at,
    bool_or(w.sku IS NOT NULL) AS has_waiting_skus,
    COALESCE(MAX(ms.cnt), 0) AS missing_sublocation_count
  FROM sku_touch st
  LEFT JOIN waiting_skus w ON w.sku = st.sku
  LEFT JOIN missing_subloc ms ON ms.row_label = st.row_label
  GROUP BY st.row_label
  ORDER BY
    COALESCE(
      NULLIF(regexp_replace(st.row_label, '[^0-9.]', '', 'g'), '')::numeric,
      999999
    ),
    st.row_label;
$$;

REVOKE ALL ON FUNCTION public.get_audit_rows(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_audit_rows(text) TO authenticated, service_role;

COMMIT;
