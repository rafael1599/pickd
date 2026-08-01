-- LUDLOW: '42 BURIED' → 'ROW 42 BURIED', 'PALLETIZED' → 'ROW X EP'.
--
-- Both are rows of bikes; the names just never said so, which is why they kept
-- being read as exception areas. `location` is denormalised text across five
-- tables, so a rename is a data migration, not a label change.
--
-- Scoped to LUDLOW deliberately. ATS has its own PALLETIZED — a different place,
-- with its own ranking (999, unranked) and 13 live inventory rows plus 64
-- snapshots. Renaming by name alone would have swept it up.
--
-- History is rewritten along with the live rows. It is the same physical place
-- under a new label, and leaving inventory_logs and daily_inventory_snapshots
-- pointing at a name absent from `locations` would break the ghost trail and the
-- movement history the operators read. Verified before writing: no picking_list
-- in a non-terminal status references either name, so no order in flight has a
-- frozen location that this invalidates.
--
-- Knock-on effects of the new names, all checked and all wanted:
--   · `inventory.sublocation` is CHECK-constrained to `location ILIKE 'ROW%'`,
--     so these two can now carry an A–F position. They could not before.
--   · move_stock / adjust RPCs auto-assign a sublocation on the way into a
--     `ROW%` location, so moves into them start recording position.
--   · get_audit_rows_v2 and the warehouse map both filter on `ROW%`; the two
--     locations now appear in the audit and on the map.
--   · suggest_locations_for_sku also filters on `ROW%` — these become eligible
--     put-away suggestions. Their picking_order (9999 / 9995) still ranks them
--     last, but if a buried row starts being suggested for put-away, that filter
--     is where to look.

UPDATE public.locations SET location = 'ROW 42 BURIED'
WHERE warehouse = 'LUDLOW' AND location = '42 BURIED';

UPDATE public.locations SET location = 'ROW X EP'
WHERE warehouse = 'LUDLOW' AND location = 'PALLETIZED';

UPDATE public.inventory SET location = 'ROW 42 BURIED'
WHERE warehouse = 'LUDLOW' AND location = '42 BURIED';

UPDATE public.inventory SET location = 'ROW X EP'
WHERE warehouse = 'LUDLOW' AND location = 'PALLETIZED';

UPDATE public.inventory_logs SET from_location = 'ROW 42 BURIED'
WHERE from_warehouse = 'LUDLOW' AND from_location = '42 BURIED';

UPDATE public.inventory_logs SET from_location = 'ROW X EP'
WHERE from_warehouse = 'LUDLOW' AND from_location = 'PALLETIZED';

UPDATE public.inventory_logs SET to_location = 'ROW 42 BURIED'
WHERE to_warehouse = 'LUDLOW' AND to_location = '42 BURIED';

UPDATE public.inventory_logs SET to_location = 'ROW X EP'
WHERE to_warehouse = 'LUDLOW' AND to_location = 'PALLETIZED';

UPDATE public.daily_inventory_snapshots SET location = 'ROW 42 BURIED'
WHERE warehouse = 'LUDLOW' AND location = '42 BURIED';

UPDATE public.daily_inventory_snapshots SET location = 'ROW X EP'
WHERE warehouse = 'LUDLOW' AND location = 'PALLETIZED';

UPDATE public.asset_tags SET location = 'ROW 42 BURIED'
WHERE warehouse = 'LUDLOW' AND location = '42 BURIED';

UPDATE public.asset_tags SET location = 'ROW X EP'
WHERE warehouse = 'LUDLOW' AND location = 'PALLETIZED';

-- The last-resort ranking set in 20260731150000 keyed on the old names. Re-assert
-- it here so a database migrated in one pass ends up ranked, and so this file is
-- the single place the two locations are described.
UPDATE public.locations SET picking_order = 9999
WHERE warehouse = 'LUDLOW' AND location = 'ROW 42 BURIED'
  AND picking_order IS DISTINCT FROM 9999;

UPDATE public.locations SET picking_order = 9995
WHERE warehouse = 'LUDLOW' AND location = 'ROW X EP'
  AND picking_order IS DISTINCT FROM 9995;
