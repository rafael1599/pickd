-- ============================================================================
-- Stamp canonical sku_metadata onto picking_lists.items
--
-- Why: the FedEx/Regular rule is "5+ BIKES -> truck", and `is_bike` lives in
-- sku_metadata, not on the item. The DB rule (classify_picking_list_fedex)
-- joins sku_metadata and has always been right; the frontend can only read
-- what the item carries. CartItem already declares `sku_metadata.is_bike` and
-- the shared classifier already prefers it over any lookup — the app's own
-- order builder fills it (416/416 items), but the watchdog's pdf_import path
-- never has (9 of ~5.370). Every screen that classified watchdog orders had to
-- fetch its own bike lookup and pass it in; DoubleCheckView didn't, so a
-- 13-bike order rendered as FedEx there while the Board showed it as Regular.
--
-- Rather than thread the lookup through a sixth call site, fill the field at
-- the only choke point every producer passes through: a write to
-- picking_lists.items. Covers the watchdog, the app, SplitOrderModal,
-- generatePickingPath and anything added later, and re-stamps on every write,
-- so an item that loses the field heals on the next save.
--
-- weight_lbs is stamped as data only. The client's ">50 lbs -> regular" rule
-- reads a separate skuWeights map that every call site passes as {}, so this
-- migration does NOT switch that rule on — it just puts the number within
-- reach of a later, deliberate change.
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
  SELECT COALESCE(jsonb_agg(
           item || jsonb_build_object(
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
  'Seals canonical sku_metadata.is_bike / weight_lbs into each picking_lists.items element so every consumer classifies from the same truth without its own lookup. Uncataloged SKUs (sku_not_found) stamp is_bike=false, matching how the frontend already treats an unknown SKU.';

-- Name starts with 'a' so it fires before the other BEFORE-row triggers
-- (Postgres orders them by name) and downstream logic sees stamped items.
-- Ordering is defensive, not required: compensate_picking_list_changes reads
-- only sku/warehouse/location/picked/pickingQty/flags, and
-- log_picking_list_items_shrink compares array lengths — neither notices an
-- added field.
DROP TRIGGER IF EXISTS a_stamp_item_sku_metadata ON public.picking_lists;
CREATE TRIGGER a_stamp_item_sku_metadata
  BEFORE INSERT OR UPDATE OF items ON public.picking_lists
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_item_sku_metadata();

-- Backfill, scoped to orders that are still on screen. Those are the only ones
-- any view classifies live, and the terminal ones are already read through the
-- Board/Ship bike lookups. Keeping history out also keeps this UPDATE from
-- firing update_picking_list_activity across 1.7k rows and rewriting the
-- last_activity_at that "Recently Completed" is ordered by.
--
-- Includes waiting orders on purpose: they live for months, so they are the
-- rows most likely to be read unstamped, and stamping them here (as the
-- migration role, no JWT) avoids block_automated_writes_to_waiting_orders
-- later mistaking a first stamp for an automated edit.
--
-- Runs through the trigger via a no-op UPDATE of items, so there is one copy
-- of the stamping logic and nothing to drift.
UPDATE public.picking_lists
   SET items = items
 WHERE status NOT IN ('completed', 'cancelled')
   AND items IS NOT NULL
   AND jsonb_typeof(items) = 'array'
   AND jsonb_array_length(items) > 0
   AND EXISTS (
         SELECT 1 FROM jsonb_array_elements(items) AS i
          WHERE NOT (i ? 'sku_metadata') OR NOT (i->'sku_metadata' ? 'is_bike')
       );
