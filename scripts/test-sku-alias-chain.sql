-- Test suite for resolve_sku_chain() and get_inventory_logs_for_sku().
-- Wraps in BEGIN/ROLLBACK so no fixture data persists.
--
-- Usage:
--   docker exec -i supabase_db_pickd psql -U postgres -d postgres \
--     < scripts/test-sku-alias-chain.sql
--
-- Look for FAIL anywhere in the output.

\set ON_ERROR_STOP on
\set VERBOSITY terse
BEGIN;

-- Fixture: simulate two renames + one unrenamed SKU.
-- SKU-X (current) was renamed from SKU-Y, which was renamed from SKU-Z (chain of 3).
-- SKU-SOLO has never been renamed.
INSERT INTO public.sku_metadata (sku) VALUES ('SKU-X'),('SKU-Y'),('SKU-Z'),('SKU-SOLO')
ON CONFLICT (sku) DO NOTHING;

INSERT INTO auth.users (id, email, instance_id, aud, role)
VALUES ('77777777-0000-0000-0000-000000000001',
        'test-alias@example.com',
        '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')
ON CONFLICT (id) DO NOTHING;

-- Historical DEDUCT log under the oldest name (SKU-Z).
INSERT INTO public.inventory_logs (sku, action_type, quantity_change, performed_by, created_at)
VALUES ('SKU-Z', 'DEDUCT', -1, 'test', now() - interval '30 days');

-- Rename SKU-Z → SKU-Y. Two more DEDUCTs under SKU-Y.
INSERT INTO public.inventory_logs (sku, previous_sku, action_type, quantity_change, performed_by, created_at)
VALUES ('SKU-Y', 'SKU-Z', 'EDIT', 0, 'test', now() - interval '20 days');

INSERT INTO public.inventory_logs (sku, action_type, quantity_change, performed_by, created_at)
VALUES ('SKU-Y', 'DEDUCT', -1, 'test', now() - interval '15 days'),
       ('SKU-Y', 'DEDUCT', -2, 'test', now() - interval '10 days');

-- Rename SKU-Y → SKU-X. One DEDUCT after.
INSERT INTO public.inventory_logs (sku, previous_sku, action_type, quantity_change, performed_by, created_at)
VALUES ('SKU-X', 'SKU-Y', 'EDIT', 0, 'test', now() - interval '5 days');

INSERT INTO public.inventory_logs (sku, action_type, quantity_change, performed_by, created_at)
VALUES ('SKU-X', 'DEDUCT', -1, 'test', now() - interval '1 day');

-- SKU-SOLO has a single DEDUCT, never renamed.
INSERT INTO public.inventory_logs (sku, action_type, quantity_change, performed_by, created_at)
VALUES ('SKU-SOLO', 'DEDUCT', -1, 'test', now() - interval '3 days');

-- =========================================================================
-- TEST 1: chain resolution for 2-hop rename (SKU-X → SKU-Y → SKU-Z)
-- Expected: array contains all 3 names, current first.
-- =========================================================================
\echo
\echo === TEST 1: resolve_sku_chain walks 2 hops ===
SELECT CASE
         WHEN c = ARRAY['SKU-X','SKU-Y','SKU-Z']::text[]
         THEN 'PASS'
         ELSE 'FAIL: got ' || c::text
       END AS result
FROM (SELECT public.resolve_sku_chain('SKU-X') AS c) t;

-- =========================================================================
-- TEST 2: chain for never-renamed SKU = single-element array
-- =========================================================================
\echo
\echo === TEST 2: never-renamed SKU returns array of self ===
SELECT CASE
         WHEN c = ARRAY['SKU-SOLO']::text[] THEN 'PASS'
         ELSE 'FAIL: got ' || c::text
       END AS result
FROM (SELECT public.resolve_sku_chain('SKU-SOLO') AS c) t;

-- =========================================================================
-- TEST 3: chain for non-existent SKU = single-element with the input
-- (helper still returns the input itself so downstream queries don't crash)
-- =========================================================================
\echo
\echo === TEST 3: unknown SKU returns single-element chain ===
SELECT CASE
         WHEN c = ARRAY['SKU-DOES-NOT-EXIST']::text[] THEN 'PASS'
         ELSE 'FAIL: got ' || c::text
       END AS result
FROM (SELECT public.resolve_sku_chain('SKU-DOES-NOT-EXIST') AS c) t;

-- =========================================================================
-- TEST 4: NULL input returns empty array (don't crash)
-- =========================================================================
\echo
\echo === TEST 4: NULL input returns empty array ===
SELECT CASE
         WHEN array_length(c, 1) IS NULL THEN 'PASS'
         ELSE 'FAIL: got ' || c::text
       END AS result
FROM (SELECT public.resolve_sku_chain(NULL) AS c) t;

-- =========================================================================
-- TEST 5: alias-aware fetcher returns full history (current + all olds)
-- Expected: 6 logs for SKU-X (1 DEDUCT recent, 1 EDIT, 2 DEDUCT mid, 1 EDIT, 1 DEDUCT old).
-- =========================================================================
\echo
\echo === TEST 5: get_inventory_logs_for_sku aggregates across rename chain ===
SELECT CASE
         WHEN n = 6 THEN 'PASS'
         ELSE 'FAIL: expected 6 logs, got ' || n::text
       END AS result
FROM (SELECT count(*)::int AS n FROM public.get_inventory_logs_for_sku('SKU-X', 100)) t;

-- =========================================================================
-- TEST 6: naive query (only current SKU) returns only 2 logs (1 DEDUCT + 1 EDIT)
-- Regression baseline: confirms the bug exists without the fix.
-- =========================================================================
\echo
\echo === TEST 6: naive .eq(sku) query misses old-name history (baseline) ===
SELECT CASE
         WHEN n = 2 THEN 'PASS (confirms bug baseline)'
         ELSE 'FAIL: expected 2 naive logs, got ' || n::text
       END AS result
FROM (SELECT count(*)::int AS n FROM public.inventory_logs WHERE sku='SKU-X') t;

-- =========================================================================
-- TEST 7: limit parameter respected
-- =========================================================================
\echo
\echo === TEST 7: limit parameter caps results ===
SELECT CASE
         WHEN n = 3 THEN 'PASS'
         ELSE 'FAIL: expected 3 logs (limit), got ' || n::text
       END AS result
FROM (SELECT count(*)::int AS n FROM public.get_inventory_logs_for_sku('SKU-X', 3)) t;

-- =========================================================================
-- TEST 8: results ordered by created_at DESC (most recent first)
-- =========================================================================
\echo
\echo === TEST 8: results sorted DESC by created_at ===
WITH logs AS (
  SELECT created_at, ROW_NUMBER() OVER () AS rn
  FROM public.get_inventory_logs_for_sku('SKU-X', 100)
),
ordered_check AS (
  SELECT bool_and(a.created_at >= b.created_at) AS is_desc
  FROM logs a JOIN logs b ON b.rn = a.rn + 1
)
SELECT CASE WHEN is_desc THEN 'PASS' ELSE 'FAIL: not DESC sorted' END AS result
FROM ordered_check;

-- =========================================================================
-- TEST 9: cycle guard. Inject a deliberate cycle and confirm we don't hang.
-- Mark SKU-Z's previous_sku = SKU-X (cyclic).
-- =========================================================================
\echo
\echo === TEST 9: cycle guard prevents infinite walk ===
INSERT INTO public.inventory_logs (sku, previous_sku, action_type, quantity_change, performed_by, created_at)
VALUES ('SKU-Z', 'SKU-X', 'EDIT', 0, 'test', now());

SELECT CASE
         WHEN array_length(c,1) <= 4 THEN 'PASS (chain length ' || array_length(c,1)::text || ')'
         ELSE 'FAIL: chain grew to ' || array_length(c,1)::text
       END AS result
FROM (SELECT public.resolve_sku_chain('SKU-X') AS c) t;

\echo
\echo === All tests done. Look for FAIL above. ===
ROLLBACK;
