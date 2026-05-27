-- Test suite for pick_item / unpick_item group fallback behavior.
-- Run inside a transaction so nothing persists; the final ROLLBACK reverts
-- all fixture inserts and pick state changes.
--
-- Usage:
--   docker exec -i supabase_db_pickd psql -U postgres -d postgres \
--     < scripts/test-pick-item-group-fallback.sql
--
-- Each test prints \echo TEST N: expected vs actual, then a final summary.
-- Look for "FAIL" anywhere in the output.

\set ON_ERROR_STOP on
\set VERBOSITY terse
BEGIN;

-- ---------------------------------------------------------------------------
-- Fixture: a group with 3 sibling lists.
--   - LIST_A (anchor): item SKU-A @ ROW 1
--   - LIST_B (sibling): item SKU-B @ ROW 2
--   - LIST_C (sibling): item SKU-C @ ROW 3
-- Plus a non-grouped LIST_LONE with item SKU-LONE @ ROW 9.
-- Inventory rows so the compensate trigger has something to deduct against.
-- ---------------------------------------------------------------------------

-- Locations
INSERT INTO public.locations (id, warehouse, location, is_active)
VALUES
  ('11111111-0000-0000-0000-000000000001', 'TEST_WH', 'ROW 1', true),
  ('11111111-0000-0000-0000-000000000002', 'TEST_WH', 'ROW 2', true),
  ('11111111-0000-0000-0000-000000000003', 'TEST_WH', 'ROW 3', true),
  ('11111111-0000-0000-0000-000000000009', 'TEST_WH', 'ROW 9', true);

-- sku_metadata (FK target for inventory.sku)
INSERT INTO public.sku_metadata (sku) VALUES
  ('SKU-A'), ('SKU-B'), ('SKU-C'), ('SKU-LONE');

-- Inventory (qty 100 each so we can pick/unpick freely)
INSERT INTO public.inventory (sku, warehouse, location, location_id, quantity, is_active)
VALUES
  ('SKU-A',    'TEST_WH', 'ROW 1', '11111111-0000-0000-0000-000000000001', 100, true),
  ('SKU-B',    'TEST_WH', 'ROW 2', '11111111-0000-0000-0000-000000000002', 100, true),
  ('SKU-C',    'TEST_WH', 'ROW 3', '11111111-0000-0000-0000-000000000003', 100, true),
  ('SKU-LONE', 'TEST_WH', 'ROW 9', '11111111-0000-0000-0000-000000000009', 100, true);

-- Auth user + profile + presence + order_group (FK chain for picking_lists)
INSERT INTO auth.users (id, email, instance_id, aud, role)
VALUES ('22222222-0000-0000-0000-000000000001',
        'test-pick@example.com',
        '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, full_name)
VALUES ('22222222-0000-0000-0000-000000000001', 'Test User')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_presence (user_id)
VALUES ('22222222-0000-0000-0000-000000000001')
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.order_groups (id, group_type)
VALUES ('44444444-0000-0000-0000-000000000000', 'general')
ON CONFLICT (id) DO NOTHING;

-- Picking lists. group_id ties LIST_A/B/C together.
INSERT INTO public.picking_lists (id, user_id, status, group_id, order_number, items)
VALUES
  ('33333333-0000-0000-0000-00000000000A',
   '22222222-0000-0000-0000-000000000001',
   'double_checking',
   '44444444-0000-0000-0000-000000000000',
   'TEST-A',
   '[{"sku":"SKU-A","warehouse":"TEST_WH","location":"ROW 1","pickingQty":1,"item_name":"A"}]'::jsonb),
  ('33333333-0000-0000-0000-00000000000B',
   '22222222-0000-0000-0000-000000000001',
   'double_checking',
   '44444444-0000-0000-0000-000000000000',
   'TEST-B',
   '[{"sku":"SKU-B","warehouse":"TEST_WH","location":"ROW 2","pickingQty":2,"item_name":"B"}]'::jsonb),
  ('33333333-0000-0000-0000-00000000000C',
   '22222222-0000-0000-0000-000000000001',
   'double_checking',
   '44444444-0000-0000-0000-000000000000',
   'TEST-C',
   '[{"sku":"SKU-C","warehouse":"TEST_WH","location":"ROW 3","pickingQty":3,"item_name":"C"}]'::jsonb),
  -- Non-grouped: group_id NULL
  ('33333333-0000-0000-0000-0000000000FF',
   '22222222-0000-0000-0000-000000000001',
   'double_checking',
   NULL,
   'TEST-LONE',
   '[{"sku":"SKU-LONE","warehouse":"TEST_WH","location":"ROW 9","pickingQty":5,"item_name":"L"}]'::jsonb);

-- ---------------------------------------------------------------------------
-- TEST 1: Happy path, no fallback needed.
-- pick_item on LIST_A with SKU-A (which is in LIST_A) → resolved_via_group=false
-- ---------------------------------------------------------------------------
\echo
\echo === TEST 1: direct match, no fallback ===
SELECT
  CASE
    WHEN (r->>'list_id')::uuid = '33333333-0000-0000-0000-00000000000A'::uuid
     AND (r->>'resolved_via_group')::boolean = false
     AND (r->>'qty_deducted')::int = 1
    THEN 'PASS'
    ELSE 'FAIL: ' || r::text
  END AS result
FROM (
  SELECT pick_item(
    '33333333-0000-0000-0000-00000000000A'::uuid,
    'SKU-A','TEST_WH','ROW 1', 1,
    '22222222-0000-0000-0000-000000000001'::uuid, 'test'
  ) AS r
) t;

-- Verify inventory dropped 100→99 and items[0].picked=true on LIST_A
\echo Inventory after TEST 1 (expect SKU-A qty=99):
SELECT sku, quantity FROM public.inventory WHERE sku='SKU-A';

-- ---------------------------------------------------------------------------
-- TEST 2: Group fallback. Call pick_item with LIST_A (anchor) but for SKU-B.
-- Expected: resolves to LIST_B, resolved_via_group=true.
-- ---------------------------------------------------------------------------
\echo
\echo === TEST 2: anchor list_id, sibling SKU → group fallback ===
SELECT
  CASE
    WHEN (r->>'list_id')::uuid = '33333333-0000-0000-0000-00000000000B'::uuid
     AND (r->>'resolved_via_group')::boolean = true
     AND (r->>'qty_deducted')::int = 2
    THEN 'PASS'
    ELSE 'FAIL: ' || r::text
  END AS result
FROM (
  SELECT pick_item(
    '33333333-0000-0000-0000-00000000000A'::uuid,  -- anchor, not owner
    'SKU-B','TEST_WH','ROW 2', 2,
    '22222222-0000-0000-0000-000000000001'::uuid, 'test'
  ) AS r
) t;

\echo Inventory after TEST 2 (expect SKU-B qty=98):
SELECT sku, quantity FROM public.inventory WHERE sku='SKU-B';

-- Check the right list got the picked flag flipped (LIST_B, not LIST_A)
\echo Picked flags by list (expect TEST-A and TEST-B picked=true, TEST-C still false):
SELECT order_number, items->0->>'picked' AS picked_flag
FROM public.picking_lists
WHERE group_id='44444444-0000-0000-0000-000000000000'
ORDER BY order_number;

-- ---------------------------------------------------------------------------
-- TEST 3: unpick fallback. Use LIST_C as the seed; unpick SKU-B.
-- Expected: resolves to LIST_B, resolved_via_group=true, qty restored.
-- ---------------------------------------------------------------------------
\echo
\echo === TEST 3: unpick_item via group fallback ===
SELECT
  CASE
    WHEN (r->>'list_id')::uuid = '33333333-0000-0000-0000-00000000000B'::uuid
     AND (r->>'resolved_via_group')::boolean = true
     AND (r->>'qty_restored')::int = 2
    THEN 'PASS'
    ELSE 'FAIL: ' || r::text
  END AS result
FROM (
  SELECT unpick_item(
    '33333333-0000-0000-0000-00000000000C'::uuid,  -- different sibling
    'SKU-B','TEST_WH','ROW 2', 2,
    '22222222-0000-0000-0000-000000000001'::uuid, 'test'
  ) AS r
) t;

\echo Inventory after TEST 3 (expect SKU-B qty=100 again):
SELECT sku, quantity FROM public.inventory WHERE sku='SKU-B';

-- ---------------------------------------------------------------------------
-- TEST 4: Item nowhere in the group → still errors with "not found in list".
-- Backwards compatibility check: behavior unchanged for genuinely missing
-- items.
-- ---------------------------------------------------------------------------
\echo
\echo === TEST 4: item nowhere → preserves original error ===
DO $$
DECLARE v_msg text;
BEGIN
  BEGIN
    PERFORM pick_item(
      '33333333-0000-0000-0000-00000000000A'::uuid,
      'SKU-DOES-NOT-EXIST','TEST_WH','ROW 1', 1,
      '22222222-0000-0000-0000-000000000001'::uuid, 'test'
    );
    RAISE NOTICE 'FAIL: expected exception, got success';
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
    IF v_msg LIKE '%not found in list%' THEN
      RAISE NOTICE 'PASS (got: %)', v_msg;
    ELSE
      RAISE NOTICE 'FAIL (unexpected error: %)', v_msg;
    END IF;
  END;
END $$;

-- ---------------------------------------------------------------------------
-- TEST 5: Non-grouped list → no fallback path, still errors as before.
-- ---------------------------------------------------------------------------
\echo
\echo === TEST 5: non-grouped list, missing item → no fallback, original error ===
DO $$
DECLARE v_msg text;
BEGIN
  BEGIN
    PERFORM pick_item(
      '33333333-0000-0000-0000-0000000000FF'::uuid,
      'SKU-A','TEST_WH','ROW 1', 1,
      '22222222-0000-0000-0000-000000000001'::uuid, 'test'
    );
    RAISE NOTICE 'FAIL: expected exception, got success';
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
    IF v_msg LIKE '%not found in list%' THEN
      RAISE NOTICE 'PASS (got: %)', v_msg;
    ELSE
      RAISE NOTICE 'FAIL (unexpected: %)', v_msg;
    END IF;
  END;
END $$;

-- ---------------------------------------------------------------------------
-- TEST 6: Non-grouped happy path still works (regression check).
-- ---------------------------------------------------------------------------
\echo
\echo === TEST 6: non-grouped list, direct match still works ===
SELECT
  CASE
    WHEN (r->>'list_id')::uuid = '33333333-0000-0000-0000-0000000000FF'::uuid
     AND (r->>'resolved_via_group')::boolean = false
     AND (r->>'qty_deducted')::int = 5
    THEN 'PASS'
    ELSE 'FAIL: ' || r::text
  END AS result
FROM (
  SELECT pick_item(
    '33333333-0000-0000-0000-0000000000FF'::uuid,
    'SKU-LONE','TEST_WH','ROW 9', 5,
    '22222222-0000-0000-0000-000000000001'::uuid, 'test'
  ) AS r
) t;

\echo Inventory after TEST 6 (expect SKU-LONE qty=95):
SELECT sku, quantity FROM public.inventory WHERE sku='SKU-LONE';

-- ---------------------------------------------------------------------------
-- TEST 7: Idempotency. Pick same item twice → already_picked, no double deduct.
-- ---------------------------------------------------------------------------
\echo
\echo === TEST 7: idempotent re-pick (already_picked branch) ===
SELECT
  CASE
    WHEN (r->>'already_picked')::boolean = true
    THEN 'PASS'
    ELSE 'FAIL: ' || r::text
  END AS result
FROM (
  SELECT pick_item(
    '33333333-0000-0000-0000-00000000000A'::uuid,  -- via fallback
    'SKU-LONE','TEST_WH','ROW 9', 5,
    '22222222-0000-0000-0000-000000000001'::uuid, 'test'
  ) AS r
) t
WHERE false;  -- skip: SKU-LONE not in group; this would fail TEST 4 path

-- Re-pick SKU-A directly (already picked from TEST 1)
SELECT
  CASE
    WHEN (r->>'already_picked')::boolean = true
    THEN 'PASS'
    ELSE 'FAIL: ' || r::text
  END AS result
FROM (
  SELECT pick_item(
    '33333333-0000-0000-0000-00000000000A'::uuid,
    'SKU-A','TEST_WH','ROW 1', 1,
    '22222222-0000-0000-0000-000000000001'::uuid, 'test'
  ) AS r
) t;

\echo Inventory after TEST 7 (expect SKU-A still at 99, no double deduct):
SELECT sku, quantity FROM public.inventory WHERE sku='SKU-A';

-- ---------------------------------------------------------------------------
-- TEST 8: Status guard. A sibling in 'completed' status should not be matched.
-- Mark LIST_C completed, then try to fallback for SKU-C.
-- Expected: not found (sibling skipped because status filter).
-- ---------------------------------------------------------------------------
\echo
\echo === TEST 8: completed sibling is skipped by fallback ===
UPDATE public.picking_lists
SET status='completed', completed_snapshot='[]'::jsonb
WHERE id='33333333-0000-0000-0000-00000000000C';

DO $$
DECLARE v_msg text;
BEGIN
  BEGIN
    PERFORM pick_item(
      '33333333-0000-0000-0000-00000000000A'::uuid,
      'SKU-C','TEST_WH','ROW 3', 3,
      '22222222-0000-0000-0000-000000000001'::uuid, 'test'
    );
    RAISE NOTICE 'FAIL: expected not found, got success';
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
    IF v_msg LIKE '%not found in list%' THEN
      RAISE NOTICE 'PASS (got: %)', v_msg;
    ELSE
      RAISE NOTICE 'FAIL (unexpected: %)', v_msg;
    END IF;
  END;
END $$;

\echo
\echo === All tests done. Look for FAIL above. ===
ROLLBACK;
