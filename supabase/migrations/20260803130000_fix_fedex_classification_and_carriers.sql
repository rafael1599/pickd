-- ============================================================================
-- Fix: Auto-Classification Mismatch for Freight/Regular Truck Orders
--
-- Problems Fixed:
-- 1. When an order has an explicit transport_company (e.g. 'RIST', 'R+L', 'DAYLIGHT',
--    'ESTES', 'ODFL', 'PICK UP'), but shipping_type was NULL, classify_picking_list_fedex
--    and auto_group_fedex_orders ignored the freight carrier string and auto-cataloged
--    the order as FedEx if bike count was < 5.
-- 2. classify_picking_list_fedex used INNER JOIN sku_metadata, which dropped items
--    without metadata or format variations (e.g. missing dash 033780BL vs 03-3780BL),
--    causing total bike count to evaluate to 0.
-- 3. SKU prefix fallback now includes 01, 02, 03, 06, 07 bike series.
-- ============================================================================

-- 1. Update classify_picking_list_fedex to check transport_company and use LEFT JOIN with prefix fallback
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

-- 2. Update auto_group_fedex_orders trigger function
CREATE OR REPLACE FUNCTION public.auto_group_fedex_orders()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_is_fedex boolean;
  v_sibling_id uuid;
  v_sibling_group uuid;
  v_new_group uuid;
  v_total_bikes integer;
  v_new_bikes integer;
  v_transport text;
BEGIN
  -- Skip if order already has a group (manual creation/import already grouped)
  IF NEW.group_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_transport := UPPER(TRIM(COALESCE(NEW.transport_company, '')));

  -- Determine if this order is fedex
  IF v_transport = 'FEDEX' THEN
    v_is_fedex := true;
  ELSIF v_transport != '' THEN
    v_is_fedex := false; -- Explicit freight/regular carrier assigned
  ELSIF NEW.shipping_type = 'fedex' THEN
    v_is_fedex := true;
  ELSIF NEW.shipping_type = 'regular' THEN
    v_is_fedex := false;
  ELSE
    v_is_fedex := classify_picking_list_fedex(NEW.items, NEW.transport_company);
  END IF;

  IF NOT v_is_fedex THEN
    RETURN NEW;
  END IF;

  -- If the combined active orders have >= 5 BIKES for the SAME customer, convert to REGULAR.
  SELECT COALESCE(SUM((item->>'pickingQty')::numeric), 0)::integer INTO v_new_bikes
  FROM jsonb_array_elements(NEW.items) AS item
  LEFT JOIN sku_metadata sm ON sm.sku = item->>'sku'
  WHERE COALESCE(sm.is_bike, LEFT(item->>'sku', 2) IN ('01','02','03','06','07')) = true;

  IF NEW.customer_id IS NOT NULL THEN
    SELECT COALESCE(SUM((item->>'pickingQty')::numeric), 0)::integer INTO v_total_bikes
    FROM picking_lists pl
    CROSS JOIN jsonb_array_elements(pl.items) AS item
    LEFT JOIN sku_metadata sm ON sm.sku = item->>'sku'
    WHERE pl.customer_id = NEW.customer_id
      AND pl.id != COALESCE(NEW.id, gen_random_uuid())
      AND pl.status NOT IN ('completed', 'cancelled')
      AND (
        pl.shipping_type = 'fedex'
        OR (pl.shipping_type IS NULL AND classify_picking_list_fedex(pl.items, pl.transport_company))
      )
      AND COALESCE(sm.is_bike, LEFT(item->>'sku', 2) IN ('01','02','03','06','07')) = true;

    IF (v_new_bikes + v_total_bikes) >= 5 THEN
      -- Convert the NEW order to regular
      NEW.shipping_type := 'regular';
      
      -- Convert existing active siblings for this customer to regular
      UPDATE picking_lists 
      SET shipping_type = 'regular', group_id = NULL 
      WHERE customer_id = NEW.customer_id 
        AND id != COALESCE(NEW.id, gen_random_uuid())
        AND status NOT IN ('completed', 'cancelled')
        AND (shipping_type = 'fedex' OR (shipping_type IS NULL AND classify_picking_list_fedex(items, transport_company)));

      RETURN NEW;
    END IF;
  END IF;

  -- Find ANY active fedex order (across all customers) — operational grouping
  SELECT pl.id, pl.group_id INTO v_sibling_id, v_sibling_group
  FROM picking_lists pl
  WHERE pl.id != COALESCE(NEW.id, gen_random_uuid())
    AND pl.status NOT IN ('completed', 'cancelled', 'reopened')
    AND (
      pl.shipping_type = 'fedex'
      OR (pl.shipping_type IS NULL AND classify_picking_list_fedex(pl.items, pl.transport_company))
    )
  ORDER BY pl.created_at ASC
  LIMIT 1;

  IF v_sibling_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_sibling_group IS NOT NULL THEN
    NEW.group_id := v_sibling_group;
  ELSE
    INSERT INTO order_groups (group_type) VALUES ('fedex') RETURNING id INTO v_new_group;
    UPDATE picking_lists SET group_id = v_new_group WHERE id = v_sibling_id;
    NEW.group_id := v_new_group;
  END IF;

  RETURN NEW;
END;
$$;
