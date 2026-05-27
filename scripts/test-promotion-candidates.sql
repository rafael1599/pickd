-- Test suite for get_promotion_candidates RPC.
-- Wraps in BEGIN/ROLLBACK so no fixture persists.

\set ON_ERROR_STOP on
\set VERBOSITY terse
BEGIN;

INSERT INTO public.sku_metadata (sku, is_bike) VALUES
  ('PROM-HOT-DEEP', true),     -- high movement, sitting in slow zone — primary case
  ('PROM-COLD-DEEP', true),    -- low movement, slow zone — should NOT appear
  ('PROM-HOT-ACTIVE', true)    -- high movement, already in active zone — should NOT appear
ON CONFLICT (sku) DO UPDATE SET is_bike = EXCLUDED.is_bike;

INSERT INTO public.inventory (sku, warehouse, location, quantity, is_active) VALUES
  ('PROM-HOT-DEEP',   'TEST_WH', 'ROW 28', 8, true),
  ('PROM-COLD-DEEP',  'TEST_WH', 'ROW 28', 4, true),
  ('PROM-HOT-ACTIVE', 'TEST_WH', 'ROW 1',  6, true);

INSERT INTO auth.users (id, email, instance_id, aud, role)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000099',
        'prom-test@example.com',
        '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.profiles (id, full_name) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000099', 'Prom Test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_presence (user_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000099')
ON CONFLICT (user_id) DO NOTHING;

-- PROM-HOT-DEEP has 5 completed orders → above default threshold (2)
INSERT INTO public.picking_lists (id, user_id, status, order_number, items, updated_at)
SELECT gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-000000000099', 'completed', 'PR-H-'||g,
       jsonb_build_array(jsonb_build_object(
         'sku','PROM-HOT-DEEP','warehouse','TEST_WH','location','ROW 28','pickingQty',1)),
       now() - (g||' days')::interval
FROM generate_series(1,5) g;

-- PROM-COLD-DEEP has 1 completed order → below default threshold
INSERT INTO public.picking_lists (id, user_id, status, order_number, items, updated_at)
VALUES (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-000000000099', 'completed', 'PR-C-1',
        '[{"sku":"PROM-COLD-DEEP","warehouse":"TEST_WH","location":"ROW 28","pickingQty":1}]'::jsonb,
        now() - interval '3 days');

-- PROM-HOT-ACTIVE has 10 completed orders BUT lives in ROW 1 (active zone)
INSERT INTO public.picking_lists (id, user_id, status, order_number, items, updated_at)
SELECT gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-000000000099', 'completed', 'PR-A-'||g,
       jsonb_build_array(jsonb_build_object(
         'sku','PROM-HOT-ACTIVE','warehouse','TEST_WH','location','ROW 1','pickingQty',1)),
       now() - (g||' days')::interval
FROM generate_series(1,10) g;

\echo
\echo === TEST 1: HOT-in-deep appears (min_orders=2) ===
SELECT CASE
  WHEN exists(SELECT 1 FROM public.get_promotion_candidates(2, true) WHERE sku='PROM-HOT-DEEP')
  THEN 'PASS' ELSE 'FAIL' END AS result;

\echo
\echo === TEST 2: COLD-in-deep does NOT appear (1 order < 2) ===
SELECT CASE
  WHEN NOT exists(SELECT 1 FROM public.get_promotion_candidates(2, true) WHERE sku='PROM-COLD-DEEP')
  THEN 'PASS' ELSE 'FAIL' END AS result;

\echo
\echo === TEST 3: HOT already in active zone is NOT a candidate ===
SELECT CASE
  WHEN NOT exists(SELECT 1 FROM public.get_promotion_candidates(2, true) WHERE sku='PROM-HOT-ACTIVE')
  THEN 'PASS' ELSE 'FAIL' END AS result;

\echo
\echo === TEST 4: results ORDER BY orders_completed DESC (most-moved first) ===
-- Add a second hot-in-deep with 3 orders so we can verify ordering.
INSERT INTO public.sku_metadata (sku, is_bike) VALUES ('PROM-HOT-DEEP-2', true) ON CONFLICT (sku) DO NOTHING;
INSERT INTO public.inventory (sku, warehouse, location, quantity, is_active)
VALUES ('PROM-HOT-DEEP-2', 'TEST_WH', 'ROW 30', 5, true);
INSERT INTO public.picking_lists (id, user_id, status, order_number, items, updated_at)
SELECT gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-000000000099', 'completed', 'PR-H2-'||g,
       jsonb_build_array(jsonb_build_object(
         'sku','PROM-HOT-DEEP-2','warehouse','TEST_WH','location','ROW 30','pickingQty',1)),
       now() - (g||' days')::interval
FROM generate_series(1,3) g;

SELECT CASE
  WHEN array_agg(sku ORDER BY orders_completed DESC) = ARRAY['PROM-HOT-DEEP','PROM-HOT-DEEP-2']::text[]
  THEN 'PASS' ELSE 'FAIL' END AS result
FROM public.get_promotion_candidates(2, true)
WHERE sku IN ('PROM-HOT-DEEP','PROM-HOT-DEEP-2');

\echo
\echo === TEST 5: custom source_rows narrows the scope ===
SELECT CASE
  WHEN exists(SELECT 1 FROM public.get_promotion_candidates(2, true, ARRAY['ROW 30']) WHERE sku='PROM-HOT-DEEP-2')
   AND NOT exists(SELECT 1 FROM public.get_promotion_candidates(2, true, ARRAY['ROW 30']) WHERE sku='PROM-HOT-DEEP')
  THEN 'PASS' ELSE 'FAIL' END AS result;

\echo
\echo === TEST 6: only_bikes filter excludes parts ===
INSERT INTO public.sku_metadata (sku, is_bike) VALUES ('PROM-PART', false) ON CONFLICT (sku) DO UPDATE SET is_bike=false;
INSERT INTO public.inventory (sku, warehouse, location, quantity, is_active)
VALUES ('PROM-PART', 'TEST_WH', 'ROW 28', 5, true);
INSERT INTO public.picking_lists (id, user_id, status, order_number, items, updated_at)
SELECT gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-000000000099', 'completed', 'PR-P-'||g,
       jsonb_build_array(jsonb_build_object(
         'sku','PROM-PART','warehouse','TEST_WH','location','ROW 28','pickingQty',1)),
       now() - (g||' days')::interval
FROM generate_series(1,4) g;

SELECT CASE
  WHEN NOT exists(SELECT 1 FROM public.get_promotion_candidates(2, true) WHERE sku='PROM-PART')
   AND exists(SELECT 1 FROM public.get_promotion_candidates(2, false) WHERE sku='PROM-PART')
  THEN 'PASS' ELSE 'FAIL' END AS result;

\echo
\echo === All tests done. Look for FAIL above. ===
ROLLBACK;
