-- ============================================================================
-- Defensive guard for adjust_inventory_quantity — reject NULL location on ADD
--
-- ## Why
-- bug-017 was caused by auto_cancel_stale_orders calling
-- adjust_inventory_quantity(p_delta = +qty, p_location = NULL) on items
-- pulled from picking_lists.items[].location, which can be NULL when items
-- were added without a location assignment.
--
-- The original adjust_inventory_quantity body handled NULL location silently:
--   - DEDUCT (p_delta < 0): inserts a row with quantity = 0, is_active = false
--     → benign artifact, hidden from active queries
--   - ADD (p_delta > 0): inserts a row with quantity = p_delta, is_active = true
--     → real phantom inventory, visible everywhere → bug-017
--
-- This guard makes the toxic combination explicit by raising an exception
-- when (delta > 0 AND location IS NULL/empty). Any future code that hits
-- this fails loudly instead of inflating inventory.
--
-- ## What this DOES NOT do
-- - Does not block DEDUCT with NULL location (would break process_picking_list
--   for legitimate items in picking lists with missing location). Logs a
--   WARNING so we can audit and fix upstream over time.
-- - Does not change any other behavior of adjust_inventory_quantity.
--
-- ## Faithful copy
-- This migration is a faithful CREATE OR REPLACE of the current prod body
-- (including the adjust_distribution call added in 20260310000001 and the
-- internal_note handling added in 20260325000001). The ONLY change is the
-- guard block at the top.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.adjust_inventory_quantity(
  p_sku text,
  p_warehouse text,
  p_location text,
  p_delta integer,
  p_performed_by text,
  p_user_id uuid,
  p_user_role text DEFAULT 'staff'::text,
  p_list_id uuid DEFAULT NULL::uuid,
  p_order_number text DEFAULT NULL::text,
  p_merge_note text DEFAULT NULL::text,
  p_skip_log boolean DEFAULT false,
  p_internal_note text DEFAULT NULL::text
)
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
    -- Reject the toxic combination (+delta, NULL location). This was the
    -- root cause of bug-017 (phantom inventory from auto_cancel). DEDUCTs
    -- with NULL location are still allowed but warned, pending separate
    -- cleanup of upstream callers.
    IF p_location IS NULL OR TRIM(p_location) = '' THEN
        IF p_delta > 0 THEN
            RAISE EXCEPTION 'adjust_inventory_quantity called with NULL/empty location for SKU % and positive delta % — refusing to create phantom inventory. Caller: %, list_id: %, order: %',
                p_sku, p_delta, p_performed_by, p_list_id, p_order_number;
        ELSIF p_delta < 0 THEN
            RAISE WARNING 'adjust_inventory_quantity called with NULL/empty location for SKU % and DEDUCT delta % — proceeding but this likely indicates upstream data quality issue. Caller: %, list_id: %, order: %',
                p_sku, p_delta, p_performed_by, p_list_id, p_order_number;
        END IF;
    END IF;
    -- ──────────────────────────────────────────────────────────────────────

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

        INSERT INTO inventory (sku, warehouse, location, location_id, quantity, is_active, item_name, internal_note)
        VALUES (p_sku, p_warehouse, v_location_name, v_location_id, v_new_qty, (v_new_qty > 0), p_merge_note, p_internal_note)
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
            is_active   = CASE WHEN v_new_qty > 0 THEN true ELSE is_active END,
            updated_at  = NOW(),
            item_name = CASE
                WHEN p_merge_note IS NOT NULL AND LENGTH(TRIM(p_merge_note)) > 0 THEN
                    CASE
                        WHEN item_name IS NULL OR LENGTH(TRIM(item_name)) = 0 THEN p_merge_note
                        WHEN item_name != p_merge_note AND item_name NOT LIKE '%' || p_merge_note || '%' THEN item_name || ' | ' || p_merge_note
                        ELSE item_name
                    END
                ELSE item_name
            END,
            internal_note = CASE
                WHEN p_internal_note IS NOT NULL THEN p_internal_note
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

COMMENT ON FUNCTION public.adjust_inventory_quantity(
  text, text, text, integer, text, uuid, text, uuid, text, text, boolean, text
) IS
  'Mutates inventory.quantity by p_delta. Refuses to create phantom inventory: throws if (delta > 0 AND location IS NULL). DEDUCT with NULL location proceeds with WARNING. See migration 20260410130000 and bug-017 history.';
