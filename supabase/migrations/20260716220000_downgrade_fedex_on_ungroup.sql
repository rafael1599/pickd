-- When an order is removed from a group (group_id becomes null or changes),
-- we should re-evaluate the shipping_type of both the removed order AND the remaining group.
-- If they now have < 5 bikes, they should be downgraded back to 'fedex'.

CREATE OR REPLACE FUNCTION reevaluate_shipping_type_on_ungroup()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_group_bikes integer;
  v_order_bikes integer;
  v_group_id uuid;
BEGIN
  -- We only care when an order is removed from a group
  IF OLD.group_id IS NOT NULL AND (NEW.group_id IS NULL OR NEW.group_id != OLD.group_id) THEN
    
    -- 1. Evaluate the removed order itself
    IF OLD.shipping_type = 'regular' THEN
      SELECT COALESCE(SUM((item->>'pickingQty')::numeric), 0)::integer INTO v_order_bikes
      FROM jsonb_array_elements(NEW.items) AS item
      LEFT JOIN sku_metadata sm ON sm.sku = item->>'sku'
      WHERE sm.is_bike = true;

      -- If the individual order has < 5 bikes AND it qualifies for fedex
      IF v_order_bikes < 5 AND classify_picking_list_fedex(NEW.items) THEN
        NEW.shipping_type := 'fedex';
      END IF;
    END IF;

    -- 2. Evaluate the remaining orders in the OLD group
    -- We use an autonomous-like check (or deferred check, but we can just update them here)
    v_group_id := OLD.group_id;
    
    SELECT COALESCE(SUM((item->>'pickingQty')::numeric), 0)::integer INTO v_group_bikes
    FROM picking_lists pl
    CROSS JOIN jsonb_array_elements(pl.items) AS item
    LEFT JOIN sku_metadata sm ON sm.sku = item->>'sku'
    WHERE pl.group_id = v_group_id
      AND pl.id != NEW.id -- exclude the one being removed
      AND pl.status NOT IN ('completed', 'cancelled')
      AND sm.is_bike = true;

    IF v_group_bikes < 5 THEN
      -- Downgrade remaining siblings to fedex if they individually qualify
      -- Actually, if they are in a group, we can just set them to fedex if their combined items qualify.
      -- For simplicity, if bikes < 5, we can revert them to fedex if they were originally fedex or qualify.
      -- Let's just update shipping_type = 'fedex' for those that qualify.
      UPDATE picking_lists pl
      SET shipping_type = 'fedex'
      WHERE pl.group_id = v_group_id
        AND pl.id != NEW.id
        AND pl.shipping_type = 'regular'
        AND classify_picking_list_fedex(pl.items);
        
      -- Update the group type back to fedex if we downgraded any
      UPDATE order_groups SET group_type = 'fedex' WHERE id = v_group_id;
    END IF;

  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reevaluate_shipping_type_on_ungroup_trigger ON picking_lists;
CREATE TRIGGER reevaluate_shipping_type_on_ungroup_trigger
BEFORE UPDATE ON picking_lists
FOR EACH ROW
WHEN (OLD.group_id IS NOT NULL AND (NEW.group_id IS NULL OR NEW.group_id != OLD.group_id))
EXECUTE FUNCTION reevaluate_shipping_type_on_ungroup();
