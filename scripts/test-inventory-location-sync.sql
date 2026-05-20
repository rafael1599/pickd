-- Test suite for the inventory.location ↔ location_id sync trigger.
-- Covers all 10 cases of the trigger logic + the monitoring view + the
-- backfill. Wraps in BEGIN/ROLLBACK so no fixture data persists.
--
-- Usage:
--   docker exec -i supabase_db_pickd psql -U postgres -d postgres \
--     < scripts/test-inventory-location-sync.sql

\set ON_ERROR_STOP on
\set VERBOSITY terse
BEGIN;

-- Fixture: 3 locations + 1 sku.
INSERT INTO public.locations (id, warehouse, location, is_active) VALUES
  ('11111111-aaaa-aaaa-aaaa-000000000001', 'TEST_WH', 'ROW A', true),
  ('11111111-aaaa-aaaa-aaaa-000000000002', 'TEST_WH', 'ROW B', true),
  ('11111111-aaaa-aaaa-aaaa-000000000003', 'TEST_WH', 'ROW C', true);

INSERT INTO public.sku_metadata (sku) VALUES ('SYNC-TEST-1') ON CONFLICT (sku) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────
-- INSERT cases
-- ─────────────────────────────────────────────────────────────────

\echo
\echo === TEST 1: INSERT with text only → FK resolved ===
INSERT INTO public.inventory (sku, warehouse, location, quantity, is_active)
VALUES ('SYNC-TEST-1', 'TEST_WH', 'ROW A', 1, true)
RETURNING id, sku, location, location_id;

SELECT CASE
  WHEN location_id = '11111111-aaaa-aaaa-aaaa-000000000001' THEN 'PASS'
  ELSE 'FAIL: location_id=' || COALESCE(location_id::text, 'NULL')
END AS result
FROM public.inventory WHERE sku='SYNC-TEST-1';

DELETE FROM public.inventory WHERE sku='SYNC-TEST-1';


\echo
\echo === TEST 2: INSERT with FK only → text set ===
INSERT INTO public.inventory (sku, warehouse, location_id, quantity, is_active)
VALUES ('SYNC-TEST-1', 'TEST_WH', '11111111-aaaa-aaaa-aaaa-000000000002', 1, true);

SELECT CASE
  WHEN location = 'ROW B' THEN 'PASS'
  ELSE 'FAIL: location=' || COALESCE(location, 'NULL')
END AS result
FROM public.inventory WHERE sku='SYNC-TEST-1';

DELETE FROM public.inventory WHERE sku='SYNC-TEST-1';


\echo
\echo === TEST 3: INSERT with both agreeing → no change ===
INSERT INTO public.inventory (sku, warehouse, location, location_id, quantity, is_active)
VALUES ('SYNC-TEST-1', 'TEST_WH', 'ROW A', '11111111-aaaa-aaaa-aaaa-000000000001', 1, true);

SELECT CASE
  WHEN location='ROW A' AND location_id='11111111-aaaa-aaaa-aaaa-000000000001' THEN 'PASS'
  ELSE 'FAIL'
END AS result
FROM public.inventory WHERE sku='SYNC-TEST-1';

DELETE FROM public.inventory WHERE sku='SYNC-TEST-1';


\echo
\echo === TEST 4: INSERT with both DISAGREEING → raises exception ===
DO $$
DECLARE v_msg text;
BEGIN
  BEGIN
    INSERT INTO public.inventory (sku, warehouse, location, location_id, quantity, is_active)
    VALUES ('SYNC-TEST-1', 'TEST_WH', 'ROW A', '11111111-aaaa-aaaa-aaaa-000000000002', 1, true);
    RAISE NOTICE 'FAIL: expected exception, got success';
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
    IF v_msg LIKE '%inventory_location_drift%' THEN
      RAISE NOTICE 'PASS (got: %)', v_msg;
    ELSE
      RAISE NOTICE 'FAIL: unexpected exception: %', v_msg;
    END IF;
  END;
END $$;


-- ─────────────────────────────────────────────────────────────────
-- UPDATE cases — set up a clean row first
-- ─────────────────────────────────────────────────────────────────
INSERT INTO public.inventory (sku, warehouse, location, location_id, quantity, is_active)
VALUES ('SYNC-TEST-1', 'TEST_WH', 'ROW A', '11111111-aaaa-aaaa-aaaa-000000000001', 1, true);


\echo
\echo === TEST 5: UPDATE text only → FK auto-resolved ===
UPDATE public.inventory SET location = 'ROW B' WHERE sku='SYNC-TEST-1';

SELECT CASE
  WHEN location = 'ROW B' AND location_id = '11111111-aaaa-aaaa-aaaa-000000000002' THEN 'PASS'
  ELSE 'FAIL: location=' || location || ' location_id=' || location_id::text
END AS result
FROM public.inventory WHERE sku='SYNC-TEST-1';


\echo
\echo === TEST 6: UPDATE FK only → text auto-set ===
UPDATE public.inventory SET location_id = '11111111-aaaa-aaaa-aaaa-000000000001' WHERE sku='SYNC-TEST-1';

SELECT CASE
  WHEN location = 'ROW A' AND location_id = '11111111-aaaa-aaaa-aaaa-000000000001' THEN 'PASS'
  ELSE 'FAIL: location=' || location || ' location_id=' || location_id::text
END AS result
FROM public.inventory WHERE sku='SYNC-TEST-1';


\echo
\echo === TEST 7: UPDATE both agreeing → no exception ===
UPDATE public.inventory
SET location='ROW B', location_id='11111111-aaaa-aaaa-aaaa-000000000002'
WHERE sku='SYNC-TEST-1';

SELECT CASE
  WHEN location='ROW B' AND location_id='11111111-aaaa-aaaa-aaaa-000000000002' THEN 'PASS'
  ELSE 'FAIL'
END AS result
FROM public.inventory WHERE sku='SYNC-TEST-1';


\echo
\echo === TEST 8: UPDATE both with genuinely conflicting new values → exception ===
-- State after test 7: (ROW B, ROW_B_id). Try (ROW C, ROW_A_id) — both
-- columns get new values and disagree.
DO $$
DECLARE v_msg text;
BEGIN
  BEGIN
    UPDATE public.inventory
    SET location='ROW C', location_id='11111111-aaaa-aaaa-aaaa-000000000001'
    WHERE sku='SYNC-TEST-1';
    RAISE NOTICE 'FAIL: expected exception, got success';
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
    IF v_msg LIKE '%inventory_location_drift%' THEN
      RAISE NOTICE 'PASS (got: %)', v_msg;
    ELSE
      RAISE NOTICE 'FAIL: unexpected exception: %', v_msg;
    END IF;
  END;
END $$;


\echo
\echo === TEST 9: UPDATE neither location/FK → no change to those fields ===
-- Re-establish a known state after the exception above (no state change).
-- Expected current: (ROW B, ROW_B_id) from test 7.
UPDATE public.inventory SET quantity = quantity + 1 WHERE sku='SYNC-TEST-1';
SELECT CASE
  WHEN location='ROW B' AND location_id='11111111-aaaa-aaaa-aaaa-000000000002' THEN 'PASS'
  ELSE 'FAIL: location=' || location || ' location_id=' || location_id::text
END AS result
FROM public.inventory WHERE sku='SYNC-TEST-1';


\echo
\echo === TEST 10: UPDATE text to NULL → FK also nulled ===
UPDATE public.inventory SET location = NULL WHERE sku='SYNC-TEST-1';
SELECT CASE
  WHEN location IS NULL AND location_id IS NULL THEN 'PASS'
  ELSE 'FAIL: location=' || COALESCE(location, 'NULL') || ' location_id=' || COALESCE(location_id::text, 'NULL')
END AS result
FROM public.inventory WHERE sku='SYNC-TEST-1';


-- ─────────────────────────────────────────────────────────────────
-- Reproduce the original incident shape: simulate the broken script
-- ─────────────────────────────────────────────────────────────────
\echo
\echo === TEST 11: legacy broken-script pattern is now self-healing ===
-- Set up a row in 'ROW A'
UPDATE public.inventory
SET location='ROW A', location_id='11111111-aaaa-aaaa-aaaa-000000000001'
WHERE sku='SYNC-TEST-1';

-- The broken script would have done this (only updates text, forgets FK):
UPDATE public.inventory SET location='ROW B' WHERE sku='SYNC-TEST-1';

SELECT CASE
  WHEN location='ROW B' AND location_id='11111111-aaaa-aaaa-aaaa-000000000002' THEN 'PASS — trigger auto-healed'
  ELSE 'FAIL'
END AS result
FROM public.inventory WHERE sku='SYNC-TEST-1';


\echo
\echo === TEST 12: monitoring view is empty after sync ===
SELECT CASE
  WHEN count(*) = 0 THEN 'PASS'
  ELSE 'FAIL: ' || count(*)::text || ' drifted rows still present'
END AS result
FROM public.v_inventory_location_drift
WHERE sku LIKE 'SYNC-TEST-%';


\echo
\echo === TEST 13: monitoring view picks up manually-injected drift ===
-- Sneak past the trigger by disabling it (admin only), inject a drift, re-enable
ALTER TABLE public.inventory DISABLE TRIGGER trg_zz_inventory_sync_location;
UPDATE public.inventory SET location='ROW A' WHERE sku='SYNC-TEST-1';
-- Now: text=ROW A, but FK still points at ROW B → drift
ALTER TABLE public.inventory ENABLE TRIGGER trg_zz_inventory_sync_location;

SELECT CASE
  WHEN count(*) >= 1 THEN 'PASS'
  ELSE 'FAIL'
END AS result
FROM public.v_inventory_location_drift WHERE sku='SYNC-TEST-1';


\echo
\echo === All tests done. Look for FAIL above. ===
ROLLBACK;
