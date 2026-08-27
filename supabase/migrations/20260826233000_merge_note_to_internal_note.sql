-- ============================================================================
-- bug-018: a stock move's note is not the item's name
--
-- adjust_inventory_quantity took p_merge_note ('auto-restore on cancel',
-- 'Reopen delta #1', 'auto-compensate qty change'…) and wrote it INTO
-- item_name: as the whole name when it created a row, appended with ' | '
-- when it updated one. Every screen that derives a model from item_name
-- (the New Item prefill, the 20260820160000 backfill, the FedEx dimensions
-- export through sku_metadata.model) then carried the note along —
-- 'ALLEGRO A1 23 THUNDER GREY | Auto-cancel verification timeout' was a
-- FedEx record description waiting to happen. The backfill cleaned `model`
-- once; the source kept writing.
--
-- Now: a new row is named after its SKU's other rows (or stays nameless);
-- the note goes to internal_note, once per distinct note; item_name is never
-- touched by a stock move. The callers (compensate_picking_list_changes,
-- reopen/recomplete, revert) are unchanged — they still pass p_merge_note.
-- Then the rows that already carry a note in the name are cleaned, the
-- fragment moved to internal_note where it belonged.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.adjust_inventory_quantity(p_sku text, p_warehouse text, p_location text, p_delta integer, p_performed_by text, p_user_id uuid, p_user_role text DEFAULT 'staff'::text, p_list_id uuid DEFAULT NULL::uuid, p_order_number text DEFAULT NULL::text, p_merge_note text DEFAULT NULL::text, p_skip_log boolean DEFAULT false, p_internal_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_item_id INTEGER;
    v_location_id UUID;
    v_location_name TEXT;
    v_prev_qty INTEGER;
    v_new_qty INTEGER;
    v_actual_delta INTEGER;
    v_snapshot JSONB;
BEGIN
    -- ─── Defensive guard (added in migration 20260410130000) ──────────────
    IF p_location IS NULL OR TRIM(p_location) = '' THEN
        IF p_delta > 0 THEN
            RAISE EXCEPTION 'adjust_inventory_quantity called with NULL/empty location for SKU % and positive delta % — refusing to create phantom inventory. Caller: %, list_id: %, order: %',
                p_sku, p_delta, p_performed_by, p_list_id, p_order_number;
        ELSIF p_delta < 0 THEN
            RAISE WARNING 'adjust_inventory_quantity called with NULL/empty location for SKU % and DEDUCT delta % — proceeding but this likely indicates upstream data quality issue. Caller: %, list_id: %, order: %',
                p_sku, p_delta, p_performed_by, p_list_id, p_order_number;
        END IF;
    END IF;

    v_location_id := public.resolve_location(p_warehouse, p_location, p_user_role);
    SELECT location INTO v_location_name FROM locations WHERE id = v_location_id;

    IF v_location_id IS NOT NULL AND v_location_name IS NULL THEN
        v_location_name := UPPER(TRIM(p_location));
    END IF;

    v_actual_delta := p_delta;

    SELECT id, quantity, row_to_json(inventory.*)::jsonb INTO v_item_id, v_prev_qty, v_snapshot
    FROM inventory
    WHERE sku = p_sku
      AND warehouse = p_warehouse
      AND UPPER(TRIM(COALESCE(location, ''))) = UPPER(TRIM(COALESCE(v_location_name, '')))
    FOR UPDATE;

    IF v_item_id IS NULL THEN
        v_prev_qty := 0;
        IF p_delta < 0 THEN
            v_actual_delta := 0;
            v_new_qty := 0;
        ELSE
            v_new_qty := p_delta;
        END IF;

        -- A new row is named after its SKU's other rows, never after the
        -- note that created it (bug-018: 'auto-restore on cancel' used to
        -- become the item's name and from there the catalog model).
        INSERT INTO inventory (sku, warehouse, location, location_id, quantity, is_active, item_name, internal_note)
        VALUES (p_sku, p_warehouse, v_location_name, v_location_id, v_new_qty, (v_new_qty > 0),
                (SELECT i.item_name FROM inventory i
                  WHERE i.sku = p_sku AND i.item_name IS NOT NULL AND LENGTH(TRIM(i.item_name)) > 0
                  ORDER BY i.quantity DESC NULLS LAST, i.updated_at DESC NULLS LAST
                  LIMIT 1),
                COALESCE(p_internal_note, NULLIF(TRIM(p_merge_note), '')))
        RETURNING id INTO v_item_id;
    ELSE
        v_new_qty := v_prev_qty + p_delta;
        IF v_new_qty < 0 THEN
            v_new_qty := 0;
            v_actual_delta := -v_prev_qty;
        END IF;

        UPDATE inventory SET
            quantity    = v_new_qty,
            location_id = v_location_id,
            location    = v_location_name,
            -- Bidirectional: activate when stock arrives, deactivate when depleted
            is_active   = (v_new_qty > 0),
            updated_at  = NOW(),
            -- The merge note is a note: it goes to internal_note (once per
            -- distinct note), and item_name is never touched by a stock move.
            internal_note = CASE
                WHEN p_internal_note IS NOT NULL THEN p_internal_note
                WHEN p_merge_note IS NOT NULL AND LENGTH(TRIM(p_merge_note)) > 0 THEN
                    CASE
                        WHEN internal_note IS NULL OR LENGTH(TRIM(internal_note)) = 0 THEN p_merge_note
                        WHEN internal_note NOT LIKE '%' || p_merge_note || '%' THEN internal_note || ' | ' || p_merge_note
                        ELSE internal_note
                    END
                ELSE internal_note
            END
        WHERE id = v_item_id;

        -- Adjust distribution when deducting
        IF v_actual_delta < 0 THEN
            PERFORM public.adjust_distribution(v_item_id, (-v_actual_delta));
        END IF;
    END IF;

    IF NOT p_skip_log AND v_actual_delta != 0 THEN
        PERFORM public.upsert_inventory_log(
            p_sku, p_warehouse, v_location_name, p_warehouse, v_location_name,
            v_actual_delta, v_prev_qty, v_new_qty, (CASE WHEN v_actual_delta > 0 THEN 'ADD' ELSE 'DEDUCT' END),
            v_item_id, v_location_id, v_location_id, p_performed_by, p_user_id, p_list_id, p_order_number, v_snapshot
        );
    END IF;

    RETURN (SELECT row_to_json(i)::jsonb FROM inventory i WHERE id = v_item_id);
END;
$function$;

-- Data: strip the known system fragments from item_name / model, keep them
-- as internal notes. The fragments are exactly the p_merge_note values the
-- callers use, so nothing a person typed can match.
DO $$
DECLARE
  v_frag constant text :=
    '(Auto-cancel verification timeout|auto-restore on cancel|auto-restore on order delete|auto-restore: item removed|auto-restore: item replaced|auto-compensate qty change|auto-deduct: new picked item added|auto-deduct: replaced item added picked|Reopen delta #\d+|Reopen new item #\d+|revert of log [0-9a-f-]+)';
  r record;
  v_clean text;
  v_notes text;
  n_inv int := 0;
  n_meta int := 0;
BEGIN
  FOR r IN SELECT id, item_name, internal_note FROM public.inventory WHERE item_name ~ v_frag LOOP
    v_clean := NULLIF(TRIM(regexp_replace(r.item_name, '(\s*\|\s*' || v_frag || ')+\s*$', '', 'g')), '');
    IF v_clean IS NOT NULL AND v_clean ~ v_frag THEN v_clean := NULL; END IF; -- the name WAS the note
    v_notes := TRIM(BOTH ' |' FROM COALESCE(substring(r.item_name from '\|.*$'), r.item_name));
    UPDATE public.inventory
       SET item_name = v_clean,
           internal_note = CASE
             WHEN r.internal_note IS NULL OR LENGTH(TRIM(r.internal_note)) = 0 THEN v_notes
             WHEN r.internal_note LIKE '%' || v_notes || '%' THEN r.internal_note
             ELSE r.internal_note || ' | ' || v_notes END
     WHERE id = r.id;
    n_inv := n_inv + 1;
  END LOOP;
  FOR r IN SELECT sku, model FROM public.sku_metadata WHERE model ~ v_frag LOOP
    v_clean := NULLIF(TRIM(regexp_replace(r.model, '(\s*\|\s*' || v_frag || ')+\s*$', '', 'g')), '');
    IF v_clean IS NOT NULL AND v_clean ~ v_frag THEN v_clean := NULL; END IF;
    UPDATE public.sku_metadata SET model = v_clean WHERE sku = r.sku;
    n_meta := n_meta + 1;
  END LOOP;
  RAISE NOTICE 'bug-018 cleanup: % inventory names, % catalog models', n_inv, n_meta;
END;
$$;
