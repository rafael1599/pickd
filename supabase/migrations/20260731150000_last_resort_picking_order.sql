-- Locations deliberately ranked out of the picking route.
--
-- Picking treats `locations.picking_order >= 9000` as "reachable, but not where
-- you send a picker while a normal shelf still has the SKU" (see
-- src/utils/pickingOrder.ts). The real walking order tops out at 999, so the
-- band is well clear of it.
--
-- Until now the two rows carrying those numbers existed only as data typed
-- straight into production: nothing in the repo said the convention existed, and
-- a fresh local stack routed picks differently from prod for the SKUs that live
-- on them. This states it once, idempotently.
--
-- Keyed on warehouse AND location on purpose. The name is not unique: LUDLOW
-- and ATS both have a PALLETIZED, and only LUDLOW's is ranked out of the way —
-- ATS sits at the plain 999 "unranked" default and must stay there, because
-- demoting it would silently reroute every ATS pick that lands on it.
--
-- 42 BURIED was set deliberately: it held 39 units against a normal row's 17,
-- won on quantity alone, and pickers re-routed it by hand four times in eight
-- days. LUDLOW's PALLETIZED already carried 9995 before the convention existed
-- and is swept up by it — which is the intent, but it was never reviewed as
-- such. If it should be back on the normal route, lowering the number is the fix.

UPDATE public.locations
SET picking_order = 9999
WHERE warehouse = 'LUDLOW'
  AND upper(trim(location)) = '42 BURIED'
  AND picking_order IS DISTINCT FROM 9999;

UPDATE public.locations
SET picking_order = 9995
WHERE warehouse = 'LUDLOW'
  AND upper(trim(location)) = 'PALLETIZED'
  AND picking_order IS DISTINCT FROM 9995;

COMMENT ON COLUMN public.locations.picking_order IS
  'Orden de picking sugerido (menor = primero). >= 9000 marca una ubicacion de ultimo recurso: el picker solo va ahi cuando ningun estante normal tiene el SKU. NULL = sin ranking, tratado como normal. El ranking es por (warehouse, location) — el nombre solo no es unico.';
