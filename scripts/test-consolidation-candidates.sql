-- Test suite for get_consolidation_candidates RPC.
-- Wraps in BEGIN/ROLLBACK so no fixture data persists.
--
-- Usage:
--   docker exec -i supabase_db_pickd psql -U postgres -d postgres \
--     < scripts/test-consolidation-candidates.sql

\set ON_ERROR_STOP on
\set VERBOSITY terse
BEGIN;

-- Fixture: 3 SKUs with different ship histories + 1 deactivated row.
INSERT INTO public.sku_metadata (sku, is_bike) VALUES
  ('CONS-BIKE-NEVER', true),
  ('CONS-BIKE-MOVED', true),
  ('CONS-PART-NEVER', false)
ON CONFLICT (sku) DO UPDATE SET is_bike = EXCLUDED.is_bike;

INSERT INTO public.inventory (sku, warehouse, location, quantity, is_active) VALUES
  ('CONS-BIKE-NEVER', 'TEST_WH', 'ROW 99', 5, true),
  ('CONS-BIKE-MOVED', 'TEST_WH', 'ROW 99', 3, true),
  ('CONS-PART-NEVER', 'TEST_WH', 'ROW 99', 10, true);

INSERT INTO auth.users (id, email, instance_id, aud, role)
VALUES ('99999999-0000-0000-0000-000000000001',
        'cons-test@example.com',
        '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, full_name)
VALUES ('99999999-0000-0000-0000-000000000001', 'Cons Test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_presence (user_id)
VALUES ('99999999-0000-0000-0000-000000000001')
ON CONFLICT (user_id) DO NOTHING;

-- CONS-BIKE-MOVED has shipped in 3 completed orders
INSERT INTO public.picking_lists (id, user_id, status, order_number, items, updated_at) VALUES
  (gen_random_uuid(), '99999999-0000-0000-0000-000000000001', 'completed', 'C-001',
   '[{"sku":"CONS-BIKE-MOVED","warehouse":"TEST_WH","location":"ROW 99","pickingQty":1}]'::jsonb,
   now() - interval '5 days'),
  (gen_random_uuid(), '99999999-0000-0000-0000-000000000001', 'completed', 'C-002',
   '[{"sku":"CONS-BIKE-MOVED","warehouse":"TEST_WH","location":"ROW 99","pickingQty":1}]'::jsonb,
   now() - interval '3 days'),
  (gen_random_uuid(), '99999999-0000-0000-0000-000000000001', 'completed', 'C-003',
   '[{"sku":"CONS-BIKE-MOVED","warehouse":"TEST_WH","location":"ROW 99","pickingQty":1}]'::jsonb,
   now() - interval '1 day');

-- =========================================================================
-- TEST 1: only_bikes=true filters out non-bike SKUs
-- =========================================================================
\echo
\echo === TEST 1: only_bikes filter ===
SELECT CASE
         WHEN bool_and(sku LIKE 'CONS-BIKE-%' OR sku NOT LIKE 'CONS-%') THEN 'PASS'
         ELSE 'FAIL: returned non-bike SKU'
       END AS result
FROM public.get_consolidation_candidates(0, true)
WHERE sku LIKE 'CONS-%';

-- =========================================================================
-- TEST 2: only_bikes=false includes parts
-- =========================================================================
\echo
\echo === TEST 2: only_bikes=false includes parts ===
SELECT CASE
         WHEN exists(SELECT 1 FROM public.get_consolidation_candidates(0, false) WHERE sku = 'CONS-PART-NEVER')
         THEN 'PASS' ELSE 'FAIL' END AS result;

-- =========================================================================
-- TEST 3: max_orders=0 excludes SKUs that have shipped
-- Expected: CONS-BIKE-NEVER appears, CONS-BIKE-MOVED does not.
-- =========================================================================
\echo
\echo === TEST 3: max_orders=0 excludes moved SKUs ===
SELECT CASE
         WHEN exists(SELECT 1 FROM public.get_consolidation_candidates(0, true) WHERE sku = 'CONS-BIKE-NEVER')
          AND NOT exists(SELECT 1 FROM public.get_consolidation_candidates(0, true) WHERE sku = 'CONS-BIKE-MOVED')
         THEN 'PASS' ELSE 'FAIL' END AS result;

-- =========================================================================
-- TEST 4: max_orders=3 includes the moved SKU
-- =========================================================================
\echo
\echo === TEST 4: max_orders=3 includes ship-3 SKU ===
SELECT CASE
         WHEN exists(SELECT 1 FROM public.get_consolidation_candidates(3, true) WHERE sku = 'CONS-BIKE-MOVED')
         THEN 'PASS' ELSE 'FAIL' END AS result;

-- =========================================================================
-- TEST 5: alias_chain is populated (verifies rename-awareness wiring)
-- =========================================================================
\echo
\echo === TEST 5: alias_chain populated for never-renamed SKU ===
SELECT CASE
         WHEN alias_chain = ARRAY['CONS-BIKE-NEVER']::text[] THEN 'PASS'
         ELSE 'FAIL: chain=' || alias_chain::text END AS result
FROM public.get_consolidation_candidates(0, true)
WHERE sku = 'CONS-BIKE-NEVER';

-- =========================================================================
-- TEST 6: deactivated row not returned
-- =========================================================================
\echo
\echo === TEST 6: is_active=false excluded ===
UPDATE public.inventory SET is_active=false WHERE sku='CONS-BIKE-NEVER';
SELECT CASE
         WHEN NOT exists(SELECT 1 FROM public.get_consolidation_candidates(0, true) WHERE sku = 'CONS-BIKE-NEVER')
         THEN 'PASS' ELSE 'FAIL' END AS result;

\echo
\echo === All tests done. Look for FAIL above. ===
ROLLBACK;
