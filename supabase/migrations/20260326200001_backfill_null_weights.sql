-- Backfill SKUs that still have NULL weight with the default 45 lbs
UPDATE sku_metadata SET weight_lbs = 45 WHERE weight_lbs IS NULL;
