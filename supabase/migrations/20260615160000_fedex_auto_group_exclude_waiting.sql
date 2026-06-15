-- Fix: auto_group_fedex_orders must also exclude WAITING-for-inventory orders.
--
-- Bug (prod, 2026-06-15): a FedEx order parked waiting for inventory for days
-- kept absorbing brand-new FedEx orders. The BEFORE-INSERT auto-group trigger
-- picks any active FedEx sibling and joins the new order to its group; the
-- sibling search excluded completed/cancelled/reopened/combined but NOT
-- is_waiting_inventory. A waiting order lives in needs_correction (an active
-- status), so it qualified as a sibling and new arrivals grouped into it.
--
-- This is the order_groups (group_id) path — distinct from the watchdog's
-- "A / B" combine_meta merge (already excluded via #43) and from the DB write
-- guard (#138, which protects items/order_number/combine_meta, not group_id).
-- Operator rule: waiting orders are parked and must never be auto-grouped with
-- new orders. Joining one stays a manual, user-confirmed action in PickD.
--
-- Purely additive: waiting siblings become ungroupable by the trigger. When
-- they are unmarked (unmark_picking_list_waiting), normal grouping resumes for
-- future arrivals.

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

  -- A new order that is itself waiting must not pull in siblings (defensive —
  -- inserts are not waiting yet, but keep the rule symmetric).
  IF NEW.is_waiting_inventory IS TRUE THEN
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
  -- Exclude WAITING orders (parked for inventory — never absorb new orders)
  SELECT pl.id, pl.group_id INTO v_sibling_id, v_sibling_group
  FROM picking_lists pl
  WHERE pl.id != COALESCE(NEW.id, gen_random_uuid())
    AND pl.status NOT IN ('completed', 'cancelled', 'reopened')
    AND pl.is_waiting_inventory IS NOT TRUE
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
  'Auto-groups new FedEx orders (global). Skips combined orders (order_number contains " / "). Excludes siblings in completed/cancelled/reopened status AND is_waiting_inventory orders from grouping. See idea-057, idea-067, bug 2026-06-15.';
