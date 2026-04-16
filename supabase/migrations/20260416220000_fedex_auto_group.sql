-- Auto-group FedEx orders by customer at INSERT time (idea-057)
--
-- When a new picking_list is inserted, classify it as fedex/regular based on
-- items + sku_metadata weights. If fedex AND there's another active fedex
-- order for the same customer, auto-group them.
--
-- Rules (matches src/utils/shippingClassification.ts):
--   - Any item weight > 50lbs → regular
--   - Total items (sum of pickingQty) >= 5 → regular
--   - Otherwise → fedex

CREATE OR REPLACE FUNCTION classify_picking_list_fedex(p_items jsonb)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_total_qty integer;
  v_has_heavy boolean;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN true; -- empty order → fedex by default (no items to weigh)
  END IF;

  -- Rule 1: any item > 50 lbs (join with sku_metadata)
  SELECT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) AS item
    LEFT JOIN sku_metadata sm ON sm.sku = item->>'sku'
    WHERE COALESCE(sm.weight_lbs, 0) > 50
  ) INTO v_has_heavy;

  IF v_has_heavy THEN RETURN false; END IF;

  -- Rule 2: total qty >= 5
  SELECT COALESCE(SUM((item->>'pickingQty')::numeric), 0)::integer
  INTO v_total_qty
  FROM jsonb_array_elements(p_items) AS item;

  IF v_total_qty >= 5 THEN RETURN false; END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION auto_group_fedex_orders()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_is_fedex boolean;
  v_sibling_id uuid;
  v_sibling_group uuid;
  v_new_group uuid;
BEGIN
  -- Skip if order already has a group (manual creation/import already grouped)
  IF NEW.group_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Skip if no customer_id (can't match siblings)
  IF NEW.customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Determine if this order is fedex (use explicit shipping_type if set,
  -- otherwise auto-classify from items)
  IF NEW.shipping_type = 'fedex' THEN
    v_is_fedex := true;
  ELSIF NEW.shipping_type = 'regular' THEN
    v_is_fedex := false;
  ELSE
    v_is_fedex := classify_picking_list_fedex(NEW.items);
  END IF;

  IF NOT v_is_fedex THEN
    RETURN NEW;
  END IF;

  -- Find another active fedex order for the same customer
  -- Active = not completed/cancelled
  SELECT pl.id, pl.group_id INTO v_sibling_id, v_sibling_group
  FROM picking_lists pl
  WHERE pl.customer_id = NEW.customer_id
    AND pl.id != COALESCE(NEW.id, gen_random_uuid())
    AND pl.status NOT IN ('completed', 'cancelled')
    AND (
      pl.shipping_type = 'fedex'
      OR (pl.shipping_type IS NULL AND classify_picking_list_fedex(pl.items))
    )
  ORDER BY pl.created_at ASC
  LIMIT 1;

  IF v_sibling_id IS NULL THEN
    RETURN NEW; -- no sibling, leave ungrouped
  END IF;

  IF v_sibling_group IS NOT NULL THEN
    -- Sibling already in a group → join it
    NEW.group_id := v_sibling_group;
  ELSE
    -- No group yet → create one with both orders
    INSERT INTO order_groups (group_type) VALUES ('fedex') RETURNING id INTO v_new_group;
    UPDATE picking_lists SET group_id = v_new_group WHERE id = v_sibling_id;
    NEW.group_id := v_new_group;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auto_group_fedex_orders_trigger ON picking_lists;
CREATE TRIGGER auto_group_fedex_orders_trigger
  BEFORE INSERT ON picking_lists
  FOR EACH ROW
  EXECUTE FUNCTION auto_group_fedex_orders();

COMMENT ON FUNCTION auto_group_fedex_orders IS
  'Auto-groups new FedEx orders with sibling active FedEx orders for the same customer. See idea-057.';
