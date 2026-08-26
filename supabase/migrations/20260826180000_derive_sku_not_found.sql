-- ============================================================================
-- picking_lists.items[].sku_not_found is derived, not stored
--
-- Why: the flag was stamped once, at intake, by whoever wrote the item — the
-- watchdog when the PDF's SKU matched nothing in the catalog, the app on a
-- hand-typed add — and nothing ever recomputed it. Registering the SKU from
-- Double Check (long-press → "Bici o Parte" → New Item) created the
-- sku_metadata and inventory rows and left the flag exactly as it was: the
-- card kept its red UNREG badge with the bike now on the shelf, the Live Board
-- and the verification queue kept reading the same stale truth, and a second
-- long-press offered to register the SKU again. The client-side auto-resolve
-- effect that rewrites items heals `location` and `insufficient_stock` and
-- never had a branch for this one (DoubleCheckView, 2026-08-26).
--
-- The flag has exactly one meaning the rest of the pipeline already relies on:
-- "no sku_metadata row has this exact sku". process_picking_list skips such
-- items when deducting, compensate_picking_list_changes skips them when
-- restoring, and the stamp below already joins the catalog by exact string.
-- So that is the truth stamped here — a dashless '010530' next to a catalog
-- '01-0530' stays not-found, on purpose. Spelling is the SKU-identity project
-- (idea-154), not this trigger's job; when that project rewrites items to the
-- canonical spelling, this stamp re-derives on the same write.
--
-- Unlike is_bike and the note `kind`, this is NOT fill-if-null: the value is
-- always overwritten, because it is a fact about the catalog, not an input.
-- A client that says false about a SKU nobody registered is wrong, and a
-- stale true from intake is the bug. One visible consequence: an item added
-- by hand in Edit Order under an unregistered SKU now shows UNREG — it used
-- to carry false and process_picking_list went looking for a row that was
-- not there.
--
-- Two triggers, one rule:
--   1. a_stamp_item_sku_metadata (extended) derives the flag on every write
--      of items — the choke point every producer passes through.
--   2. zz_touch_open_orders_for_sku on sku_metadata re-runs (1) on the open
--      orders that name a SKU the moment it enters the catalog, and realtime
--      carries the result to every open session. Terminal orders are history;
--      their flags stay as they shipped.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.stamp_item_sku_metadata()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- jsonb_typeof before jsonb_array_length: the column is plain jsonb with no
  -- CHECK forcing an array, and jsonb_array_length() raises on a scalar. A
  -- trigger whose only job is to enrich must never be the thing that rejects a
  -- write, so anything that isn't a populated array passes through untouched.
  IF NEW.items IS NULL
     OR jsonb_typeof(NEW.items) <> 'array'
     OR jsonb_array_length(NEW.items) = 0 THEN
    RETURN NEW;
  END IF;

  -- WITH ORDINALITY + ORDER BY: item order is load-bearing. compensate_picking_list_changes
  -- diffs OLD.items vs NEW.items positionally to decide inventory restores, so a reordered
  -- array would read as "every item was replaced" and fire spurious adjustments.
  --
  -- sku_not_found is a top-level item field (the client and the watchdog have
  -- always written it there); is_bike / weight_lbs stay under sku_metadata.
  SELECT COALESCE(jsonb_agg(
           item || jsonb_build_object(
             'sku_not_found', (sm.sku IS NULL),
             'sku_metadata',
             COALESCE(item->'sku_metadata', '{}'::jsonb)
               || jsonb_build_object(
                    'is_bike',    COALESCE(sm.is_bike, false),
                    'weight_lbs', sm.weight_lbs
                  )
           )
           ORDER BY ord
         ), '[]'::jsonb)
    INTO NEW.items
    FROM jsonb_array_elements(NEW.items) WITH ORDINALITY AS t(item, ord)
    LEFT JOIN sku_metadata sm ON sm.sku = item->>'sku';

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.stamp_item_sku_metadata() IS
  'Seals canonical sku_metadata.is_bike / weight_lbs into each picking_lists.items element, and derives sku_not_found = "no sku_metadata row has this exact sku", so every consumer reads the same truth without its own lookup. Always overwrites sku_not_found: it is a fact about the catalog, not an input.';

-- ----------------------------------------------------------------------------
-- When a SKU enters the catalog, re-stamp the open orders that name it.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.touch_open_orders_for_sku()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_list record;
BEGIN
  -- A no-op write of items re-runs a_stamp_item_sku_metadata — one copy of the
  -- rule, nothing to drift — and the UPDATE is what realtime broadcasts to the
  -- session that has the order open. update_picking_list_activity bumps
  -- last_activity_at on the way through; a SKU the order was waiting for just
  -- got registered, which is activity on that order by any reading.
  --
  -- One UPDATE per order, each in its own sub-transaction:
  -- block_automated_writes_to_waiting_orders raises when a service_role caller
  -- touches a waiting order, and enrichment must never reject the write that
  -- triggered it. The SKU still registers, the other orders still heal, and
  -- the blocked one heals on its next human edit.
  FOR v_list IN
    SELECT id, order_number
      FROM public.picking_lists
     WHERE status NOT IN ('completed', 'cancelled')
       AND items @> jsonb_build_array(jsonb_build_object('sku', NEW.sku))
  LOOP
    BEGIN
      UPDATE public.picking_lists SET items = items WHERE id = v_list.id;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'touch_open_orders_for_sku(%): order % not re-stamped: %',
        NEW.sku, v_list.order_number, SQLERRM;
    END;
  END LOOP;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.touch_open_orders_for_sku() IS
  'AFTER INSERT/UPDATE OF sku on sku_metadata: no-op UPDATE of items on every non-terminal picking list naming that SKU, so a_stamp_item_sku_metadata re-derives sku_not_found and realtime tells the open session. Never fails the catalog write.';

-- 'zz' so it runs after tr_sku_metadata_set_is_bike has resolved the row:
-- the stamp reads sm.is_bike / weight_lbs, and those are filled by that
-- BEFORE trigger. (AFTER already guarantees it; the name documents it.)
DROP TRIGGER IF EXISTS zz_touch_open_orders_for_sku ON public.sku_metadata;
CREATE TRIGGER zz_touch_open_orders_for_sku
  AFTER INSERT OR UPDATE OF sku ON public.sku_metadata
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_open_orders_for_sku();

-- ----------------------------------------------------------------------------
-- Backfill: only the open orders whose stored flag disagrees with the catalog
-- (a registered SKU still flagged, or an unregistered one carrying false).
-- Runs through the trigger via a no-op UPDATE, same as the touch above.
-- Waiting orders included on purpose, as the migration role (no JWT) — they
-- are the ones most likely to hold a SKU that has since been registered.
-- ----------------------------------------------------------------------------

UPDATE public.picking_lists p
   SET items = items
 WHERE p.status NOT IN ('completed', 'cancelled')
   AND p.items IS NOT NULL
   AND jsonb_typeof(p.items) = 'array'
   AND jsonb_array_length(p.items) > 0
   AND EXISTS (
         SELECT 1
           FROM jsonb_array_elements(p.items) AS i
           LEFT JOIN public.sku_metadata sm ON sm.sku = i->>'sku'
          WHERE COALESCE((i->>'sku_not_found')::boolean, false) IS DISTINCT FROM (sm.sku IS NULL)
       );
