-- ============================================================================
-- register_new_sku nombra una parte por su modelo, con los valores ya normalizados
-- (24 sep 2026, bug-044)
--
-- Sin nombre explícito armaba «modelo talla color» también para partes, y con
-- los valores tal como llegaban: el lote por fotos registraba una parte nueva
-- como `ENDURA FRAME 700 x 54` mientras el formulario ya la nombra `ENDURA
-- FRAME` (una parte se nombra por su modelo, nameAfterSave). Ahora el nombre se
-- arma después de escribir la metadata, con lo que el catálogo guardó —la talla
-- canónica, el color en mayúsculas— y según el tipo que resolvió la fila.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.register_new_sku(p_sku text, p_item_name text DEFAULT NULL::text, p_warehouse text DEFAULT 'LUDLOW'::text, p_location text DEFAULT 'INCOMING'::text, p_model text DEFAULT NULL::text, p_size text DEFAULT NULL::text, p_color text DEFAULT NULL::text, p_serial_number text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_location_id uuid;
  v_sku text := public.canonical_sku(p_sku); -- idea-154: one spelling, before any lookup
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

  IF v_name IS NULL AND v_model IS NULL AND v_size IS NULL AND v_color IS NULL THEN
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

  -- No explicit name: derived from what the catalogue now holds — the size and
  -- colour after their triggers normalised them, and the type the row resolved
  -- to. A bike is "Model Size Colour"; a part is its model alone, as the form
  -- names it (nameAfterSave, 20260923). Only a part with no model falls back to
  -- its size and colour, so nothing that used to register stops registering.
  IF v_name IS NULL THEN
    SELECT CASE
             WHEN coalesce(m.is_bike, true)
               THEN NULLIF(concat_ws(' ', m.model, m.size, m.color), '')
             ELSE coalesce(NULLIF(btrim(m.model), ''), NULLIF(concat_ws(' ', m.size, m.color), ''))
           END
      INTO v_name
      FROM sku_metadata m
     WHERE m.sku = v_sku;
  END IF;

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
$function$;
