-- Separate "a place a bike can be" from "warehouse storage space".
--
-- The Inventory screen shows available space as `total_capacity - total_units`,
-- and every location that is not a ROW was created with the UI default of 550 —
-- a number sized for a row of bikes, applied to a FedEx station, a shipping
-- lane, a container being unloaded. The result: of the 10,242 units the bikes
-- view reported as free, about 4,240 (41%) sat in places nothing can be stored
-- in. The five shipping locations alone claimed 2,161 free units while holding
-- 39 bikes between them.
--
-- The old fix was a name match — `AND l.location NOT ILIKE 'CAGE%'` inside
-- get_inventory_stats. That is the same problem one location at a time, and it
-- does not survive someone naming the next staging area differently. This makes
-- it a property of the location.
--
-- Deleting these was the alternative and it is the wrong one. Four foreign keys
-- point at `locations` (inventory, inventory_logs ×2, daily_inventory_snapshots)
-- and all of them are ON DELETE NO ACTION, so Postgres refuses to drop a
-- location any movement ever touched. It should: the container names ARE the
-- staging record — 4256N was written yesterday, BAY 2 today, and ROW 2.5 two
-- days ago. Of every candidate, exactly one (ROW 30.5) has no history at all,
-- and dropping it would change no number, because an empty location already
-- contributes nothing (see the EXISTS in the function below).

-- Why not reuse `is_shipping_area`, which already exists and reads close to
-- this? Because it answers a different question — "should put-away suggest this
-- place" — and it is consumed by suggest_locations_for_sku and the consolidation
-- promotion. Its scope is also narrower: a cage is not a shipping area, and
-- neither is a phantom ROW 2.5. Widening it to mean both would silently change
-- where the app suggests putting stock, which is not what this fix is about.
--
-- Worth knowing: `is_shipping_area` is false on all 330 rows — nobody ever
-- populated it — so the exclusions built on it currently exclude nothing, and
-- put-away can suggest FDX STATION today. That is a separate bug; filling it in
-- changes suggestion behaviour and deserves its own decision.
ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS counts_as_storage boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.locations.counts_as_storage IS
  'Si esta ubicacion es espacio de almacenamiento real. FALSE = existe para dar seguimiento (shipping, staging, containers, jaulas, pruebas) pero su max_capacity NO cuenta como espacio disponible. Nada se borra: el historial de movimientos se conserva igual.';

-- ── Shipping / outbound: bikes here are on their way out, not stored ──
UPDATE public.locations SET counts_as_storage = false
WHERE warehouse = 'LUDLOW'
  AND (location IN ('SD') OR location LIKE 'FDX%');

-- ── Containers: the temporary name staging gets so a load stays traceable ──
UPDATE public.locations SET counts_as_storage = false
WHERE warehouse = 'LUDLOW' AND location ~ '^[0-9]{4}N$';

-- ── Staging / holding areas ──
UPDATE public.locations SET counts_as_storage = false
WHERE warehouse = 'LUDLOW'
  AND location IN ('INCOMING', 'BAY 2', 'BAY 3', 'BAY3', 'UNASSIGNED', '22F', 'FLORIDA');

-- ── Phantom half-rows: never real shelves, and a single bike landing in one
--    used to add its whole default 550 to available space in one jump. ──
UPDATE public.locations SET counts_as_storage = false
WHERE warehouse = 'LUDLOW' AND location ~ '^ROW [0-9]+\.5$';

-- ── Cages: already excluded by the hardcoded name match this replaces ──
UPDATE public.locations SET counts_as_storage = false
WHERE warehouse = 'LUDLOW' AND location ILIKE 'CAGE%';

-- ── Test rows, in either warehouse ──
UPDATE public.locations SET counts_as_storage = false
WHERE location ILIKE 'TEST-%';

-- Left counting on purpose, and worth a second opinion from the floor:
--   PALLETIZED, 42 BURIED — awkward to reach, but bikes genuinely live there
--     long term, and picking already routes around them via picking_order 9000+.
--     Flipping them off lowers available space by a further ~1,020.
--   ROW 19B, ROW 20B, POP1, POP 14, BL BOX, E47 — could not classify these
--     without knowing the floor. They keep counting until someone says otherwise.
-- Changing any of them is one UPDATE; that is the point of the column.

-- Same function, same signature and grants. Two changes: the capacity sum is
-- filtered on the new flag instead of a location-name pattern, and it now also
-- respects the flag for the parts view, which the CAGE match never did.
CREATE OR REPLACE FUNCTION public.get_inventory_stats(p_include_parts boolean DEFAULT false)
RETURNS TABLE(total_skus bigint, total_units bigint, total_capacity bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    COUNT(DISTINCT inventory.sku),
    COALESCE(SUM(quantity), 0),
    -- Capacity counts a location only while it actually holds something of the
    -- kind being asked about. That makes "available" mean headroom in the rows
    -- already in use, not space in the building — an empty ROW contributes
    -- nothing. Deliberately left as it was: changing it changes what the number
    -- means, which is a call for the warehouse, not a side effect of this fix.
    (SELECT COALESCE(SUM(l.max_capacity), 0)
     FROM locations l
     WHERE l.warehouse = 'LUDLOW' AND l.is_active = true
       AND l.counts_as_storage = true
       AND EXISTS (
         SELECT 1 FROM inventory inv
         JOIN sku_metadata sm2 ON inv.sku = sm2.sku
         WHERE inv.location = l.location AND inv.warehouse = l.warehouse
           AND inv.is_active = true AND inv.quantity > 0
           AND sm2.is_bike = (NOT p_include_parts)
       )
    )
  FROM inventory
  JOIN sku_metadata ON sku_metadata.sku = inventory.sku
  WHERE inventory.is_active = true
    AND inventory.quantity > 0
    AND inventory.warehouse = 'LUDLOW'
    AND sku_metadata.is_bike = (NOT p_include_parts);
$function$;
