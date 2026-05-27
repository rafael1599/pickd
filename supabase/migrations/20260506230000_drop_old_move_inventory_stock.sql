-- Same root cause as 20260506220000 (upsert_inventory_log) but for
-- move_inventory_stock. Migration 20260506190000 added p_move_note via
-- CREATE OR REPLACE; because the new param has a default, Postgres created
-- a 12-arg overload alongside the original 11-arg one. PostgREST then
-- reports 'Could not choose the best candidate function' on every move.
--
-- Drop the legacy 11-arg signature. The 12-arg one stays and accepts the
-- old 11-arg shape via the p_move_note default.

DROP FUNCTION IF EXISTS public.move_inventory_stock(
  text, text, text, text, text, integer, text, uuid, text, text, text[]
);
