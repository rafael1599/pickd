-- Backfill distribution for existing inventory items
--
-- Two operations:
--   1. Items with no distribution → auto-generate via existing trigger
--      (bike SKUs get TOWER×30/LINE×5, non-bike get single TOWER)
--   2. Items with TOWER entries where units_each < 16 → convert to LINE
--      (these are leftovers from the old default that put everything in one TOWER)
--
-- Safety:
--   - Only touches the `distribution` JSONB column — no quantity/SKU/location changes
--   - Does NOT log to inventory_logs (bulk correction, not a user action)
--   - Fully reversible (can re-run or revert type back to TOWER)
--   - Trigger won't interfere: it only fires when distribution IS NULL/empty

BEGIN;

-- ================================================================
-- Operation 1: Items without distribution
-- Trick: UPDATE quantity = quantity fires the BEFORE UPDATE trigger,
-- which sees distribution IS NULL → auto-generates it
-- ================================================================
UPDATE public.inventory
SET quantity = quantity
WHERE (distribution IS NULL OR distribution = '[]'::jsonb)
  AND quantity > 0
  AND is_active = true;

-- ================================================================
-- Operation 2: Convert small towers (units_each < 16) to lines
-- These are remnants of the old default: [{type: TOWER, count: 1, units_each: <qty>}]
-- where qty was small. A "tower" of 8 units makes no physical sense — it's a line.
-- ================================================================
WITH items_to_fix AS (
  SELECT id
  FROM public.inventory
  WHERE is_active = true
    AND quantity > 0
    AND distribution IS NOT NULL
    AND distribution != '[]'::jsonb
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(distribution) elem
      WHERE elem->>'type' = 'TOWER'
        AND (elem->>'units_each')::int < 16
    )
),
new_distributions AS (
  SELECT
    inv.id,
    jsonb_agg(
      CASE
        WHEN (elem->>'type') = 'TOWER' AND (elem->>'units_each')::int < 16
        THEN jsonb_set(elem, '{type}', '"LINE"')
        ELSE elem
      END
      ORDER BY ordinality
    ) AS new_dist
  FROM public.inventory inv
  CROSS JOIN LATERAL jsonb_array_elements(inv.distribution)
    WITH ORDINALITY AS t(elem, ordinality)
  WHERE inv.id IN (SELECT id FROM items_to_fix)
  GROUP BY inv.id
)
UPDATE public.inventory inv
SET distribution = nd.new_dist
FROM new_distributions nd
WHERE inv.id = nd.id;

COMMIT;
