-- Asset tags: extra fields + public_token (anti-enumeration) + public RPC

-- New columns
ALTER TABLE asset_tags
  ADD COLUMN IF NOT EXISTS public_token uuid DEFAULT gen_random_uuid() UNIQUE,
  ADD COLUMN IF NOT EXISTS upc text,
  ADD COLUMN IF NOT EXISTS po_number text,
  ADD COLUMN IF NOT EXISTS c_number text,
  ADD COLUMN IF NOT EXISTS serial_number text,
  ADD COLUMN IF NOT EXISTS made_in text,
  ADD COLUMN IF NOT EXISTS other_notes text,
  ADD COLUMN IF NOT EXISTS label_photo_url text;

-- Populate public_token for any existing rows
UPDATE asset_tags SET public_token = gen_random_uuid() WHERE public_token IS NULL;
ALTER TABLE asset_tags ALTER COLUMN public_token SET NOT NULL;

-- Validation constraints
ALTER TABLE asset_tags
  ADD CONSTRAINT chk_upc_format CHECK (upc IS NULL OR char_length(upc) <= 50),
  ADD CONSTRAINT chk_serial_length CHECK (serial_number IS NULL OR char_length(serial_number) <= 100),
  ADD CONSTRAINT chk_po_length CHECK (po_number IS NULL OR char_length(po_number) <= 50),
  ADD CONSTRAINT chk_notes_length CHECK (other_notes IS NULL OR char_length(other_notes) <= 500);

CREATE INDEX IF NOT EXISTS idx_asset_tags_public_token ON asset_tags (public_token);

-- Public RPC: returns tag details without auth.
-- Requires both short_code AND public_token (anti-enumeration).
CREATE OR REPLACE FUNCTION get_public_tag(p_short_code text, p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'short_code', at.short_code,
    'sku', at.sku,
    'item_name', i.item_name,
    'image_url', sm.image_url,
    'is_bike', sm.is_bike,
    'length_in', sm.length_in,
    'width_in', sm.width_in,
    'height_in', sm.height_in,
    'weight_lbs', sm.weight_lbs,
    'upc', at.upc,
    'po_number', at.po_number,
    'c_number', at.c_number,
    'serial_number', at.serial_number,
    'made_in', at.made_in,
    'other_notes', at.other_notes,
    'label_photo_url', at.label_photo_url
  ) INTO v_result
  FROM asset_tags at
  LEFT JOIN inventory i ON at.sku = i.sku AND i.warehouse = at.warehouse AND i.is_active = true
  LEFT JOIN sku_metadata sm ON at.sku = sm.sku
  WHERE at.short_code = p_short_code
    AND at.public_token = p_token
  LIMIT 1;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION get_public_tag FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_public_tag TO anon, authenticated, service_role;
