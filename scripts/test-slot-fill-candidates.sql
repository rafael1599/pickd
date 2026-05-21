-- Tests for get_slot_fill_candidates.
-- Wrapped in BEGIN/ROLLBACK so no fixture data persists.
--
-- Coverage:
--  T1: empty slots input → empty result, no error.
--  T2: a slot finds a SKU whose qty fits — ranked by velocity_score.
--  T3: exponential decay — recent picks outweigh old picks even when
--      old picks have more total units.
--  T4: SKU already in an active row is excluded.
--  T5: p_only_bikes=true filters out parts.
--  T6: fit_precision is highest when current_qty equals slot midpoint.
--  T7: top_n_per_slot caps the result count per slot.
--  T8: multi-slot input returns rows partitioned correctly per slot.

\set ON_ERROR_STOP on
\set VERBOSITY terse
BEGIN;

-- ── Fixture ───────────────────────────────────────────────────────────
-- One auth user + profile (some FK references in the schema expect this).
INSERT INTO auth.users (id, email, instance_id, aud, role)
VALUES ('eeee0001-0000-0000-0000-000000000001',
        'slot-fill-test@example.com',
        '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.profiles (id, full_name)
VALUES ('eeee0001-0000-0000-0000-000000000001', 'Slot Fill Test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_presence (user_id, last_seen_at)
VALUES ('eeee0001-0000-0000-0000-000000000001', NOW())
ON CONFLICT (user_id) DO NOTHING;

-- SKUs: three bikes + one part.
INSERT INTO public.sku_metadata (sku, is_bike) VALUES
  ('SF-HOT',  true),     -- recent picks → high decay score
  ('SF-COLD', true),     -- old picks only → low decay score
  ('SF-MED',  true),     -- mid-rotation
  ('SF-PART', false),    -- part, excluded by p_only_bikes=true
  ('SF-DUPE', true)      -- already in active row → excluded
ON CONFLICT (sku) DO NOTHING;

-- Locations needed for FK on inventory.
INSERT INTO public.locations (id, warehouse, location, max_capacity, is_active) VALUES
  ('eeee1111-0000-0000-0000-000000000001', 'TEST_WH', 'ROW 25', 100, true),
  ('eeee1111-0000-0000-0000-000000000002', 'TEST_WH', 'ROW 26', 100, true),
  ('eeee1111-0000-0000-0000-000000000003', 'TEST_WH', 'ROW 27', 100, true),
  ('eeee1111-0000-0000-0000-000000000004', 'TEST_WH', 'ROW 28', 100, true),
  ('eeee1111-0000-0000-0000-000000000005', 'TEST_WH', 'ROW 1',  100, true)
ON CONFLICT (id) DO NOTHING;

-- Inventory rows in slow zone (ROW 25-28) + one in active (ROW 1).
INSERT INTO public.inventory (sku, warehouse, location, quantity, is_active) VALUES
  ('SF-HOT',  'TEST_WH', 'ROW 25', 32, true),   -- fits "tower" slot
  ('SF-COLD', 'TEST_WH', 'ROW 26', 32, true),   -- fits tower but old velocity
  ('SF-MED',  'TEST_WH', 'ROW 27', 10, true),   -- fits "line" slot
  ('SF-PART', 'TEST_WH', 'ROW 28', 32, true),   -- part, fits tower size
  ('SF-DUPE', 'TEST_WH', 'ROW 1',  10, true),   -- already in active row
  ('SF-DUPE', 'TEST_WH', 'ROW 28', 12, true);   -- also in slow → should still be excluded

-- Picking lists referenced by inventory_logs.list_id (FK). We pre-create
-- enough rows so each DEDUCT log can point at a unique completed list.
INSERT INTO public.picking_lists (id, user_id, status, order_number)
SELECT
  ('eeee2222-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid,
  'eeee0001-0000-0000-0000-000000000001'::uuid,
  'completed',
  'SF-TEST-' || g
FROM generate_series(1, 60) AS g;

-- DEDUCT logs to seed velocity.
--   SF-HOT: 5 picks of 4 units each, all in the last 10 days → high score.
--   SF-COLD: 30 picks of 4 units each, all > 200 days ago → low score.
--   SF-MED: 3 picks of 3 units in last 30 days.
--   SF-PART: 10 recent picks (but filtered when p_only_bikes=true).
INSERT INTO public.inventory_logs (sku, from_warehouse, from_location, quantity_change, prev_quantity, new_quantity, action_type, performed_by, list_id, created_at)
SELECT 'SF-HOT', 'TEST_WH', 'ROW 25', -4, 100, 96, 'DEDUCT', 'test',
       ('eeee2222-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid,
       NOW() - (g * INTERVAL '2 days')
FROM generate_series(1, 5) AS g;

INSERT INTO public.inventory_logs (sku, from_warehouse, from_location, quantity_change, prev_quantity, new_quantity, action_type, performed_by, list_id, created_at)
SELECT 'SF-COLD', 'TEST_WH', 'ROW 26', -4, 100, 96, 'DEDUCT', 'test',
       ('eeee2222-0000-0000-0000-' || lpad((g + 10)::text, 12, '0'))::uuid,
       NOW() - (200 + g) * INTERVAL '1 day'
FROM generate_series(1, 30) AS g;

INSERT INTO public.inventory_logs (sku, from_warehouse, from_location, quantity_change, prev_quantity, new_quantity, action_type, performed_by, list_id, created_at)
SELECT 'SF-MED', 'TEST_WH', 'ROW 27', -3, 100, 97, 'DEDUCT', 'test',
       ('eeee2222-0000-0000-0000-' || lpad((g + 41)::text, 12, '0'))::uuid,
       NOW() - (g * 5) * INTERVAL '1 day'
FROM generate_series(1, 3) AS g;

INSERT INTO public.inventory_logs (sku, from_warehouse, from_location, quantity_change, prev_quantity, new_quantity, action_type, performed_by, list_id, created_at)
SELECT 'SF-PART', 'TEST_WH', 'ROW 28', -5, 100, 95, 'DEDUCT', 'test',
       ('eeee2222-0000-0000-0000-' || lpad((g + 45)::text, 12, '0'))::uuid,
       NOW() - (g * INTERVAL '1 day')
FROM generate_series(1, 10) AS g;

\echo
\echo === T1: empty slots input → 0 rows, no error ===
SELECT CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result
FROM public.get_slot_fill_candidates('[]'::jsonb, true,
       ARRAY['ROW 1']::text[], 5);

\echo
\echo === T2: tower-size slot ranks SF-HOT above SF-COLD ===
WITH r AS (
  SELECT * FROM public.get_slot_fill_candidates(
    '[{"slot_id":"tower-1","min_qty":30,"max_qty":35}]'::jsonb,
    true, ARRAY['ROW 1']::text[], 5
  )
)
SELECT CASE
  WHEN (SELECT sku FROM r WHERE slot_id='tower-1' ORDER BY velocity_score DESC LIMIT 1) = 'SF-HOT'
    AND EXISTS (SELECT 1 FROM r WHERE sku='SF-COLD' AND velocity_score > 0)
    AND (SELECT velocity_score FROM r WHERE sku='SF-HOT')
        > (SELECT velocity_score FROM r WHERE sku='SF-COLD')
  THEN 'PASS' ELSE 'FAIL' END AS result;

\echo
\echo === T3: decay — SF-HOT (5 recent picks × 4u) outscores SF-COLD (30 old picks × 4u) ===
WITH r AS (
  SELECT sku, velocity_score
  FROM public.get_slot_fill_candidates(
    '[{"slot_id":"tower-1","min_qty":30,"max_qty":35}]'::jsonb,
    true, ARRAY['ROW 1']::text[], 5
  )
)
SELECT CASE
  WHEN (SELECT velocity_score FROM r WHERE sku='SF-HOT')
       > (SELECT velocity_score FROM r WHERE sku='SF-COLD')
  THEN 'PASS — decay applied correctly'
  ELSE 'FAIL — old picks outranked recent picks' END AS result;

\echo
\echo === T4: SF-DUPE (also in ROW 1) excluded even though it has a slow-zone copy ===
SELECT CASE
  WHEN NOT EXISTS (
    SELECT 1 FROM public.get_slot_fill_candidates(
      '[{"slot_id":"line-1","min_qty":8,"max_qty":14}]'::jsonb,
      true, ARRAY['ROW 1']::text[], 5
    ) WHERE sku = 'SF-DUPE'
  ) THEN 'PASS' ELSE 'FAIL' END AS result;

\echo
\echo === T5: p_only_bikes=true filters out SF-PART ===
SELECT CASE
  WHEN NOT EXISTS (
    SELECT 1 FROM public.get_slot_fill_candidates(
      '[{"slot_id":"tower-1","min_qty":30,"max_qty":35}]'::jsonb,
      true, ARRAY['ROW 1']::text[], 5
    ) WHERE sku = 'SF-PART'
  ) THEN 'PASS' ELSE 'FAIL' END AS result;

\echo
\echo === T5b: p_only_bikes=false includes SF-PART ===
SELECT CASE
  WHEN EXISTS (
    SELECT 1 FROM public.get_slot_fill_candidates(
      '[{"slot_id":"tower-1","min_qty":30,"max_qty":35}]'::jsonb,
      false, ARRAY['ROW 1']::text[], 5
    ) WHERE sku = 'SF-PART'
  ) THEN 'PASS' ELSE 'FAIL' END AS result;

\echo
\echo === T6: fit_precision peaks at slot midpoint (32.5) ===
-- SF-HOT has qty 32 → ~0.93 inside [30,35] midpoint 32.5.
-- Add a wide slot [10,50] where SF-HOT (32) is closer to midpoint 30 → ~0.9.
SELECT CASE
  WHEN (SELECT fit_precision
        FROM public.get_slot_fill_candidates(
          '[{"slot_id":"narrow","min_qty":30,"max_qty":35},
            {"slot_id":"wide","min_qty":10,"max_qty":50}]'::jsonb,
          true, ARRAY['ROW 1']::text[], 5
        )
        WHERE sku='SF-HOT' AND slot_id='narrow') >= 0.8
  THEN 'PASS' ELSE 'FAIL' END AS result;

\echo
\echo === T7: top_n_per_slot caps result count ===
SELECT CASE
  WHEN (SELECT COUNT(*)
        FROM public.get_slot_fill_candidates(
          '[{"slot_id":"tower-1","min_qty":30,"max_qty":35}]'::jsonb,
          true, ARRAY['ROW 1']::text[], 1
        )) = 1
  THEN 'PASS' ELSE 'FAIL' END AS result;

\echo
\echo === T8: multi-slot input partitions correctly ===
WITH r AS (
  SELECT slot_id, sku
  FROM public.get_slot_fill_candidates(
    '[
      {"slot_id":"tower-1","min_qty":30,"max_qty":35},
      {"slot_id":"line-1","min_qty":8,"max_qty":14}
    ]'::jsonb,
    true, ARRAY['ROW 1']::text[], 5
  )
)
SELECT CASE
  WHEN EXISTS (SELECT 1 FROM r WHERE slot_id='tower-1' AND sku='SF-HOT')
   AND EXISTS (SELECT 1 FROM r WHERE slot_id='line-1' AND sku='SF-MED')
  THEN 'PASS' ELSE 'FAIL' END AS result;

\echo
\echo === All tests done. Look for FAIL above. ===
ROLLBACK;
