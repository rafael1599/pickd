-- Add LIFO enforcement to undo_inventory_action
-- Prevents undoing an older action if newer non-reversed actions exist for the same item.

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
          SET quantity = GREATEST(0, quantity - v_move_qty)
          WHERE sku = v_log.sku
            AND warehouse = v_log.to_warehouse
            AND UPPER(location) = UPPER(v_log.to_location);
      END IF;

  ELSE
      IF v_log.action_type = 'MOVE' THEN
          v_move_qty := ABS(v_log.quantity_change);

          UPDATE inventory
          SET quantity = quantity + v_move_qty, is_active = true
          WHERE id = v_item_id;

          UPDATE inventory
          SET quantity = GREATEST(0, quantity - v_move_qty)
          WHERE sku = v_log.sku
            AND warehouse = v_log.to_warehouse
            AND UPPER(location) = UPPER(v_log.to_location);
      ELSE
          UPDATE inventory
          SET quantity = quantity - v_log.quantity_change,
              is_active = CASE WHEN (quantity - v_log.quantity_change) > 0 THEN true ELSE is_active END
          WHERE id = v_item_id;
      END IF;
  END IF;

  UPDATE inventory_logs SET is_reversed = TRUE WHERE id = target_log_id;
  RETURN jsonb_build_object('success', true);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$$;
