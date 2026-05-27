-- Fix on top of 20260501120000_register_new_sku_canonical_dedup.sql.
--
-- Bug found in local testing: when the canonical form (e.g. '03-4664BR')
-- is passed in directly, the previous version redirected DOWNWARD to the
-- bogus duplicate ('034664BR'). Cause: lookup_canonical_sku excludes the
-- exact match → with two existing rows ('03-4664BR' + '034664BR'), it
-- returned whichever wasn't the input, regardless of which is canonical.
-- A naive `IF count = 1 THEN redirect` lost the directional information.
--
-- Fix: redirect only when the candidate has STRICTLY MORE dashes than
-- the input. Dashes are the canonical separator (e.g. '03-4664BR' has 1
-- dash, '034664BR' has 0). The heuristic is symmetric — passing the
-- canonical never redirects to the stripped form.
--
-- This migration ships the corrected function via CREATE OR REPLACE so
-- prod (which already has the buggy version applied) gets fixed on the
-- next `npx supabase db push --linked`.

CREATE OR REPLACE FUNCTION public.register_new_sku(
  p_sku text,
  p_item_name text,
  p_warehouse text DEFAULT 'LUDLOW',
  p_location text DEFAULT 'INCOMING'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_location_id uuid;
  v_sku text := upper(trim(p_sku));
  v_name text := trim(p_item_name);
  v_location text := upper(trim(p_location));
  v_canonical_sku text;
  v_canonical_dashes int;
  v_input_dashes int;
  v_redirected boolean := false;
BEGIN
  IF v_sku = '' OR v_sku IS NULL THEN
    RAISE EXCEPTION 'SKU cannot be empty' USING ERRCODE = '22023';
  END IF;
  IF v_name = '' OR v_name IS NULL THEN
    RAISE EXCEPTION 'Item name cannot be empty' USING ERRCODE = '22023';
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

  INSERT INTO sku_metadata (sku)
  VALUES (v_sku)
  ON CONFLICT (sku) DO NOTHING;

  v_location_id := resolve_location(p_warehouse, v_location, 'admin');

  INSERT INTO inventory (sku, warehouse, location, location_id, quantity, is_active, item_name)
  VALUES (v_sku, p_warehouse, v_location, v_location_id, 0, true, v_name)
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object(
    'sku', v_sku,
    'item_name', v_name,
    'location', v_location,
    'location_id', v_location_id,
    'canonical_redirect', v_redirected
  );
END;
$$;
