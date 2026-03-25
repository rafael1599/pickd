-- Smart auto-distribution for bike SKUs
--
-- Bike SKU format: NN-NNNNWW+ (e.g., 03-4703GY, 07-3697BK)
-- Algorithm: TOWER×30, then LINE×5, then LINE×remainder
-- Non-bike SKUs keep the existing default (1 TOWER × qty)

-- ============================================================
-- 1. calculate_bike_distribution(sku, qty) → JSONB or NULL
-- ============================================================
CREATE OR REPLACE FUNCTION public.calculate_bike_distribution(p_sku TEXT, p_qty INTEGER)
RETURNS JSONB
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_result JSONB := '[]'::JSONB;
  v_remaining INTEGER;
  v_towers INTEGER;
  v_full_lines INTEGER;
BEGIN
  -- Only for bike SKUs
  IF p_sku !~ '^\d{2}-\d{4}[A-Za-z]{2,}$' THEN
    RETURN NULL;
  END IF;

  IF p_qty <= 0 THEN
    RETURN '[]'::JSONB;
  END IF;

  v_remaining := p_qty;

  -- Towers of 30
  v_towers := floor(v_remaining / 30);
  IF v_towers > 0 THEN
    v_result := v_result || jsonb_build_array(
      jsonb_build_object('type', 'TOWER', 'count', v_towers, 'units_each', 30)
    );
    v_remaining := v_remaining - (v_towers * 30);
  END IF;

  -- Full lines of 5
  v_full_lines := floor(v_remaining / 5);
  IF v_full_lines > 0 THEN
    v_result := v_result || jsonb_build_array(
      jsonb_build_object('type', 'LINE', 'count', v_full_lines, 'units_each', 5)
    );
    v_remaining := v_remaining - (v_full_lines * 5);
  END IF;

  -- Remainder as a single line (1-4 units)
  IF v_remaining > 0 THEN
    v_result := v_result || jsonb_build_array(
      jsonb_build_object('type', 'LINE', 'count', 1, 'units_each', v_remaining)
    );
  END IF;

  RETURN v_result;
END;
$$;


-- ============================================================
-- 2. Enhanced trigger: smart distribution for bike SKUs
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_default_inventory_distribution()
RETURNS TRIGGER AS $$
DECLARE
  v_smart_dist JSONB;
BEGIN
  IF (NEW.distribution IS NULL OR NEW.distribution = '[]'::jsonb) AND NEW.quantity > 0 THEN
    -- Try smart distribution for bike SKUs
    v_smart_dist := public.calculate_bike_distribution(NEW.sku, NEW.quantity);

    IF v_smart_dist IS NOT NULL THEN
      NEW.distribution := v_smart_dist;
    ELSE
      -- Fallback: single tower for non-bike SKUs
      NEW.distribution := jsonb_build_array(
        jsonb_build_object('type', 'TOWER', 'count', 1, 'units_each', NEW.quantity)
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recreate trigger (was dropped by remote_schema migration)
DROP TRIGGER IF EXISTS tr_inventory_default_distribution ON public.inventory;
CREATE TRIGGER tr_inventory_default_distribution
BEFORE INSERT OR UPDATE OF quantity, distribution ON public.inventory
FOR EACH ROW
EXECUTE FUNCTION public.set_default_inventory_distribution();


-- ============================================================
-- 3. move_inventory_stock: recalculate distribution on merge
-- ============================================================
-- Drop old signature to avoid overload (same as in previous migration)
DROP FUNCTION IF EXISTS public.move_inventory_stock(text, text, text, text, text, integer, text, uuid, text);
DROP FUNCTION IF EXISTS public.move_inventory_stock(text, text, text, text, text, integer, text, uuid, text, text);

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
AS $$
DECLARE
  v_src_id BIGINT; v_src_prev_qty INTEGER; v_src_new_qty INTEGER; v_src_note TEXT;
  v_src_internal_note TEXT;
  v_from_loc_id UUID; v_from_loc_name TEXT; v_to_loc_id UUID; v_snapshot JSONB;
  v_resolved_note TEXT;
  v_dest_qty INTEGER;
  v_bike_dist JSONB;
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

  -- Recalculate distribution for bike SKUs at destination (covers both merge and no-merge)
  -- For no-merge (INSERT): trigger already set distribution, but we recalculate to be consistent
  -- For merge (UPDATE): trigger didn't fire because distribution wasn't NULL, so we recalculate here
  v_bike_dist := public.calculate_bike_distribution(p_sku, NULL);
  IF v_bike_dist IS NOT NULL THEN
    -- It's a bike SKU — read destination's final quantity and recalculate
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

  RETURN jsonb_build_object('success', true, 'moved_qty', p_qty, 'id', v_src_id);
END;
$$;
