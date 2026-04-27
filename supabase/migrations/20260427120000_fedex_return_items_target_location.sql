-- FedEx Return Items: persist target destination per item
-- ─────────────────────────────────────────────────────────────────────────────
-- Until now, the destination location for a returning SKU was held in
-- component state on FedExReturnDetailScreen and only sent to the DB at
-- "Resolve" time via move_inventory_stock. Closing the screen lost the
-- entries, and users could not see where each row was going to land.
--
-- This migration adds two additive nullable columns to fedex_return_items:
--   target_location   — destination (e.g. ROW 15) chosen at intake/processing
--   target_warehouse  — defaults to LUDLOW; future-proofs ATS workflow
--
-- They are filled in by AddItemSheet at insert time (or via a follow-up
-- update) and consumed by useResolveReturn so the parent state map can be
-- removed. Items already moved keep using moved_to_location/_warehouse as
-- the historical source of truth.

ALTER TABLE public.fedex_return_items
  ADD COLUMN IF NOT EXISTS target_location text,
  ADD COLUMN IF NOT EXISTS target_warehouse text;
