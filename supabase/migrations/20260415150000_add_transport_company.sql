-- Add transport_company column to picking_lists
-- Phase 1: stores the carrier name for label color-coding (Phase 2)
ALTER TABLE picking_lists
ADD COLUMN transport_company text DEFAULT NULL;

COMMENT ON COLUMN picking_lists.transport_company IS 'Transport carrier name (R+L, 2-DAY, RIST, etc). Used for label color-coding.';
