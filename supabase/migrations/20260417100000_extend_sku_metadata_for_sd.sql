-- Extend sku_metadata with all fields the Scratch & Dent / Demo workflow needs.
--
-- Design choice: instead of a parallel relational structure (products /
-- bike_variants / bike_units), we keep S/D inside sku_metadata because:
--   - Each S/D bike has a unique SKU (1 row per physical unit).
--   - asset_tags already covers per-unit QR tracking for the regular flow.
--   - pickd-2d reads sku_metadata with SELECT * and ignores extra columns.
--   - 100% additive: nothing existing breaks; staging/prod safe.
--
-- Status (available | sold | reserved | ...) is NOT stored here — it's
-- derived from inventory.quantity > 0 AND is_active = true at query time.
-- Sold history lives in inventory_logs (already populated by picking flow).

ALTER TABLE public.sku_metadata
  ADD COLUMN IF NOT EXISTS is_scratch_dent BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS model TEXT,
  ADD COLUMN IF NOT EXISTS size TEXT,
  ADD COLUMN IF NOT EXISTS color TEXT,
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS serial_number TEXT,
  ADD COLUMN IF NOT EXISTS condition TEXT,
  ADD COLUMN IF NOT EXISTS condition_description TEXT,
  ADD COLUMN IF NOT EXISTS sd_category TEXT,
  ADD COLUMN IF NOT EXISTS msrp NUMERIC,
  ADD COLUMN IF NOT EXISTS standard_price NUMERIC,
  ADD COLUMN IF NOT EXISTS sd_price NUMERIC,
  ADD COLUMN IF NOT EXISTS pdf_link TEXT;

ALTER TABLE public.sku_metadata
  DROP CONSTRAINT IF EXISTS sku_metadata_condition_check;
ALTER TABLE public.sku_metadata
  ADD CONSTRAINT sku_metadata_condition_check
    CHECK (condition IS NULL OR condition IN
      ('new_unbuilt','new_built','ridden_demo','returned','defective_frame'));

ALTER TABLE public.sku_metadata
  DROP CONSTRAINT IF EXISTS sku_metadata_sd_category_check;
ALTER TABLE public.sku_metadata
  ADD CONSTRAINT sku_metadata_sd_category_check
    CHECK (sd_category IS NULL OR sd_category IN ('sd','demo'));

-- Fast path for the Stock view checkbox + S/D catalog query.
CREATE INDEX IF NOT EXISTS idx_sku_metadata_is_scratch_dent
  ON public.sku_metadata (is_scratch_dent) WHERE is_scratch_dent = TRUE;

-- Compound index for catalog filters (model / size / color dropdowns).
CREATE INDEX IF NOT EXISTS idx_sku_metadata_sd_filters
  ON public.sku_metadata (model, size, color)
  WHERE is_scratch_dent = TRUE;

COMMENT ON COLUMN public.sku_metadata.is_scratch_dent IS
  'TRUE if this SKU is a Scratch & Dent or Demo unit. See sd_category for sub-type.';
COMMENT ON COLUMN public.sku_metadata.sd_category IS
  'NULL for non-S/D items. Either "sd" (damaged/defective) or "demo" (ridden display unit).';
COMMENT ON COLUMN public.sku_metadata.condition IS
  'Physical condition of an S/D unit. Constrained enum.';
COMMENT ON COLUMN public.sku_metadata.pdf_link IS
  'Link to a PDF (typically Dropbox) with photos / docs for an S/D unit.';
