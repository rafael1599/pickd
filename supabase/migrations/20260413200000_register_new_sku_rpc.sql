-- ─────────────────────────────────────────────────────────────────────────────
-- Label Studio Phase 2: register_new_sku RPC + asset_tags.location NOT NULL
-- 2026-04-13
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. RPC to atomically create sku_metadata + inventory row for a new SKU.
--    Used by Label Studio inline "Create New SKU" flow.
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
BEGIN
  -- Validate inputs
  IF v_sku = '' OR v_sku IS NULL THEN
    RAISE EXCEPTION 'SKU cannot be empty' USING ERRCODE = '22023';
  END IF;
  IF v_name = '' OR v_name IS NULL THEN
    RAISE EXCEPTION 'Item name cannot be empty' USING ERRCODE = '22023';
  END IF;
  IF v_location = '' OR v_location IS NULL THEN
    v_location := 'INCOMING';
  END IF;

  -- Create sku_metadata if not exists (dimensions/weight filled later)
  INSERT INTO sku_metadata (sku)
  VALUES (v_sku)
  ON CONFLICT (sku) DO NOTHING;

  -- Resolve location (auto-creates in locations table if needed)
  v_location_id := resolve_location(p_warehouse, v_location, 'admin');

  -- Create inventory row with qty=0 (bike hasn't arrived yet)
  INSERT INTO inventory (sku, warehouse, location, location_id, quantity, is_active, item_name)
  VALUES (v_sku, p_warehouse, v_location, v_location_id, 0, true, v_name)
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object(
    'sku', v_sku,
    'item_name', v_name,
    'location', v_location,
    'location_id', v_location_id
  );
END;
$$;

-- 2. Make asset_tags.location NOT NULL
--    Backfill any existing NULLs before adding the constraint.
UPDATE asset_tags SET location = 'UNKNOWN' WHERE location IS NULL;
ALTER TABLE asset_tags ALTER COLUMN location SET NOT NULL;
ALTER TABLE asset_tags ALTER COLUMN location SET DEFAULT 'UNKNOWN';
