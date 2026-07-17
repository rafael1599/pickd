CREATE OR REPLACE FUNCTION auto_group_fedex_orders()
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
BEGIN
  -- Skip if order already has a group (manual creation/import already grouped)
  IF NEW.group_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Skip if no customer_id (can't match siblings)
  IF NEW.customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Determine if this order is fedex
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
    NEW.group_id := v_sibling_group;
  ELSE
    INSERT INTO order_groups (group_type) VALUES ('fedex') RETURNING id INTO v_new_group;
    UPDATE picking_lists SET group_id = v_new_group WHERE id = v_sibling_id;
    NEW.group_id := v_new_group;
  END IF;

  -- NEW REQUIREMENT: If the combined group has >= 5 BIKES for the SAME customer, convert to REGULAR
  -- First, get the bikes in the NEW order:
  SELECT COALESCE(SUM((item->>'pickingQty')::numeric), 0)::integer INTO v_new_bikes
  FROM jsonb_array_elements(NEW.items) AS item
  LEFT JOIN sku_metadata sm ON sm.sku = item->>'sku'
  WHERE sm.is_bike = true;

  -- Then, get the bikes in ALL existing orders in the group:
  SELECT COALESCE(SUM((item->>'pickingQty')::numeric), 0)::integer INTO v_total_bikes
  FROM picking_lists pl
  CROSS JOIN jsonb_array_elements(pl.items) AS item
  LEFT JOIN sku_metadata sm ON sm.sku = item->>'sku'
  WHERE pl.group_id = NEW.group_id
    AND pl.id != COALESCE(NEW.id, gen_random_uuid())
    AND sm.is_bike = true;

  IF (v_new_bikes + v_total_bikes) >= 5 THEN
    -- Convert the NEW order to regular
    NEW.shipping_type := 'regular';
    
    -- Convert existing siblings in the group to regular
    -- And change the group type to 'general' (since 'fedex' implies it's a FedEx group)
    UPDATE picking_lists SET shipping_type = 'regular' WHERE group_id = NEW.group_id AND id != COALESCE(NEW.id, gen_random_uuid());
    UPDATE order_groups SET group_type = 'general' WHERE id = NEW.group_id;
  END IF;

  RETURN NEW;
END;
$$;
