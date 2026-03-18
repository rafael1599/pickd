-- Seed initial weight: 45 lbs for all SKUs containing a dash
UPDATE sku_metadata SET weight_lbs = 45 WHERE sku LIKE '%-%' AND weight_lbs IS NULL;

-- Set default for future rows so new SKUs get 45 lbs automatically
ALTER TABLE sku_metadata ALTER COLUMN weight_lbs SET DEFAULT 45;
