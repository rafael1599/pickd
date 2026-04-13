-- ─────────────────────────────────────────────────────────────────────────────
-- Label Studio Phase 3: Hybrid sync — possible_locations on MOVE
-- 2026-04-13
--
-- After a MOVE, all asset_tags of that SKU in the source warehouse get
-- possible_locations set to ALL locations where the SKU currently has stock.
-- The tag resolves to an exact location when scanned, picked, or cycle-counted.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add possible_locations column
ALTER TABLE asset_tags ADD COLUMN IF NOT EXISTS possible_locations text[];

-- 2. Partial index for MOVE sync queries (only active tags)
CREATE INDEX IF NOT EXISTS idx_asset_tags_sku_warehouse
  ON asset_tags (sku, warehouse) WHERE status IN ('printed', 'in_stock');

-- 3. RPC to resolve a tag to a confirmed location (clears possible_locations)
CREATE OR REPLACE FUNCTION public.resolve_tag_location(
  p_tag_id uuid,
  p_location text
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE asset_tags
  SET location = UPPER(TRIM(p_location)),
      possible_locations = NULL
  WHERE id = p_tag_id;
$$;

-- 4. Redefine move_inventory_stock with asset_tag sync block appended
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
    p_internal_note TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_src_id BIGINT; v_src_prev_qty INTEGER; v_src_new_qty INTEGER; v_src_note TEXT;
  v_src_internal_note TEXT;
  v_from_loc_id UUID; v_from_loc_name TEXT; v_to_loc_id UUID; v_snapshot JSONB;
  v_resolved_note TEXT;
  v_dest_qty INTEGER;
  v_bike_dist JSONB;
  v_possible text[];
BEGIN
  p_from_location := NULLIF(TRIM(UPPER(p_from_location)), '');
  p_to_location   := NULLIF(TRIM(UPPER(p_to_location)), '');

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

  -- Capture FULL pre-move snapshot (before any changes)
  SELECT row_to_json(inv.*)::jsonb INTO v_snapshot
  FROM public.inventory inv
  WHERE inv.id = v_src_id;

  -- Resolve which internal_note to use at destination
  v_resolved_note := COALESCE(p_internal_note, v_src_internal_note);

  PERFORM public.adjust_inventory_quantity(p_sku, p_from_warehouse, p_from_location, -p_qty, p_performed_by, p_user_id, p_user_role, NULL, NULL, NULL, TRUE);
  v_src_new_qty := v_src_prev_qty - p_qty;
  PERFORM public.adjust_inventory_quantity(p_sku, p_to_warehouse, p_to_location, p_qty, p_performed_by, p_user_id, p_user_role, NULL, NULL, v_src_note, TRUE, v_resolved_note);

  -- Recalculate distribution for bike SKUs at destination
  v_bike_dist := public.calculate_bike_distribution(p_sku, NULL);
  IF v_bike_dist IS NOT NULL THEN
    SELECT quantity INTO v_dest_qty
    FROM public.inventory
    WHERE sku = p_sku AND warehouse = p_to_warehouse
      AND UPPER(TRIM(COALESCE(location, ''))) = UPPER(TRIM(COALESCE(p_to_location, '')));

    IF v_dest_qty IS NOT NULL AND v_dest_qty > 0 THEN
      v_bike_dist := public.calculate_bike_distribution(p_sku, v_dest_qty);
      UPDATE public.inventory
      SET distribution = v_bike_dist
      WHERE sku = p_sku AND warehouse = p_to_warehouse
        AND UPPER(TRIM(COALESCE(location, ''))) = UPPER(TRIM(COALESCE(p_to_location, '')));
    END IF;
  END IF;

  PERFORM public.upsert_inventory_log(
    p_sku::TEXT, p_from_warehouse::TEXT, v_from_loc_name::TEXT, p_to_warehouse::TEXT, p_to_location::TEXT,
    (-p_qty)::INTEGER, v_src_prev_qty::INTEGER, v_src_new_qty::INTEGER, 'MOVE'::TEXT,
    v_src_id::BIGINT, v_from_loc_id::UUID, v_to_loc_id::UUID, p_performed_by::TEXT, p_user_id::UUID, NULL::UUID, NULL::TEXT, v_snapshot::JSONB
  );

  -- ═══ PHASE 3: Sync asset_tags with possible_locations ═══
  -- After the move, all tags of this SKU in this warehouse get
  -- possible_locations set to every location where the SKU has stock.
  -- This doesn't guess which tags moved — they're all marked as
  -- "could be at any of these locations" until physically confirmed.
  SELECT array_agg(DISTINCT location ORDER BY location)
  INTO v_possible
  FROM public.inventory
  WHERE sku = p_sku
    AND warehouse = p_from_warehouse
    AND is_active = true
    AND quantity > 0
    AND location IS NOT NULL;

  IF v_possible IS NOT NULL AND array_length(v_possible, 1) > 0 THEN
    UPDATE asset_tags
    SET possible_locations = v_possible
    WHERE sku = p_sku
      AND warehouse = p_from_warehouse
      AND status IN ('printed', 'in_stock');
  END IF;

  RETURN jsonb_build_object('success', true, 'moved_qty', p_qty, 'id', v_src_id);
END;
$$;
