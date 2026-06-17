-- Public RPC: resolve a tag's SKU-level info by SKU alone (no token).
--
-- The printed-label QR now carries only the SKU (/s/<sku>) to keep the code as
-- short/sparse as possible. Because a SKU maps to many physical tags, this
-- returns SKU-level fields only (from sku_metadata + inventory); the per-tag
-- fields (short_code, serial, P/O, C/No, made-in, notes, label photo) are not
-- available by SKU and come back null. This is intentionally enumerable — anyone
-- with a SKU can read its public info (same data the QR exposes anyway).
--
-- The token-gated get_public_tag(short_code, token) stays for already-printed
-- labels (anti-enumeration), so nothing needs reprinting.
CREATE OR REPLACE FUNCTION get_public_tag_by_sku(p_sku text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'short_code', NULL,
    'sku', sm.sku,
    'item_name', (
      SELECT i.item_name FROM inventory i
      WHERE i.sku = sm.sku AND i.is_active = true
      ORDER BY i.quantity DESC NULLS LAST
      LIMIT 1
    ),
    'image_url', sm.image_url,
    'is_bike', sm.is_bike,
    'length_in', sm.length_in,
    'width_in', sm.width_in,
    'height_in', sm.height_in,
    'weight_lbs', sm.weight_lbs,
    'upc', sm.upc,
    'po_number', NULL,
    'c_number', NULL,
    'serial_number', NULL,
    'made_in', NULL,
    'other_notes', NULL,
    'label_photo_url', NULL
  ) INTO v_result
  FROM sku_metadata sm
  WHERE sm.sku = p_sku
  LIMIT 1;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION get_public_tag_by_sku FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_public_tag_by_sku TO anon, authenticated, service_role;
