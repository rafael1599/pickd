-- ============================================================================
-- Orphan sku_metadata rows: name them, stop minting them, delete the noise
--
-- A catalog row with no inventory row behind it is an "orphan". Three ways
-- one gets made, all found on 2026-08-26:
--   * New Item wrote sku_metadata before, and independently of, the inventory
--     insert (fixed in 0bf1ae8: inventory first);
--   * Ship / PartsWeightEditor UPSERTed a default weight under the picking
--     item's sku — for an unregistered SKU that is an INSERT (fixed alongside
--     this migration: UPDATE only);
--   * a rename (EDIT with previous_sku) moves the inventory row to the new
--     name and leaves the old catalog row behind — the FK from qty-0 rows is
--     what keeps sibling names alive (CLAUDE.md, "Hermanos de variante").
--
-- Why it matters now: a_stamp_item_sku_metadata (20260826180000) derives an
-- order's sku_not_found from exactly this table, so an orphan "registers" its
-- SKU for every open order that names it — LOW STOCK instead of UNREG — with
-- nothing on any shelf.
--
-- The rule, in one view (v_sku_metadata_orphans): history lives in
-- inventory_logs / daily_inventory_snapshots / asset_tags / cycle counts /
-- FedEx returns, all denormalized text with no FK to the catalog, so deleting
-- a catalog row never touches history. A row that HAS history stays — it is
-- the catalog's memory of a name that once held stock (Y22B010415 → 01-288,
-- 128338BK → 12-8338BK), and idea-154 merges those on purpose, by hand. A row
-- with none — 82 of 96 today, mostly the watchdog's dashless spelling of a
-- SKU nobody ever put on a shelf, plus TEST-BIKE-001, TSKU1, HDJDB, 'S/D',
-- '03-3709BL ' with a trailing space — is noise and goes. A photo is the one
-- thing on such a row worth keeping: it moves to the canonical sibling when
-- that sibling has none (650009 → 65-0009, 860023BK → 86-0023BK), and a row
-- whose photo has nowhere to go is kept (TEKTR0R-340).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Deleting or renaming a catalog row re-stamps open orders too.
--    20260826180000 only covered INSERT / UPDATE OF sku via NEW.sku; a DELETE
--    left every open order naming that SKU reading "registered" until its
--    next write. NEW is null in a DELETE trigger, so both names are read.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.touch_open_orders_for_sku()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sku  text;
  v_list record;
BEGIN
  -- A no-op write of items re-runs a_stamp_item_sku_metadata — one copy of the
  -- rule, nothing to drift — and the UPDATE is what realtime broadcasts to the
  -- session that has the order open. update_picking_list_activity bumps
  -- last_activity_at on the way through; a SKU the order was waiting for just
  -- changed in the catalog, which is activity on that order by any reading.
  --
  -- One UPDATE per order, each in its own sub-transaction:
  -- block_automated_writes_to_waiting_orders raises when a service_role caller
  -- touches a waiting order, and enrichment must never reject the write that
  -- triggered it. The catalog write still lands, the other orders still heal,
  -- and the blocked one heals on its next human edit.
  --
  -- A rename (UPDATE OF sku) touches both names: orders naming the old one
  -- become not-found, orders naming the new one become found.
  FOR v_sku IN
    SELECT DISTINCT s FROM unnest(ARRAY[OLD.sku, NEW.sku]) AS s WHERE s IS NOT NULL
  LOOP
    FOR v_list IN
      SELECT id, order_number
        FROM public.picking_lists
       WHERE status NOT IN ('completed', 'cancelled')
         AND items @> jsonb_build_array(jsonb_build_object('sku', v_sku))
    LOOP
      BEGIN
        UPDATE public.picking_lists SET items = items WHERE id = v_list.id;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'touch_open_orders_for_sku(%): order % not re-stamped: %',
          v_sku, v_list.order_number, SQLERRM;
      END;
    END LOOP;
  END LOOP;

  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION public.touch_open_orders_for_sku() IS
  'AFTER INSERT/DELETE/UPDATE OF sku on sku_metadata: no-op UPDATE of items on every non-terminal picking list naming that SKU (both names on a rename), so a_stamp_item_sku_metadata re-derives sku_not_found and realtime tells the open session. Never fails the catalog write.';

DROP TRIGGER IF EXISTS zz_touch_open_orders_for_sku ON public.sku_metadata;
CREATE TRIGGER zz_touch_open_orders_for_sku
  AFTER INSERT OR DELETE OR UPDATE OF sku ON public.sku_metadata
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_open_orders_for_sku();

-- ----------------------------------------------------------------------------
-- 2. The rule as a view, so "how many orphans do we have" is one SELECT and
--    the delete below has exactly one definition to point at.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.v_sku_metadata_orphans AS
SELECT
  m.sku,
  m.created_at,
  m.is_bike,
  m.image_url IS NOT NULL AS has_image,
  (   EXISTS (SELECT 1 FROM public.inventory_logs l
               WHERE l.sku = m.sku OR l.previous_sku = m.sku)
   OR EXISTS (SELECT 1 FROM public.daily_inventory_snapshots s WHERE s.sku = m.sku)
   OR EXISTS (SELECT 1 FROM public.asset_tags a          WHERE a.sku = m.sku)
   OR EXISTS (SELECT 1 FROM public.cycle_count_items c   WHERE c.sku = m.sku)
   OR EXISTS (SELECT 1 FROM public.fedex_return_items f  WHERE f.sku = m.sku)
   OR EXISTS (SELECT 1 FROM public.warehouse_excluded_skus w WHERE w.sku = m.sku)
  ) AS has_history,
  EXISTS (SELECT 1
            FROM public.picking_lists p
           WHERE p.status NOT IN ('completed', 'cancelled')
             AND p.items @> jsonb_build_array(jsonb_build_object('sku', m.sku))
  ) AS in_open_order
FROM public.sku_metadata m
WHERE NOT EXISTS (SELECT 1 FROM public.inventory i WHERE i.sku = m.sku);

GRANT SELECT ON public.v_sku_metadata_orphans
  TO authenticated, service_role;

COMMENT ON VIEW public.v_sku_metadata_orphans IS
  'Catalog rows with no inventory row. has_history = something (logs, snapshots, tags, counts, returns, exclusions) still names the SKU — keep; in_open_order = an open picking list names it; has_image = a photo that must move or stay. A row with none of the three is noise. Expected to hover near zero now that New Item writes inventory first and weight edits no longer INSERT.';

-- ----------------------------------------------------------------------------
-- 3. Data: move the photo to the canonical sibling when it has none, then
--    delete every orphan with no history, no open order and no photo.
--    Rule-based, not a list, so re-running is safe and staging gets the same
--    treatment. Sibling = same normalized key ('650009' ~ '65-0009'); only
--    when exactly one sibling exists, so an ambiguous key moves nothing.
-- ----------------------------------------------------------------------------

DO $$
DECLARE
  v_moved   int;
  v_deleted int;
BEGIN
  WITH orphan AS (
    SELECT o.sku, m.image_url,
           regexp_replace(upper(o.sku), '[^A-Z0-9]', '', 'g') AS k
      FROM public.v_sku_metadata_orphans o
      JOIN public.sku_metadata m ON m.sku = o.sku
     WHERE o.has_image AND NOT o.has_history AND NOT o.in_open_order
  ),
  target AS (
    SELECT orphan.sku AS orphan_sku, orphan.image_url,
           (array_agg(m.sku))[1] AS sibling_sku
      FROM orphan
      JOIN public.sku_metadata m
        ON m.sku <> orphan.sku
       AND regexp_replace(upper(m.sku), '[^A-Z0-9]', '', 'g') = orphan.k
       AND m.image_url IS NULL
       AND EXISTS (SELECT 1 FROM public.inventory i WHERE i.sku = m.sku)
     GROUP BY orphan.sku, orphan.image_url
    HAVING count(*) = 1
  ),
  moved AS (
    UPDATE public.sku_metadata m
       SET image_url = t.image_url
      FROM target t
     WHERE m.sku = t.sibling_sku
    RETURNING t.orphan_sku
  ),
  cleared AS (
    UPDATE public.sku_metadata m
       SET image_url = NULL
      FROM moved
     WHERE m.sku = moved.orphan_sku
    RETURNING m.sku
  )
  SELECT count(*) INTO v_moved FROM cleared;

  DELETE FROM public.sku_metadata m
   WHERE m.sku IN (
           SELECT sku FROM public.v_sku_metadata_orphans
            WHERE NOT has_history AND NOT in_open_order AND NOT has_image
         );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RAISE NOTICE 'orphan sku_metadata: % photo(s) moved to the canonical sibling, % row(s) deleted', v_moved, v_deleted;
END;
$$;
