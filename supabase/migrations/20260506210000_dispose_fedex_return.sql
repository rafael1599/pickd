-- Dispose flow for FedEx Returns.
--
-- The "Dispose" button on FedExReturnDetailScreen marks an entire return as
-- trashed: items are flagged moved_to=DISPOSED, the placeholder ghost stock
-- at LUDLOW.FDX is drained to 0/inactive (no inventory ends up created),
-- and the return flips to status='resolved'. One DEDUCT log per drained
-- placeholder, with note='Disposed (FedEx Return <tracking>)' so History
-- reflects what happened.
--
-- Idempotent: re-running on an already-disposed return is a no-op.

CREATE OR REPLACE FUNCTION public.dispose_fedex_return(
  p_return_id uuid,
  p_user_id uuid,
  p_performed_by text DEFAULT 'FedEx Returns',
  p_dispose_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_return RECORD;
  v_item RECORD;
  v_inv RECORD;
  v_from_loc_id uuid;
  v_disposed_count integer := 0;
  v_drained_count integer := 0;
  v_note text;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'sign-in required' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_return FROM public.fedex_returns WHERE id = p_return_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'fedex_returns % not found', p_return_id USING ERRCODE='22023';
  END IF;

  v_note := 'Disposed (FedEx Return ' || v_return.tracking_number || ')'
    || CASE WHEN p_dispose_reason IS NOT NULL AND TRIM(p_dispose_reason) <> ''
            THEN ' — ' || TRIM(p_dispose_reason)
            ELSE '' END;

  -- Per pending item: flag as disposed. For placeholders (sku=tracking),
  -- also drain the ghost inventory at LUDLOW.FDX (any FDX-prefixed location).
  FOR v_item IN
    SELECT * FROM public.fedex_return_items
    WHERE return_id = p_return_id AND moved_to_location IS NULL
    FOR UPDATE
  LOOP
    -- Drain ghost inventory if this is still a placeholder.
    IF v_item.sku = v_return.tracking_number THEN
      FOR v_inv IN
        SELECT * FROM public.inventory
        WHERE sku = v_item.sku
          AND warehouse = 'LUDLOW'
          AND location LIKE 'FDX%'
          AND is_active = TRUE
        FOR UPDATE
      LOOP
        v_from_loc_id := v_inv.location_id;

        PERFORM public.upsert_inventory_log(
          v_item.sku::TEXT,
          'LUDLOW'::TEXT, v_inv.location::TEXT,
          'LUDLOW'::TEXT, 'DISPOSED'::TEXT,
          (-v_inv.quantity)::INTEGER, v_inv.quantity::INTEGER, 0::INTEGER,
          'DEDUCT'::TEXT,
          v_inv.id::BIGINT, v_from_loc_id::UUID, NULL::UUID,
          p_performed_by::TEXT, p_user_id::UUID,
          NULL::UUID, NULL::TEXT, NULL::JSONB, false,
          v_note,
          NULL
        );

        UPDATE public.inventory
        SET quantity = 0,
            is_active = FALSE,
            item_name = CASE
              WHEN COALESCE(item_name, '') NOT LIKE '[disposed]%'
                THEN '[disposed] ' || COALESCE(item_name, '')
              ELSE item_name
            END
        WHERE id = v_inv.id;

        v_drained_count := v_drained_count + 1;
      END LOOP;
    END IF;

    UPDATE public.fedex_return_items
    SET moved_to_location = 'DISPOSED',
        moved_to_warehouse = 'DISPOSED',
        target_location = COALESCE(target_location, 'DISPOSED'),
        target_warehouse = COALESCE(target_warehouse, 'DISPOSED'),
        moved_at = now()
    WHERE id = v_item.id;

    v_disposed_count := v_disposed_count + 1;
  END LOOP;

  -- Resolve the return regardless of whether items remained (idempotent).
  IF v_return.status <> 'resolved' THEN
    UPDATE public.fedex_returns
    SET status = 'resolved',
        resolved_at = now(),
        updated_at = now(),
        notes = TRIM(BOTH E'\n' FROM (COALESCE(notes, '') || E'\n' || v_note))
    WHERE id = p_return_id;
  END IF;

  RETURN jsonb_build_object(
    'return_id', p_return_id,
    'tracking', v_return.tracking_number,
    'disposed_items', v_disposed_count,
    'drained_inventory_rows', v_drained_count
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.dispose_fedex_return(uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dispose_fedex_return(uuid, uuid, text, text) TO service_role;
