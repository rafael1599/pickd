-- FedEx Returns historical cleanup — 2026-05-06
--
-- WHAT THIS DOES (preserves all FedEx records — no DELETE on fedex_returns/_items):
--   1. Identifies pairs of (placeholder, real) fedex_return_items per return
--      where the placeholder still has sku=tracking_number and a sibling
--      real-SKU row was added afterward.
--   2. Promotes the placeholder row by copying the real SKU + item_name +
--      target_location into it (preserving original created_at/id), then
--      DELETES the duplicate real row.
--   3. For every "tracking-number SKU" still active in inventory, sets
--      qty=0/is_active=false and prefixes item_name with [deduped]. Keeps
--      the row (no DELETE) for audit.
--   4. Marks resolved any return whose items are now all moved.
--
-- USAGE — RUN INSIDE A TRANSACTION FIRST FOR PREVIEW:
--   BEGIN;
--   \i scripts/fedex_returns_cleanup_20260506.sql
--   -- Inspect counts; if good:
--   COMMIT;  -- or ROLLBACK to undo
--
-- SAFETY: this script does NOT delete any fedex_returns row. fedex_return_items
-- rows are deleted ONLY when a duplicate has been merged into its sibling.

-- ─────────────────────────────────────────────────────────────────────
-- Step 1: build the merge plan in a temp table.
-- ─────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS _merge_plan;
CREATE TEMP TABLE _merge_plan AS
SELECT
  ph.id  AS placeholder_id,
  rl.id  AS real_id,
  rl.sku AS real_sku,
  rl.item_name AS real_item_name,
  rl.target_location AS real_target_location,
  rl.target_warehouse AS real_target_warehouse,
  rl.condition AS real_condition,
  rl.moved_at AS real_moved_at,
  rl.moved_to_location AS real_moved_to_location,
  rl.moved_to_warehouse AS real_moved_to_warehouse,
  ph.return_id,
  fr.tracking_number
FROM fedex_return_items ph
JOIN fedex_returns fr ON fr.id = ph.return_id
JOIN fedex_return_items rl
  ON rl.return_id = ph.return_id
 AND rl.id <> ph.id
 AND rl.sku <> fr.tracking_number  -- the "real" row has a non-tracking SKU
WHERE ph.sku = fr.tracking_number
  -- Multiple reals possible; pick the most recent if so.
  AND rl.created_at = (
    SELECT MAX(rl2.created_at)
    FROM fedex_return_items rl2
    WHERE rl2.return_id = ph.return_id
      AND rl2.id <> ph.id
      AND rl2.sku <> fr.tracking_number
  );

\echo '=== Step 1: merge plan rows (pairs to consolidate) ==='
SELECT COUNT(*) AS pairs_to_merge FROM _merge_plan;

-- ─────────────────────────────────────────────────────────────────────
-- Step 2: promote placeholder rows (rename in place, preserve created_at).
-- ─────────────────────────────────────────────────────────────────────
UPDATE fedex_return_items ph
SET
  sku                = mp.real_sku,
  item_name          = COALESCE(mp.real_item_name, ph.item_name),
  target_location    = COALESCE(mp.real_target_location, ph.target_location),
  target_warehouse   = COALESCE(mp.real_target_warehouse, ph.target_warehouse, 'LUDLOW'),
  condition          = COALESCE(mp.real_condition, ph.condition),
  moved_at           = COALESCE(mp.real_moved_at, ph.moved_at),
  moved_to_location  = COALESCE(mp.real_moved_to_location, ph.moved_to_location),
  moved_to_warehouse = COALESCE(mp.real_moved_to_warehouse, ph.moved_to_warehouse)
FROM _merge_plan mp
WHERE ph.id = mp.placeholder_id;

\echo '=== Step 2: promoted N placeholders (UPDATE row count above) ==='

-- ─────────────────────────────────────────────────────────────────────
-- Step 3: delete the duplicate "real" rows (the placeholder row now holds
-- their data with the older created_at preserved).
-- ─────────────────────────────────────────────────────────────────────
DELETE FROM fedex_return_items
WHERE id IN (SELECT real_id FROM _merge_plan);

\echo '=== Step 3: deleted N duplicate items (DELETE row count above) ==='

-- ─────────────────────────────────────────────────────────────────────
-- Step 4: ghost inventory cleanup. For every inventory row whose SKU is a
-- tracking number (purely digits, length >= 10) AND still active, drain it
-- to qty=0 and mark as deduped. Audit row preserved (no DELETE).
-- ─────────────────────────────────────────────────────────────────────
\echo '=== Step 4: ghost inventory rows about to be deduped ==='
SELECT id, sku, location, quantity, is_active, item_name
FROM inventory
WHERE sku ~ '^\d{10,}$'
  AND is_active = TRUE
ORDER BY sku;

UPDATE inventory
SET quantity  = 0,
    is_active = FALSE,
    item_name = CASE
      WHEN COALESCE(item_name, '') NOT LIKE '[deduped]%'
        THEN '[deduped] ' || COALESCE(item_name, '')
      ELSE item_name
    END
WHERE sku ~ '^\d{10,}$'
  AND is_active = TRUE;

-- ─────────────────────────────────────────────────────────────────────
-- Step 5: auto-resolve returns whose items are all moved.
-- ─────────────────────────────────────────────────────────────────────
UPDATE fedex_returns r
SET status = 'resolved',
    resolved_at = COALESCE(r.resolved_at, NOW()),
    updated_at = NOW()
WHERE r.status <> 'resolved'
  AND NOT EXISTS (
    SELECT 1 FROM fedex_return_items i
    WHERE i.return_id = r.id AND i.moved_to_location IS NULL
  )
  AND EXISTS (
    SELECT 1 FROM fedex_return_items i WHERE i.return_id = r.id
  );

\echo '=== Step 5: returns auto-resolved ==='

-- ─────────────────────────────────────────────────────────────────────
-- Final: summary.
-- ─────────────────────────────────────────────────────────────────────
\echo '=== Final summary ==='
SELECT
  (SELECT COUNT(*) FROM fedex_returns) AS total_returns,
  (SELECT COUNT(*) FROM fedex_returns WHERE status='resolved') AS resolved,
  (SELECT COUNT(*) FROM fedex_return_items) AS total_items,
  (SELECT COUNT(*) FROM fedex_return_items WHERE moved_to_location IS NOT NULL) AS moved_items,
  (SELECT COUNT(*) FROM inventory WHERE sku ~ '^\d{10,}$' AND is_active = TRUE) AS active_ghosts;

\echo 'If active_ghosts > 0, investigate manually before COMMIT.'
\echo 'If counts look right: COMMIT; (else ROLLBACK;)'
