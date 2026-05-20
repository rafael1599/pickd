-- Guards added to move_inventory_stock — refuse no-op moves.
-- Wraps in BEGIN/ROLLBACK so no fixture data persists.

\set ON_ERROR_STOP on
\set VERBOSITY terse
BEGIN;

-- Fixture
INSERT INTO public.sku_metadata (sku, is_bike) VALUES ('MV-EDGE', true)
ON CONFLICT (sku) DO NOTHING;

INSERT INTO public.locations (id, warehouse, location, max_capacity, is_active) VALUES
  ('dddd0001-0000-0000-0000-000000000001', 'TEST_WH', 'ME ROW A', 100, true),
  ('dddd0001-0000-0000-0000-000000000002', 'TEST_WH', 'ME ROW B', 100, true);

INSERT INTO auth.users (id, email, instance_id, aud, role)
VALUES ('dddd0001-1111-1111-1111-000000000099',
        'me-test@example.com',
        '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.profiles (id, full_name) VALUES
  ('dddd0001-1111-1111-1111-000000000099', 'ME Test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.inventory (sku, warehouse, location, quantity, is_active)
VALUES ('MV-EDGE', 'TEST_WH', 'ME ROW A', 10, true);

\echo
\echo === TEST 1: qty=0 raises ===
DO $$
DECLARE v_msg text;
BEGIN
  BEGIN
    PERFORM public.move_inventory_stock(
      'MV-EDGE', 'TEST_WH', 'ME ROW A', 'TEST_WH', 'ME ROW B', 0, 'test',
      'dddd0001-1111-1111-1111-000000000099'::uuid
    );
    RAISE NOTICE 'FAIL: expected exception, got success';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%qty must be > 0%' THEN RAISE NOTICE 'PASS';
    ELSE RAISE NOTICE 'FAIL: %', SQLERRM; END IF;
  END;
END $$;

\echo
\echo === TEST 2: qty<0 raises ===
DO $$
DECLARE v_msg text;
BEGIN
  BEGIN
    PERFORM public.move_inventory_stock(
      'MV-EDGE', 'TEST_WH', 'ME ROW A', 'TEST_WH', 'ME ROW B', -1, 'test',
      'dddd0001-1111-1111-1111-000000000099'::uuid
    );
    RAISE NOTICE 'FAIL: expected exception, got success';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%qty must be > 0%' THEN RAISE NOTICE 'PASS';
    ELSE RAISE NOTICE 'FAIL: %', SQLERRM; END IF;
  END;
END $$;

\echo
\echo === TEST 3: same warehouse + same location raises (the bug Rafael reported) ===
DO $$
DECLARE v_msg text;
BEGIN
  BEGIN
    PERFORM public.move_inventory_stock(
      'MV-EDGE', 'TEST_WH', 'ME ROW A', 'TEST_WH', 'ME ROW A', 5, 'test',
      'dddd0001-1111-1111-1111-000000000099'::uuid
    );
    RAISE NOTICE 'FAIL: expected exception, got success';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%source and target are the same%' THEN RAISE NOTICE 'PASS';
    ELSE RAISE NOTICE 'FAIL: %', SQLERRM; END IF;
  END;
END $$;

\echo
\echo === TEST 4: case/whitespace difference still counts as 'same' (normalized) ===
DO $$
DECLARE v_msg text;
BEGIN
  BEGIN
    PERFORM public.move_inventory_stock(
      'MV-EDGE', 'TEST_WH', 'me row a', 'TEST_WH', '  ME ROW A  ', 5, 'test',
      'dddd0001-1111-1111-1111-000000000099'::uuid
    );
    RAISE NOTICE 'FAIL: expected exception, got success';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%source and target are the same%' THEN RAISE NOTICE 'PASS';
    ELSE RAISE NOTICE 'FAIL: %', SQLERRM; END IF;
  END;
END $$;

\echo
\echo === TEST 5: valid move still works (regression baseline) ===
SELECT CASE
  WHEN (public.move_inventory_stock(
          'MV-EDGE', 'TEST_WH', 'ME ROW A', 'TEST_WH', 'ME ROW B', 3, 'test',
          'dddd0001-1111-1111-1111-000000000099'::uuid
        )->>'success')::boolean = true
  THEN 'PASS' ELSE 'FAIL' END AS result;

\echo
\echo === TEST 6: valid move actually relocated the units ===
SELECT CASE
  WHEN (SELECT quantity FROM public.inventory
          WHERE sku='MV-EDGE' AND warehouse='TEST_WH' AND location='ME ROW A') = 7
   AND (SELECT quantity FROM public.inventory
          WHERE sku='MV-EDGE' AND warehouse='TEST_WH' AND location='ME ROW B') = 3
  THEN 'PASS' ELSE 'FAIL' END AS result;

\echo
\echo === All tests done. Look for FAIL above. ===
ROLLBACK;
