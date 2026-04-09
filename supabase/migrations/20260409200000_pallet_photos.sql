-- Add pallet_photos column to picking_lists for scan verification evidence
ALTER TABLE picking_lists ADD COLUMN IF NOT EXISTS pallet_photos jsonb DEFAULT '[]';
