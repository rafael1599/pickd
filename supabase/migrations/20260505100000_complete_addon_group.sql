-- ============================================================================
-- idea-067 Phase 2: complete_addon_group
--
-- Atomic completion of an Add-On reopen flow:
--   1. The source order is in 'reopened' status (originally completed, now
--      reopened via the Add-On UI).
--   2. The target order is open (active, ready_to_double_check, double_checking,
--      or needs_correction) and was bound to the source via group_id by the
--      Add-On UI.
--
-- This RPC re-completes the source (delta inventory via recomplete_picking_list)
-- AND completes the target (normal flow via process_picking_list) in a single
-- transaction. If either fails, both roll back.
--
-- Dissolves the group_id on both rows on success so the orders show up
-- independently again in any list-by-group queries.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.complete_addon_group(
  p_source_id        uuid,
  p_target_id        uuid,
  p_performed_by     text,
  p_user_id          uuid,
  p_source_pallets   integer DEFAULT NULL,
  p_source_units     integer DEFAULT NULL,
  p_target_pallets   integer DEFAULT NULL,
  p_target_units     integer DEFAULT NULL,
  p_user_role        text    DEFAULT 'staff'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_source        RECORD;
  v_target        RECORD;
  v_group_type    text;
BEGIN
  -- Lock both rows in a deterministic order to avoid deadlocks on concurrent
  -- completions of overlapping groups.
  IF p_source_id < p_target_id THEN
    SELECT * INTO v_source FROM picking_lists WHERE id = p_source_id FOR UPDATE;
    SELECT * INTO v_target FROM picking_lists WHERE id = p_target_id FOR UPDATE;
  ELSE
    SELECT * INTO v_target FROM picking_lists WHERE id = p_target_id FOR UPDATE;
    SELECT * INTO v_source FROM picking_lists WHERE id = p_source_id FOR UPDATE;
  END IF;

  IF v_source.id IS NULL THEN
    RAISE EXCEPTION 'Source picking list % not found', p_source_id
      USING ERRCODE = 'P0002';
  END IF;
  IF v_target.id IS NULL THEN
    RAISE EXCEPTION 'Target picking list % not found', p_target_id
      USING ERRCODE = 'P0002';
  END IF;

  -- ── Validate states ──────────────────────────────────────────────────────
  IF v_source.status <> 'reopened' THEN
    RAISE EXCEPTION 'Source order % must be reopened (got %)', p_source_id, v_source.status
      USING ERRCODE = '22023';
  END IF;

  IF v_target.status NOT IN (
    'active', 'ready_to_double_check', 'double_checking', 'needs_correction'
  ) THEN
    RAISE EXCEPTION 'Target order % is not in a completable state (got %)',
      p_target_id, v_target.status
      USING ERRCODE = '22023';
  END IF;

  -- ── Validate group binding ───────────────────────────────────────────────
  IF v_source.group_id IS NULL OR v_target.group_id IS NULL THEN
    RAISE EXCEPTION 'Add-On orders must share a group_id (source.group_id=%, target.group_id=%)',
      v_source.group_id, v_target.group_id
      USING ERRCODE = '22023';
  END IF;

  IF v_source.group_id <> v_target.group_id THEN
    RAISE EXCEPTION 'Add-On group mismatch: source=%, target=%',
      v_source.group_id, v_target.group_id
      USING ERRCODE = '22023';
  END IF;

  SELECT group_type INTO v_group_type
  FROM order_groups
  WHERE id = v_source.group_id;

  -- Only 'general' groups are valid Add-On targets. Refuse to complete
  -- through this RPC for FedEx auto-grouped orders — those have their own
  -- batch-completion path that handles all siblings together.
  IF v_group_type IS DISTINCT FROM 'general' THEN
    RAISE EXCEPTION 'Add-On RPC only handles ''general'' groups (group %, type=%)',
      v_source.group_id, COALESCE(v_group_type, 'NULL')
      USING ERRCODE = '22023';
  END IF;

  -- ── Multi-user guard ─────────────────────────────────────────────────────
  -- If somebody else is verifying the target right now, refuse.
  IF v_target.checked_by IS NOT NULL
     AND v_target.checked_by <> p_user_id THEN
    RAISE EXCEPTION 'Target order % is being verified by another user (%); cannot complete Add-On',
      p_target_id, v_target.checked_by
      USING ERRCODE = '42501';
  END IF;

  -- ── Re-complete the source (applies inventory delta vs snapshot) ────────
  PERFORM public.recomplete_picking_list(
    p_source_id,
    p_performed_by,
    p_user_id,
    p_source_pallets,
    p_source_units,
    p_user_role
  );

  -- ── Complete the target (normal deduction path) ─────────────────────────
  PERFORM public.process_picking_list(
    p_target_id,
    p_performed_by,
    p_user_id,
    p_target_pallets,
    p_target_units,
    p_user_role
  );

  -- ── Dissolve the group (best-effort cleanup) ────────────────────────────
  -- Both orders are now 'completed'; the group has no purpose. NULL out the
  -- pointers and drop the group row. Errors here would only orphan a group
  -- row, never lose order data, so we tolerate them silently.
  UPDATE picking_lists
     SET group_id = NULL,
         updated_at = NOW()
   WHERE id IN (p_source_id, p_target_id);

  DELETE FROM order_groups WHERE id = v_source.group_id;

  -- Log on both sides for traceability.
  INSERT INTO picking_list_notes (list_id, user_id, message)
  VALUES
    (p_source_id, p_user_id,
     '[Add-On] Re-completed and merged with #' ||
     COALESCE(v_target.order_number, p_target_id::text)),
    (p_target_id, p_user_id,
     '[Add-On] Completed via merge into #' ||
     COALESCE(v_source.order_number, p_source_id::text));

  RETURN jsonb_build_object(
    'source_id', p_source_id,
    'target_id', p_target_id,
    'group_id',  v_source.group_id,
    'status',    'completed'
  );
END;
$$;

ALTER FUNCTION public.complete_addon_group(uuid, uuid, text, uuid, integer, integer, integer, integer, text) OWNER TO postgres;

COMMENT ON FUNCTION public.complete_addon_group(uuid, uuid, text, uuid, integer, integer, integer, integer, text) IS
  'idea-067 Phase 2: atomically re-completes a reopened source order (with inventory delta) AND completes its Add-On target order. Validates group binding, refuses on multi-user conflict, dissolves the group on success.';
