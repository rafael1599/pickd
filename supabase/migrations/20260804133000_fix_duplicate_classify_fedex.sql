-- ============================================================================
-- Fix: Ambiguous Function Error 42725 on FedEx Group Removal (Ungroup)
--
-- Root Cause:
-- A previous migration added a 2nd argument (p_transport_company text DEFAULT NULL)
-- to classify_picking_list_fedex, creating an overloaded function alongside the
-- original classify_picking_list_fedex(jsonb). When triggers (like reevaluate_shipping_type_on_ungroup)
-- executed classify_picking_list_fedex(items), Postgres failed with:
--   "function classify_picking_list_fedex(jsonb) is not unique" (code 42725)
--
-- Solution:
-- 1. Drop both overloaded versions of classify_picking_list_fedex.
-- 2. Re-create a single canonical function classify_picking_list_fedex(jsonb, text).
-- 3. Update reevaluate_shipping_type_on_ungroup to pass transport_company explicitly.
-- ============================================================================

-- 1. Drop old functions to eliminate ambiguous signature conflict
DROP FUNCTION IF EXISTS public.classify_picking_list_fedex(jsonb);
DROP FUNCTION IF EXISTS public.classify_picking_list_fedex(jsonb, text);

-- 2. Re-create single canonical function
CREATE OR REPLACE FUNCTION public.classify_picking_list_fedex(
  p_items jsonb,
  p_transport_company text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bike_qty integer;
  v_has_heavy boolean;
  v_transport text;
BEGIN
  v_transport := UPPER(TRIM(COALESCE(p_transport_company, '')));
  IF v_transport = 'FEDEX' THEN
    RETURN true;
  END IF;
  IF v_transport != '' AND v_transport != 'FEDEX' THEN
    RETURN false; -- Explicit freight/regular carrier assigned
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN true; -- empty order → fedex by default
  END IF;

  -- Rule 1: any item > 50 lbs (join with sku_metadata)
  SELECT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) AS item
    LEFT JOIN sku_metadata sm ON sm.sku = item->>'sku'
    WHERE COALESCE(sm.weight_lbs, 0) > 50
  ) INTO v_has_heavy;

  IF v_has_heavy THEN RETURN false; END IF;

  -- Rule 2: >= 5 BIKES (sku_metadata.is_bike or prefix fallback 01, 02, 03, 06, 07)
  SELECT COALESCE(SUM((item->>'pickingQty')::numeric), 0)::integer
  INTO v_bike_qty
  FROM jsonb_array_elements(p_items) AS item
  LEFT JOIN sku_metadata sm ON sm.sku = item->>'sku'
  WHERE COALESCE(sm.is_bike, LEFT(item->>'sku', 2) IN ('01','02','03','06','07')) = true;

  IF v_bike_qty >= 5 THEN RETURN false; END IF;

  RETURN true;
END;
$$;

-- 3. Update reevaluate_shipping_type_on_ungroup trigger function
CREATE OR REPLACE FUNCTION public.reevaluate_shipping_type_on_ungroup()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_group_bikes integer;
  v_order_bikes integer;
  v_group_id uuid;
BEGIN
  -- Only trigger when an order is removed from a group
  IF OLD.group_id IS NOT NULL AND (NEW.group_id IS NULL OR NEW.group_id != OLD.group_id) THEN
    
    -- 1. Evaluate the removed order itself
    IF OLD.shipping_type = 'regular' THEN
      SELECT COALESCE(SUM((item->>'pickingQty')::numeric), 0)::integer INTO v_order_bikes
      FROM jsonb_array_elements(NEW.items) AS item
      LEFT JOIN sku_metadata sm ON sm.sku = item->>'sku'
      WHERE COALESCE(sm.is_bike, LEFT(item->>'sku', 2) IN ('01','02','03','06','07')) = true;

      -- If the individual order has < 5 bikes AND it qualifies for fedex
      IF v_order_bikes < 5 AND classify_picking_list_fedex(NEW.items, NEW.transport_company) THEN
        NEW.shipping_type := 'fedex';
      END IF;
    END IF;

    -- 2. Evaluate the remaining orders in the OLD group
    v_group_id := OLD.group_id;
    
    SELECT COALESCE(SUM((item->>'pickingQty')::numeric), 0)::integer INTO v_group_bikes
    FROM picking_lists pl
    CROSS JOIN jsonb_array_elements(pl.items) AS item
    LEFT JOIN sku_metadata sm ON sm.sku = item->>'sku'
    WHERE pl.group_id = v_group_id
      AND pl.id != NEW.id -- exclude the one being removed
      AND pl.status NOT IN ('completed', 'cancelled')
      AND COALESCE(sm.is_bike, LEFT(item->>'sku', 2) IN ('01','02','03','06','07')) = true;

    IF v_group_bikes < 5 THEN
      UPDATE picking_lists pl
      SET shipping_type = 'fedex'
      WHERE pl.group_id = v_group_id
        AND pl.id != NEW.id
        AND pl.shipping_type = 'regular'
        AND classify_picking_list_fedex(pl.items, pl.transport_company);
        
      UPDATE order_groups SET group_type = 'fedex' WHERE id = v_group_id;
    END IF;

  END IF;

  RETURN NEW;
END;
$$;
