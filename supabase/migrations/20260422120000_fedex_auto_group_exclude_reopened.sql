-- Fix: auto_group_fedex_orders should also exclude 'reopened' orders.
--
-- Context: An order in 'reopened' status is mid-edit after a completion was
-- manually reverted (e.g. for an Add-On merge or a correction). The existing
-- sibling search only excluded 'completed' and 'cancelled', so watchdog-pickd
-- inserting a new FedEx order for the same operational pool could auto-group
-- it with a reopened order that the user was actively editing, contaminating
-- the add-on group and breaking the verification UX.
--
-- This is purely additive: 'reopened' siblings stay ungroupable by the
-- trigger. When they are re-completed (recomplete_picking_list), normal
-- grouping resumes on the next trigger fire for future orders.

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
  -- Skip if order already has a group
  IF NEW.group_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Skip combined orders (watcher merges them with ' / ' separator)
  -- These already contain all items from their individual parts
  IF NEW.order_number IS NOT NULL AND position(' / ' in NEW.order_number) > 0 THEN
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

  -- Find ANY active fedex order (across all customers) — operational grouping
  -- Exclude combined orders (they have their own items already)
  -- Exclude 'reopened' orders (mid-edit, must not be auto-grouped)
  SELECT pl.id, pl.group_id INTO v_sibling_id, v_sibling_group
  FROM picking_lists pl
  WHERE pl.id != COALESCE(NEW.id, gen_random_uuid())
    AND pl.status NOT IN ('completed', 'cancelled', 'reopened')
    AND (pl.order_number IS NULL OR position(' / ' in pl.order_number) = 0)
    AND (
      pl.shipping_type = 'fedex'
      OR (pl.shipping_type IS NULL AND classify_picking_list_fedex(pl.items))
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

COMMENT ON FUNCTION auto_group_fedex_orders IS
  'Auto-groups new FedEx orders (global). Skips combined orders (order_number contains " / "). Excludes siblings in completed/cancelled/reopened status from grouping. See idea-057, idea-067.';
