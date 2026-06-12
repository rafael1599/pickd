-- idea-151 (follow-up): waiting orders are off-limits for AUTOMATIC writes.
--
-- The watchdog (Bay 2) talks to PostgREST with the service_role key, so the
-- client-side guards (watchdog #43 auto-combine exclusion, #46 append guard)
-- only protect prod when the daemon runs a current build. This trigger
-- enforces the rule at the source of truth: while a picking list is parked
-- waiting for inventory (needs_correction + is_waiting_inventory), requests
-- authenticated as service_role may not touch its merge surface — items,
-- order_number (combine renames to "A / B") or combine_meta.
--
-- Manual PickD actions (edit order, take_over_sku_from_waiting, unmark) run
-- with an authenticated user JWT and stay allowed. Direct DB sessions (psql,
-- migrations, maintenance) carry no request.jwt.claims and stay allowed.
-- The auto-cancel edge function (service_role) only touches status='reopened'
-- rows, which this guard never matches.

CREATE OR REPLACE FUNCTION public.block_automated_writes_to_waiting_orders()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_role text;
BEGIN
  -- Canonical waiting state only: needs_correction + is_waiting_inventory.
  IF OLD.is_waiting_inventory IS NOT TRUE OR OLD.status <> 'needs_correction' THEN
    RETURN NEW;
  END IF;

  -- NULLIF: an empty-string GUC (no JWT) must not break the jsonb cast.
  v_role := COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');

  IF v_role = 'service_role'
     AND (NEW.items IS DISTINCT FROM OLD.items
          OR NEW.order_number IS DISTINCT FROM OLD.order_number
          OR NEW.combine_meta IS DISTINCT FROM OLD.combine_meta) THEN
    RAISE EXCEPTION
      'Order % is waiting for inventory: automated writes are blocked. Unmark waiting in PickD (or edit it manually) first.',
      OLD.order_number
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.block_automated_writes_to_waiting_orders() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_waiting_write_guard ON public.picking_lists;
CREATE TRIGGER trg_waiting_write_guard
  BEFORE UPDATE ON public.picking_lists
  FOR EACH ROW
  EXECUTE FUNCTION public.block_automated_writes_to_waiting_orders();
