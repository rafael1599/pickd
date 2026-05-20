-- Test suite for get_clear_row_plan RPC.
-- Wraps in BEGIN/ROLLBACK so no fixture persists.

\set ON_ERROR_STOP on
\set VERBOSITY terse
BEGIN;

INSERT INTO public.sku_metadata (sku, is_bike) VALUES
  ('CR-HOT', true),    -- many orders → should be tagged 'active'
  ('CR-COLD', true),   -- no orders → 'slow'
  ('CR-MED', true),    -- 2 orders → 'active' (boundary)
  ('CR-PART', false)   -- not a bike → excluded by only_bikes=true
ON CONFLICT (sku) DO UPDATE SET is_bike = EXCLUDED.is_bike;

INSERT INTO public.inventory (sku, warehouse, location, quantity, is_active) VALUES
  ('CR-HOT',  'TEST_WH', 'CR ROW', 10, true),
  ('CR-COLD', 'TEST_WH', 'CR ROW',  4, true),
  ('CR-MED',  'TEST_WH', 'CR ROW',  3, true),
  ('CR-PART', 'TEST_WH', 'CR ROW',  7, true);

INSERT INTO auth.users (id, email, instance_id, aud, role)
VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-000000000099',
        'cr-test@example.com',
        '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.profiles (id, full_name) VALUES
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000099', 'CR Test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_presence (user_id) VALUES
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000099')
ON CONFLICT (user_id) DO NOTHING;

-- CR-HOT: 7 completed orders
INSERT INTO public.picking_lists (id, user_id, status, order_number, items, updated_at)
SELECT gen_random_uuid(), 'bbbbbbbb-bbbb-bbbb-bbbb-000000000099', 'completed', 'CRH-'||g,
       jsonb_build_array(jsonb_build_object(
         'sku','CR-HOT','warehouse','TEST_WH','location','CR ROW','pickingQty',1)),
       now() - (g||' days')::interval
FROM generate_series(1,7) g;

-- CR-MED: exactly 2 (threshold default)
INSERT INTO public.picking_lists (id, user_id, status, order_number, items, updated_at)
SELECT gen_random_uuid(), 'bbbbbbbb-bbbb-bbbb-bbbb-000000000099', 'completed', 'CRM-'||g,
       jsonb_build_array(jsonb_build_object(
         'sku','CR-MED','warehouse','TEST_WH','location','CR ROW','pickingQty',1)),
       now() - (g||' days')::interval
FROM generate_series(1,2) g;

-- CR-COLD: 0 orders. CR-PART: also 0 orders for fairness (only_bikes is the filter).

\echo
\echo === TEST 1: HOT tagged active, COLD tagged slow, MED tagged active (boundary) ===
SELECT CASE
  WHEN (SELECT suggested_zone FROM public.get_clear_row_plan('CR ROW','TEST_WH') WHERE sku='CR-HOT')  = 'active'
   AND (SELECT suggested_zone FROM public.get_clear_row_plan('CR ROW','TEST_WH') WHERE sku='CR-COLD') = 'slow'
   AND (SELECT suggested_zone FROM public.get_clear_row_plan('CR ROW','TEST_WH') WHERE sku='CR-MED')  = 'active'
  THEN 'PASS' ELSE 'FAIL' END AS result;

\echo
\echo === TEST 2: only_bikes=true excludes parts ===
SELECT CASE
  WHEN NOT exists(SELECT 1 FROM public.get_clear_row_plan('CR ROW','TEST_WH',true) WHERE sku='CR-PART')
   AND exists(SELECT 1 FROM public.get_clear_row_plan('CR ROW','TEST_WH',false) WHERE sku='CR-PART')
  THEN 'PASS' ELSE 'FAIL' END AS result;

\echo
\echo === TEST 3: custom active threshold flips MED to slow ===
-- p_active_threshold=3 means CR-MED (2 orders) should drop to slow.
SELECT CASE
  WHEN (SELECT suggested_zone FROM public.get_clear_row_plan('CR ROW','TEST_WH',true,3) WHERE sku='CR-MED') = 'slow'
  THEN 'PASS' ELSE 'FAIL' END AS result;

\echo
\echo === TEST 4: results ordered by orders_completed DESC ===
SELECT CASE
  WHEN (SELECT array_agg(sku) FROM (
          SELECT sku FROM public.get_clear_row_plan('CR ROW','TEST_WH')
          WHERE sku LIKE 'CR-%'
        ) t)
    = ARRAY['CR-HOT','CR-MED','CR-COLD']::text[]
  THEN 'PASS' ELSE 'FAIL' END AS result;

\echo
\echo === TEST 5: unknown row returns empty ===
SELECT CASE
  WHEN NOT exists(SELECT 1 FROM public.get_clear_row_plan('DOES NOT EXIST','TEST_WH'))
  THEN 'PASS' ELSE 'FAIL' END AS result;

\echo
\echo === All tests done. Look for FAIL above. ===
ROLLBACK;
