-- Register-new-SKU: collect Model / Size / Color / Serial instead of a free-text
-- name. The item_name is derived as "Model Size Color" (same format the S/D bikes
-- use), so labels render the model line without anyone typing a name.
--
-- Backward compatible: p_item_name is still accepted (FedEx returns pass a
-- placeholder name). When p_item_name is NULL/empty, the name is built from
-- model/size/color. The 4 new params are optional and trailing, so existing
-- named-arg callers keep resolving.
--
-- The old 4-arg signature is DROPPED first: adding trailing optional params via
-- CREATE OR REPLACE would leave two overloads, making a 4-named-arg call
-- ("function is not unique"). Dropping + recreating is atomic in this migration.
--
-- PUBLIC keeps EXECUTE automatically (default grant on a new SECURITY DEFINER
-- function), so anon/authenticated/service_role access is preserved.

DROP FUNCTION IF EXISTS public.register_new_sku(text, text, text, text);

CREATE OR REPLACE FUNCTION public.register_new_sku(
  p_sku text,
  p_item_name text DEFAULT NULL,
  p_warehouse text DEFAULT 'LUDLOW',
  p_location text DEFAULT 'INCOMING',
  p_model text DEFAULT NULL,
  p_size text DEFAULT NULL,
  p_color text DEFAULT NULL,
  p_serial_number text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_location_id uuid;
  v_sku text := upper(trim(p_sku));
  v_location text := upper(trim(p_location));
  v_model text := NULLIF(trim(p_model), '');
  v_size text := NULLIF(trim(p_size), '');
  v_color text := NULLIF(trim(p_color), '');
  v_serial text := NULLIF(trim(p_serial_number), '');
  v_name text := NULLIF(trim(p_item_name), '');
  v_canonical_sku text;
  v_canonical_dashes int;
  v_input_dashes int;
  v_redirected boolean := false;
BEGIN
  IF v_sku = '' OR v_sku IS NULL THEN
    RAISE EXCEPTION 'SKU cannot be empty' USING ERRCODE = '22023';
  END IF;

  -- Derive the display name from Model/Size/Color when no explicit name is given.
  -- concat_ws skips NULLs, so a missing field never leaves a double space.
  IF v_name IS NULL THEN
    v_name := NULLIF(concat_ws(' ', v_model, v_size, v_color), '');
  END IF;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Provide an item name or at least a model/size/color'
      USING ERRCODE = '22023';
  END IF;

  IF v_location = '' OR v_location IS NULL THEN
    v_location := 'INCOMING';
  END IF;

  -- Pick the candidate with the most dashes (canonical convention).
  -- Tie-break alphabetically for determinism.
  SELECT sku, length(regexp_replace(sku, '[^-]', '', 'g'))
    INTO v_canonical_sku, v_canonical_dashes
  FROM public.lookup_canonical_sku(v_sku)
  ORDER BY length(regexp_replace(sku, '[^-]', '', 'g')) DESC, sku ASC
  LIMIT 1;

  v_input_dashes := length(regexp_replace(v_sku, '[^-]', '', 'g'));

  -- Only redirect upward (more dashes = more canonical).
  IF v_canonical_sku IS NOT NULL AND v_canonical_dashes > v_input_dashes THEN
    v_sku := v_canonical_sku;
    v_redirected := true;
  END IF;

  -- Persist the structured fields on sku_metadata. COALESCE so re-registering an
  -- existing SKU with blanks never wipes previously stored values.
  INSERT INTO sku_metadata (sku, model, size, color, serial_number)
  VALUES (v_sku, v_model, v_size, v_color, v_serial)
  ON CONFLICT (sku) DO UPDATE SET
    model         = COALESCE(EXCLUDED.model, sku_metadata.model),
    size          = COALESCE(EXCLUDED.size, sku_metadata.size),
    color         = COALESCE(EXCLUDED.color, sku_metadata.color),
    serial_number = COALESCE(EXCLUDED.serial_number, sku_metadata.serial_number);

  v_location_id := resolve_location(p_warehouse, v_location, 'admin');

  INSERT INTO inventory (sku, warehouse, location, location_id, quantity, is_active, item_name)
  VALUES (v_sku, p_warehouse, v_location, v_location_id, 0, true, v_name)
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object(
    'sku', v_sku,
    'item_name', v_name,
    'model', v_model,
    'size', v_size,
    'color', v_color,
    'serial_number', v_serial,
    'location', v_location,
    'location_id', v_location_id,
    'canonical_redirect', v_redirected
  );
END;
$$;
