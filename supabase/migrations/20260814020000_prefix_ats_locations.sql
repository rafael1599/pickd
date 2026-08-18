-- ATS has been operationally dead since 2026-04-15: 0 active inventory rows,
-- 28 inactive/zeroed ones (all touched in a single bulk deactivation, none
-- since). 15 of its 132 `locations` rows still share a bare name with a live
-- LUDLOW location (E1-E7, D1-D6, H3, H6, ROW 1) — each with its own capacity
-- and picking_order under the OTHER warehouse. Any lookup that keys off
-- `location` name alone (instead of the `(warehouse, location)` pair this
-- app requires) would silently pick up the wrong one.
--
-- Fix: prefix every ATS location with 'ATS-' so no bare name can ever
-- collide with LUDLOW again, without touching the `warehouse` column or its
-- dependents (11 tables, 33 RPC params) — that dimension stays as-is.
--
-- `location` is denormalised text across five tables (per CLAUDE.md): rename
-- history along with the live rows, same as 20260731180000. All scoped to
-- warehouse = 'ATS' so LUDLOW rows are never touched even where names match.
--
-- `locations` first: an AFTER UPDATE trigger (sync_inventory_location_name)
-- cascades the new name into any `inventory` row still linked via
-- location_id. The explicit inventory UPDATE below is the safety net for
-- rows where that FK isn't set — the `NOT LIKE 'ATS-%'` guard makes both
-- idempotent and skips rows the trigger already renamed.

UPDATE public.locations
SET location = 'ATS-' || location
WHERE warehouse = 'ATS' AND location NOT LIKE 'ATS-%';

UPDATE public.inventory
SET location = 'ATS-' || location
WHERE warehouse = 'ATS' AND location NOT LIKE 'ATS-%';

UPDATE public.inventory_logs
SET from_location = 'ATS-' || from_location
WHERE from_warehouse = 'ATS' AND from_location NOT LIKE 'ATS-%';

UPDATE public.inventory_logs
SET to_location = 'ATS-' || to_location
WHERE to_warehouse = 'ATS' AND to_location NOT LIKE 'ATS-%';

UPDATE public.daily_inventory_snapshots
SET location = 'ATS-' || location
WHERE warehouse = 'ATS' AND location NOT LIKE 'ATS-%';

UPDATE public.asset_tags
SET location = 'ATS-' || location
WHERE warehouse = 'ATS' AND location NOT LIKE 'ATS-%';
