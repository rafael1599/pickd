-- Test suite for get_sku_movement_stats / get_sku_movement_stats_batch.
-- Wraps in BEGIN/ROLLBACK so no fixture persists.
--
-- Usage:
--   docker exec -i supabase_db_pickd psql -U postgres -d postgres \
--     < scripts/test-sku-movement-stats.sql

\set ON_ERROR_STOP on
\set VERBOSITY terse
BEGIN;

-- Fixture: a rename chain (NEW ← OLD), one solo SKU, and picking_lists
-- referencing both names in completed/active states.
INSERT INTO public.sku_metadata (sku) VALUES ('NEW-SKU'),('OLD-SKU'),('SOLO-SKU')
ON CONFLICT (sku) DO NOTHING;

INSERT INTO auth.users (id, email, instance_id, aud, role)
VALUES ('88888888-0000-0000-0000-000000000001',
        'mvmt-test@example.com',
        '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, full_name)
VALUES ('88888888-0000-0000-0000-000000000001', 'Mvmt Test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_presence (user_id)
VALUES ('88888888-0000-0000-0000-000000000001')
ON CONFLICT (user_id) DO NOTHING;

-- Record the rename in the audit log
INSERT INTO public.inventory_logs (sku, previous_sku, action_type, quantity_change, performed_by, created_at)
VALUES ('NEW-SKU', 'OLD-SKU', 'EDIT', 0, 'test', now() - interval '5 days');

-- Completed orders under OLD-SKU (before rename): 3 orders, qty 1+2+3 = 6 units
INSERT INTO public.picking_lists (id, user_id, status, order_number, items, updated_at)
VALUES
  (gen_random_uuid(), '88888888-0000-0000-0000-000000000001', 'completed', 'MV-001',
   '[{"sku":"OLD-SKU","warehouse":"TEST","location":"R1","pickingQty":1}]'::jsonb,
   now() - interval '20 days'),
  (gen_random_uuid(), '88888888-0000-0000-0000-000000000001', 'completed', 'MV-002',
   '[{"sku":"OLD-SKU","warehouse":"TEST","location":"R1","pickingQty":2}]'::jsonb,
   now() - interval '15 days'),
  (gen_random_uuid(), '88888888-0000-0000-0000-000000000001', 'completed', 'MV-003',
   '[{"sku":"OLD-SKU","warehouse":"TEST","location":"R1","pickingQty":3}]'::jsonb,
   now() - interval '10 days');

-- Completed orders under NEW-SKU (after rename): 2 orders, qty 4+5 = 9 units
INSERT INTO public.picking_lists (id, user_id, status, order_number, items, updated_at)
VALUES
  (gen_random_uuid(), '88888888-0000-0000-0000-000000000001', 'completed', 'MV-004',
   '[{"sku":"NEW-SKU","warehouse":"TEST","location":"R1","pickingQty":4}]'::jsonb,
   now() - interval '3 days'),
  (gen_random_uuid(), '88888888-0000-0000-0000-000000000001', 'completed', 'MV-005',
   '[{"sku":"NEW-SKU","warehouse":"TEST","location":"R1","pickingQty":5}]'::jsonb,
   now() - interval '1 day');

-- Active (non-completed) order under NEW-SKU — must NOT count
INSERT INTO public.picking_lists (id, user_id, status, order_number, items, updated_at)
VALUES
  (gen_random_uuid(), '88888888-0000-0000-0000-000000000001', 'active', 'MV-006',
   '[{"sku":"NEW-SKU","warehouse":"TEST","location":"R1","pickingQty":99}]'::jsonb,
   now());

-- SOLO-SKU: 1 completed order for sanity baseline
INSERT INTO public.picking_lists (id, user_id, status, order_number, items, updated_at)
VALUES
  (gen_random_uuid(), '88888888-0000-0000-0000-000000000001', 'completed', 'MV-007',
   '[{"sku":"SOLO-SKU","warehouse":"TEST","location":"R1","pickingQty":7}]'::jsonb,
   now() - interval '2 days');

-- =========================================================================
-- TEST 1: stats for renamed SKU include orders under old name
-- Expected: 5 orders (3 OLD + 2 NEW), 15 units (1+2+3+4+5), chain has 2 names.
-- =========================================================================
\echo
\echo === TEST 1: renamed SKU aggregates across full chain ===
SELECT CASE
         WHEN orders_completed = 5
          AND units_shipped::int = 15
          AND alias_chain = ARRAY['NEW-SKU','OLD-SKU']::text[]
         THEN 'PASS'
         ELSE 'FAIL: orders=' || orders_completed || ' units=' || units_shipped || ' chain=' || alias_chain::text
       END AS result
FROM public.get_sku_movement_stats('NEW-SKU');

-- =========================================================================
-- TEST 2: stats for never-renamed SKU work normally
-- =========================================================================
\echo
\echo === TEST 2: never-renamed SKU baseline ===
SELECT CASE
         WHEN orders_completed = 1
          AND units_shipped::int = 7
          AND alias_chain = ARRAY['SOLO-SKU']::text[]
         THEN 'PASS'
         ELSE 'FAIL: orders=' || orders_completed || ' units=' || units_shipped
       END AS result
FROM public.get_sku_movement_stats('SOLO-SKU');

-- =========================================================================
-- TEST 3: active / non-completed orders excluded
-- (Already implicit in TEST 1 — the qty=99 active order would have pushed
-- units_shipped to 114. Explicit recheck.)
-- =========================================================================
\echo
\echo === TEST 3: non-completed orders excluded ===
SELECT CASE
         WHEN units_shipped::int = 15 THEN 'PASS'
         ELSE 'FAIL: leaked active order, units=' || units_shipped
       END AS result
FROM public.get_sku_movement_stats('NEW-SKU');

-- =========================================================================
-- TEST 4: p_since filter
-- Expected: only orders from last 7 days count → NEW-SKU has 2 orders (4+5=9 units).
-- =========================================================================
\echo
\echo === TEST 4: p_since timestamp filter ===
SELECT CASE
         WHEN orders_completed = 2 AND units_shipped::int = 9 THEN 'PASS'
         ELSE 'FAIL: orders=' || orders_completed || ' units=' || units_shipped
       END AS result
FROM public.get_sku_movement_stats('NEW-SKU', now() - interval '7 days');

-- =========================================================================
-- TEST 5: SKU never shipped returns 0/0 (not NULL)
-- =========================================================================
\echo
\echo === TEST 5: never-shipped SKU returns zero counts ===
SELECT CASE
         WHEN orders_completed = 0 AND units_shipped = 0
          AND first_shipped IS NULL AND last_shipped IS NULL
         THEN 'PASS'
         ELSE 'FAIL'
       END AS result
FROM public.get_sku_movement_stats('UNKNOWN-XYZ');

-- =========================================================================
-- TEST 6: batch RPC returns one row per input SKU
-- =========================================================================
\echo
\echo === TEST 6: batch RPC fan-out ===
SELECT CASE
         WHEN count(*) = 3
          AND sum(orders_completed) = 6  -- 5 (NEW chain) + 1 (SOLO) + 0
          AND sum(units_shipped)::int = 22  -- 15 + 7 + 0
         THEN 'PASS'
         ELSE 'FAIL: rows=' || count(*) || ' orders=' || sum(orders_completed) || ' units=' || sum(units_shipped)
       END AS result
FROM public.get_sku_movement_stats_batch(ARRAY['NEW-SKU','SOLO-SKU','UNKNOWN-XYZ']);

-- =========================================================================
-- TEST 7: first/last shipped dates point to chain extremes
-- Expected: first ≈ 20 days ago (OLD-SKU MV-001), last ≈ 1 day ago (NEW-SKU MV-005).
-- =========================================================================
\echo
\echo === TEST 7: date range spans both old and new chain ===
SELECT CASE
         WHEN first_shipped < now() - interval '15 days'
          AND last_shipped  > now() - interval '3 days'
         THEN 'PASS'
         ELSE 'FAIL: first=' || first_shipped::text || ' last=' || last_shipped::text
       END AS result
FROM public.get_sku_movement_stats('NEW-SKU');

\echo
\echo === All tests done. Look for FAIL above. ===
ROLLBACK;
