-- ============================================================================
-- Migration: Consolidate qty=0 + is_active=true → is_active=false
--
-- Context: inventory rows with quantity=0 and is_active=true are "zombies"
-- that add noise. All frontend queries already filter by BOTH conditions.
-- This migration:
--   1. Deduplicates 4 PALLETIZED rows (same SKU+location, both qty=0 active)
--   2. Sets is_active=false on all qty=0 active rows
--   3. Fixes adjust_inventory_quantity to maintain the invariant
--   4. Fixes undo_inventory_action legacy paths
--
-- EXCEPTION: register_new_sku intentionally creates qty=0 + is_active=true
-- placeholders for new bike onboarding. That RPC is NOT modified here.
-- ============================================================================

-- ── Step 1: Deduplicate PALLETIZED rows ────────────────────────────────────
-- 4 SKUs have 2 identical active rows each (qty=0). Keep the older one.
DELETE FROM inventory a
USING inventory b
WHERE a.sku = b.sku
  AND a.location = b.location
  AND a.quantity = 0 AND b.quantity = 0
  AND a.is_active = true AND b.is_active = true
  AND a.id > b.id;

-- ── Step 2: Consolidate all qty=0 active → inactive ───────────────────────
UPDATE inventory
SET is_active = false, updated_at = now()
WHERE quantity = 0 AND is_active = true;

-- ── Step 3: Fix adjust_inventory_quantity ──────────────────────────────────
-- Change the one-way latch (only reactivates) to a bidirectional toggle:
--   qty > 0 → is_active = true
--   qty = 0 → is_active = false
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
            -- Bidirectional: activate when stock arrives, deactivate when depleted
            is_active   = (v_new_qty > 0),
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

-- ── Step 4: Fix undo_inventory_action legacy paths ────────────────────────
-- Two legacy paths (no snapshot) had the same one-way latch. Fix them
-- to deactivate when qty reaches 0.
-- The snapshot path is fine — it restores is_active from the snapshot.
CREATE OR REPLACE FUNCTION public.undo_inventory_action(target_log_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_log inventory_logs%ROWTYPE;
  v_item_id BIGINT;
  v_move_qty INT;
  v_note TEXT;
  v_newer_exists BOOLEAN;
BEGIN
  SELECT * INTO v_log FROM inventory_logs WHERE id = target_log_id FOR UPDATE;

  IF v_log IS NULL THEN RETURN jsonb_build_object('success', false, 'message', 'Log not found'); END IF;
  IF v_log.is_reversed THEN RETURN jsonb_build_object('success', false, 'message', 'Action already reversed'); END IF;

  v_item_id := COALESCE(
      v_log.item_id,
      (v_log.snapshot_before->>'id')::bigint,
      (v_log.snapshot_before->>'ID')::bigint
  );

  IF v_item_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'message', 'Could not identify ID to reverse');
  END IF;

  -- LIFO check: block if newer non-reversed actions exist for the same item
  SELECT EXISTS (
      SELECT 1 FROM inventory_logs
      WHERE item_id = v_item_id
        AND id != target_log_id
        AND is_reversed = false
        AND created_at > v_log.created_at
  ) INTO v_newer_exists;

  IF v_newer_exists THEN
      RETURN jsonb_build_object('success', false, 'message', 'LIFO Violation: newer actions exist for this item. Undo the most recent action first.');
  END IF;

  -- Snapshots viejos guardaron 'sku_note', los nuevos guardan 'item_name'
  v_note := COALESCE(
      v_log.snapshot_before->>'item_name',
      v_log.snapshot_before->>'sku_note'
  );

  IF v_log.snapshot_before IS NOT NULL THEN
      UPDATE inventory SET
          sku         = COALESCE(v_log.snapshot_before->>'sku', v_log.sku),
          quantity    = (v_log.snapshot_before->>'quantity')::int,
          location    = (v_log.snapshot_before->>'location'),
          location_id = NULLIF(v_log.snapshot_before->>'location_id', '')::uuid,
          warehouse   = (v_log.snapshot_before->>'warehouse'),
          item_name   = v_note,
          internal_note = v_log.snapshot_before->>'internal_note',
          is_active   = COALESCE((v_log.snapshot_before->>'is_active')::boolean, TRUE),
          distribution = CASE
              WHEN v_log.snapshot_before ? 'distribution'
              THEN (v_log.snapshot_before->'distribution')
              ELSE distribution
          END
      WHERE id = v_item_id;

      IF NOT FOUND THEN
          INSERT INTO inventory (id, sku, quantity, location, location_id, warehouse, is_active, item_name, internal_note, distribution)
          VALUES (
              v_item_id,
              COALESCE(v_log.snapshot_before->>'sku', v_log.sku),
              (v_log.snapshot_before->>'quantity')::int,
              v_log.snapshot_before->>'location',
              NULLIF(v_log.snapshot_before->>'location_id', '')::uuid,
              v_log.snapshot_before->>'warehouse',
              COALESCE((v_log.snapshot_before->>'is_active')::boolean, TRUE),
              v_note,
              v_log.snapshot_before->>'internal_note',
              CASE
                  WHEN v_log.snapshot_before ? 'distribution'
                  THEN (v_log.snapshot_before->'distribution')
                  ELSE '[]'::jsonb
              END
          );
      END IF;

      IF v_log.action_type = 'MOVE' THEN
          v_move_qty := ABS(v_log.quantity_change);
          UPDATE inventory
          SET quantity = GREATEST(0, quantity - v_move_qty),
              -- Deactivate destination if it becomes empty after undo
              is_active = (GREATEST(0, quantity - v_move_qty) > 0)
          WHERE sku = v_log.sku
            AND warehouse = v_log.to_warehouse
            AND UPPER(location) = UPPER(v_log.to_location);
      END IF;

  ELSE
      -- ── Legacy path (no snapshot) ──────────────────────────────────────
      IF v_log.action_type = 'MOVE' THEN
          v_move_qty := ABS(v_log.quantity_change);

          -- Restore source: always reactivate (we're adding stock back)
          UPDATE inventory
          SET quantity = quantity + v_move_qty, is_active = true
          WHERE id = v_item_id;

          -- Deduct destination: deactivate if it becomes empty
          UPDATE inventory
          SET quantity = GREATEST(0, quantity - v_move_qty),
              is_active = (GREATEST(0, quantity - v_move_qty) > 0)
          WHERE sku = v_log.sku
            AND warehouse = v_log.to_warehouse
            AND UPPER(location) = UPPER(v_log.to_location);
      ELSE
          UPDATE inventory
          SET quantity = quantity - v_log.quantity_change,
              -- Bidirectional: deactivate if result is 0
              is_active = ((quantity - v_log.quantity_change) > 0)
          WHERE id = v_item_id;
      END IF;
  END IF;

  UPDATE inventory_logs SET is_reversed = TRUE WHERE id = target_log_id;
  RETURN jsonb_build_object('success', true);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$$;
