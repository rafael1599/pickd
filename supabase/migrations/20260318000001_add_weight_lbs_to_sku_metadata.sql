-- Add weight_lbs column to sku_metadata (per-SKU weight in pounds)
ALTER TABLE sku_metadata ADD COLUMN IF NOT EXISTS weight_lbs numeric DEFAULT NULL;

COMMENT ON COLUMN "public"."sku_metadata"."weight_lbs" IS 'Product weight per unit in pounds (lbs). Shared across all inventory entries of the same SKU.';
