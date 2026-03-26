-- Add image_url column to sku_metadata for item photos
ALTER TABLE public.sku_metadata
  ADD COLUMN IF NOT EXISTS image_url text;
