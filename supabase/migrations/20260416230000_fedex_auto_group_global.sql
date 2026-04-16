-- Refactor auto_group_fedex_orders to be GLOBAL, not customer-scoped (idea-057 follow-up)
--
-- Original logic grouped FedEx orders by customer (assuming physical
-- consolidation into one box). Real intent: operational grouping so the
-- picker handles all active FedEx orders in a single Double Check session
-- and completes them all at once. Each FedEx item still ships in its own
-- box with its own customer label — grouping is purely UX.

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

  -- Find ANY active fedex order (across all customers) — operational grouping
  SELECT pl.id, pl.group_id INTO v_sibling_id, v_sibling_group
  FROM picking_lists pl
  WHERE pl.id != COALESCE(NEW.id, gen_random_uuid())
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

COMMENT ON FUNCTION auto_group_fedex_orders IS
  'Auto-groups new FedEx orders with any active FedEx sibling (across customers). Operational grouping for batch double-check + complete-all-at-once. See idea-057.';
