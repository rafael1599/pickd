-- Fix: process_picking_list() must reject 'reopened' status.
--
-- Context: process_picking_list() is the "normal completion" path — it deducts
-- inventory once per item in picking_lists.items and transitions status to
-- 'completed'. The function already short-circuits on status='completed' to
-- stay idempotent, but it had no guard against status='reopened'.
--
-- A 'reopened' order has already had its original inventory deduction applied
-- when it was first completed; re-running process_picking_list on it would
-- deduct a second time (double-charge). Re-completion of a reopened order
-- must go through recomplete_picking_list() which computes the delta against
-- completed_snapshot and only applies the difference.
--
-- This is purely defensive hardening. No existing callsite in the app should
-- be invoking process_picking_list on a reopened order; the guard protects
-- against external actors (watchdog-pickd, ad-hoc scripts) and future
-- regressions.

CREATE OR REPLACE FUNCTION "public"."process_picking_list"(
  "p_list_id" "uuid",
  "p_performed_by" "text",
  "p_user_id" "uuid" DEFAULT NULL::"uuid",
  "p_pallets_qty" integer DEFAULT NULL::integer,
  "p_total_units" integer DEFAULT NULL::integer,
  "p_user_role" "text" DEFAULT 'staff'::"text"
) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET search_path = 'public'
    AS $$
DECLARE
  v_list RECORD;
  v_item JSONB;
  v_sku TEXT;
  v_warehouse TEXT;
  v_location TEXT;
  v_qty INTEGER;
  v_order_number TEXT;
  v_sku_not_found BOOLEAN;
BEGIN
  SELECT * INTO v_list FROM picking_lists WHERE id = p_list_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Picking list % not found', p_list_id;
  END IF;

  IF v_list.status = 'completed' THEN
    RETURN TRUE;
  END IF;

  -- Guard: reopened orders must be finalized via recomplete_picking_list()
  -- to apply the inventory delta against completed_snapshot. Running the
  -- normal deduction path here would double-deduct.
  IF v_list.status = 'reopened' THEN
    RAISE EXCEPTION 'Cannot process a reopened picking list (%); use recomplete_picking_list() instead', p_list_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_order_number := v_list.order_number;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_list.items)
  LOOP
    v_sku := v_item->>'sku';
    v_warehouse := v_item->>'warehouse';
    v_location := v_item->>'location';
    v_qty := (v_item->>'pickingQty')::integer;
    v_sku_not_found := (v_item->>'sku_not_found')::boolean;

    IF v_qty IS NULL OR v_qty <= 0 OR v_sku_not_found = true THEN
      CONTINUE;
    END IF;

    PERFORM public.adjust_inventory_quantity(
      v_sku, v_warehouse, v_location, -v_qty,
      p_performed_by, p_user_id, p_user_role, p_list_id, v_order_number,
      NULL -- p_merge_note
    );
  END LOOP;

  UPDATE picking_lists SET
    status = 'completed',
    pallets_qty = COALESCE(p_pallets_qty, pallets_qty),
    total_units = COALESCE(p_total_units, total_units),
    updated_at = NOW(),
    checked_by = p_user_id
  WHERE id = p_list_id;

  RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION "public"."process_picking_list"("uuid", "text", "uuid", integer, integer, "text") IS
  'Normal completion path: deducts inventory and marks picking list completed. Idempotent for completed status. Rejects reopened status (must use recomplete_picking_list). See idea-067.';
