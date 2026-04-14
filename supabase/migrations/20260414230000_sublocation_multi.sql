-- idea-024b: Multi-sublocation support
-- Changes sublocation from text (single) to text[] (array) so a SKU
-- can span multiple shelf positions within a ROW (e.g. {C,D}).

-- 0. Helper: validates that every element is a single uppercase letter
CREATE OR REPLACE FUNCTION public.valid_sublocation_array(arr text[])
RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT cardinality(arr) > 0
    AND (SELECT bool_and(elem ~ '^[A-Z]$') FROM unnest(arr) AS elem);
$$;

-- 1. Drop old constraints and index
ALTER TABLE inventory DROP CONSTRAINT IF EXISTS sublocation_format;
ALTER TABLE inventory DROP CONSTRAINT IF EXISTS sublocation_only_rows;
DROP INDEX IF EXISTS idx_inventory_location_sublocation;

-- 2. Convert column: text → text[]
ALTER TABLE inventory
  ALTER COLUMN sublocation TYPE text[]
  USING CASE WHEN sublocation IS NOT NULL THEN ARRAY[sublocation] ELSE NULL END;

-- 3. New constraints
ALTER TABLE inventory ADD CONSTRAINT sublocation_format
  CHECK (sublocation IS NULL OR valid_sublocation_array(sublocation));

ALTER TABLE inventory ADD CONSTRAINT sublocation_only_rows
  CHECK (sublocation IS NULL OR location ILIKE 'ROW%');

-- 4. GIN index for array containment queries + sorting
CREATE INDEX idx_inventory_location_sublocation
  ON inventory USING gin (sublocation)
  WHERE is_active = true AND sublocation IS NOT NULL;

-- 5. Update move RPC to accept text[] sublocation
DROP FUNCTION IF EXISTS public.move_inventory_stock(text, text, text, text, text, integer, text, uuid, text, text, text);

CREATE OR REPLACE FUNCTION public.move_inventory_stock(
    p_sku TEXT,
    p_from_warehouse TEXT,
    p_from_location TEXT,
    p_to_warehouse TEXT,
    p_to_location TEXT,
    p_qty INTEGER,
    p_performed_by TEXT,
    p_user_id UUID DEFAULT NULL,
    p_user_role TEXT DEFAULT 'staff',
    p_internal_note TEXT DEFAULT NULL,
    p_sublocation TEXT[] DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_src_id BIGINT; v_src_prev_qty INTEGER; v_src_new_qty INTEGER; v_src_note TEXT;
  v_src_internal_note TEXT;
  v_from_loc_id UUID; v_from_loc_name TEXT; v_to_loc_id UUID; v_snapshot JSONB;
  v_resolved_note TEXT;
  v_resolved_sublocation TEXT[];
BEGIN
  p_from_location := NULLIF(TRIM(UPPER(p_from_location)), '');
  p_to_location   := NULLIF(TRIM(UPPER(p_to_location)), '');

  -- Auto-clear sublocation if destination is not a ROW
  IF p_to_location IS NOT NULL AND p_to_location ILIKE 'ROW%' THEN
    v_resolved_sublocation := p_sublocation;
  ELSE
    v_resolved_sublocation := NULL;
  END IF;

  SELECT id, quantity, item_name, internal_note
  INTO v_src_id, v_src_prev_qty, v_src_note, v_src_internal_note
  FROM public.inventory
  WHERE sku = p_sku AND warehouse = p_from_warehouse
    AND ((p_from_location IS NULL AND (location IS NULL OR location = '')) OR (location = p_from_location))
    AND is_active = TRUE
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Source item not found or inactive'; END IF;

  v_from_loc_id := public.resolve_location(p_from_warehouse, p_from_location);
  SELECT location INTO v_from_loc_name FROM public.locations WHERE id = v_from_loc_id;
  v_to_loc_id := public.resolve_location(p_to_warehouse, p_to_location);

  SELECT row_to_json(inv.*)::jsonb INTO v_snapshot
  FROM public.inventory inv
  WHERE inv.id = v_src_id;

  v_resolved_note := COALESCE(p_internal_note, v_src_internal_note);

  -- Deduct from source
  PERFORM public.adjust_inventory_quantity(p_sku, p_from_warehouse, p_from_location, -p_qty, p_performed_by, p_user_id, p_user_role, NULL, NULL, NULL, TRUE);
  v_src_new_qty := v_src_prev_qty - p_qty;

  -- Add to destination
  PERFORM public.adjust_inventory_quantity(p_sku, p_to_warehouse, p_to_location, p_qty, p_performed_by, p_user_id, p_user_role, NULL, NULL, v_src_note, TRUE, v_resolved_note);

  -- Set sublocation on destination row
  UPDATE inventory
  SET sublocation = v_resolved_sublocation
  WHERE sku = p_sku
    AND warehouse = p_to_warehouse
    AND UPPER(TRIM(COALESCE(location, ''))) = UPPER(TRIM(COALESCE(p_to_location, '')))
    AND is_active = true;

  PERFORM public.upsert_inventory_log(
    p_sku::TEXT, p_from_warehouse::TEXT, v_from_loc_name::TEXT, p_to_warehouse::TEXT, p_to_location::TEXT,
    (-p_qty)::INTEGER, v_src_prev_qty::INTEGER, v_src_new_qty::INTEGER, 'MOVE'::TEXT,
    v_src_id::BIGINT, v_from_loc_id::UUID, v_to_loc_id::UUID, p_performed_by::TEXT, p_user_id::UUID, NULL::UUID, NULL::TEXT, v_snapshot::JSONB
  );

  RETURN jsonb_build_object('success', true, 'moved_qty', p_qty, 'id', v_src_id);
END;
$$;
