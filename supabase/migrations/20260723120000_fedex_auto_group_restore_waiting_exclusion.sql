-- Regression fix: auto_group_fedex_orders lost its is_waiting_inventory
-- exclusion (plus two related guards) when it was rewritten twice on
-- 2026-07-16 and 2026-07-17 to add the ">=5 bikes -> upgrade to regular"
-- feature. Both rewrites were based on an old snapshot of the function that
-- predated the 2026-06-15 fix (#147) — so a FedEx order parked waiting for
-- inventory started absorbing brand-new FedEx arrivals into its group
-- again, exactly the bug #147 fixed the first time.
--
-- Restores, on top of the current (2026-07-17) version:
--   - is_waiting_inventory IS NOT TRUE in the global sibling search (the
--     core #147 fix)
--   - skip if NEW itself is waiting (defensive symmetry, also from #147)
--   - skip combined orders (order_number containing " / ", from the
--     2026-04-20 fix)
--   - the same waiting exclusion applied to the >=5-bikes same-customer
--     check and its UPDATE, so a parked waiting order can't be silently
--     flipped to shipping_type 'regular' / ungrouped by a new arrival
--     either — same "waiting orders are never touched by automation" rule
--     as everywhere else (idea-053, #138).
--
-- Apply to prod after merge: npx supabase db push --linked

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

  -- A new order that is itself waiting must not pull in siblings (defensive —
  -- inserts are not waiting yet, but keep the rule symmetric).
  IF NEW.is_waiting_inventory IS TRUE THEN
    RETURN NEW;
  END IF;

  -- Skip combined orders (watcher merges them with ' / ' separator) —
  -- these already contain all items from their individual parts.
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

  -- If the combined active orders have >= 5 BIKES for the SAME customer, convert to REGULAR.
  SELECT COALESCE(SUM((item->>'pickingQty')::numeric), 0)::integer INTO v_new_bikes
  FROM jsonb_array_elements(NEW.items) AS item
  LEFT JOIN sku_metadata sm ON sm.sku = item->>'sku'
  WHERE sm.is_bike = true;

  IF NEW.customer_id IS NOT NULL THEN
    SELECT COALESCE(SUM((item->>'pickingQty')::numeric), 0)::integer INTO v_total_bikes
    FROM picking_lists pl
    CROSS JOIN jsonb_array_elements(pl.items) AS item
    LEFT JOIN sku_metadata sm ON sm.sku = item->>'sku'
    WHERE pl.customer_id = NEW.customer_id
      AND pl.id != COALESCE(NEW.id, gen_random_uuid())
      AND pl.status NOT IN ('completed', 'cancelled')
      AND pl.is_waiting_inventory IS NOT TRUE
      AND (
        pl.shipping_type = 'fedex'
        OR (pl.shipping_type IS NULL AND classify_picking_list_fedex(pl.items))
      )
      AND sm.is_bike = true;

    IF (v_new_bikes + v_total_bikes) >= 5 THEN
      -- Convert the NEW order to regular
      NEW.shipping_type := 'regular';

      -- Convert existing active (non-waiting) siblings for this customer to regular
      UPDATE picking_lists
      SET shipping_type = 'regular', group_id = NULL
      WHERE customer_id = NEW.customer_id
        AND id != COALESCE(NEW.id, gen_random_uuid())
        AND status NOT IN ('completed', 'cancelled')
        AND is_waiting_inventory IS NOT TRUE
        AND (shipping_type = 'fedex' OR (shipping_type IS NULL AND classify_picking_list_fedex(items)));

      RETURN NEW;
    END IF;
  END IF;

  -- Find ANY active fedex order (across all customers) — operational grouping.
  -- Exclude combined orders, reopened (mid-edit) orders, and WAITING orders
  -- (parked for inventory — must never absorb new arrivals).
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
    RETURN NEW; -- no sibling, leave ungrouped
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
  'Auto-groups new FedEx orders (global) and upgrades a customer''s combined FedEx orders to regular at >=5 bikes. Skips combined orders (order_number contains " / "), reopened orders, and is_waiting_inventory orders (never touched by automation). See idea-057, idea-067, #147, and the 2026-07-16/17 bikes-upgrade feature.';
