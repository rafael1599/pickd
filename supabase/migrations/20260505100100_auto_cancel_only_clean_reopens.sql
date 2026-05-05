-- ============================================================================
-- idea-067 Phase 2 — refine auto_cancel_stale_orders for reopened orders.
--
-- Behavior change:
--   * BEFORE: any 'reopened' order older than 2h was auto-restored to
--     'completed' from snapshot, regardless of whether the user had made
--     edits in the meantime. Risk: silently loses operator work.
--   * AFTER: only auto-restore reopened orders whose `items` field still
--     matches `completed_snapshot` exactly — i.e., the user opened the
--     order, didn't change anything, and got distracted. Reopened orders
--     with pending edits are left alone (no clobbering work).
--
-- Add-On flow side effect: a freshly-opened Add-On still has source.items
-- == completed_snapshot until the operator edits something. If they
-- abandon the Add-On before editing, the cron auto-cancels and dissolves
-- the group (cleanup of group_id on both source and target, plus the
-- order_groups row). Once they edit anything, the cron stops touching it
-- and a human must finish or cancel it.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.auto_cancel_stale_orders()
RETURNS TABLE(id uuid, order_number text, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_stale_reopen RECORD;
  v_group_id     uuid;
BEGIN
  -- 1. 'building' orders inactive > 15 mins (dead code post-idea-032 — kept
  --    for function shape only).
  RETURN QUERY
  WITH cancelled_building AS (
    UPDATE picking_lists pl
       SET status     = 'cancelled',
           updated_at = NOW()
      FROM user_presence up
     WHERE pl.user_id              = up.user_id
       AND pl.status               = 'building'
       AND pl.last_activity_at     < NOW() - INTERVAL '15 minutes'
       AND (up.last_seen_at IS NULL OR up.last_seen_at < NOW() - INTERVAL '2 minutes')
    RETURNING pl.id, pl.order_number, 'cancelled_building'::text AS status
  )
  SELECT * FROM cancelled_building;

  -- 2. REMOVED: verification 24h branch (idea-053 — orders can wait months).

  -- 3. Stuck 'reopened' orders > 2 hours WITHOUT pending edits.
  --    `items::text = completed_snapshot::text` is a conservative bit-for-bit
  --    comparison. If reordering or any other no-op transform becomes a real
  --    flow later, replace with a normalized comparison helper.
  FOR v_stale_reopen IN
    SELECT *
      FROM picking_lists
     WHERE picking_lists.status     = 'reopened'
       AND picking_lists.reopened_at < NOW() - INTERVAL '2 hours'
       AND picking_lists.completed_snapshot IS NOT NULL
       AND picking_lists.items::text = picking_lists.completed_snapshot::text
       FOR UPDATE
  LOOP
    -- Capture group_id before we touch the row, so we can dissolve the
    -- Add-On group cleanly.
    v_group_id := v_stale_reopen.group_id;

    UPDATE picking_lists
       SET items              = COALESCE(completed_snapshot, items),
           status             = 'completed',
           completed_snapshot = NULL,
           reopened_by        = NULL,
           reopened_at        = NULL,
           group_id           = NULL,
           updated_at         = NOW(),
           notes              = COALESCE(notes, '') ||
                                ' [System: Auto-closed clean reopen after 2h timeout]'
     WHERE picking_lists.id = v_stale_reopen.id;

    -- If this was an Add-On (reopened source bound via group_id to a target),
    -- detach the target as well and dissolve the now-empty group row.
    IF v_group_id IS NOT NULL THEN
      UPDATE picking_lists
         SET group_id   = NULL,
             updated_at = NOW()
       WHERE group_id = v_group_id;

      DELETE FROM order_groups WHERE order_groups.id = v_group_id;
    END IF;

    id           := v_stale_reopen.id;
    order_number := v_stale_reopen.order_number;
    status       := 'auto_closed_clean_reopen';
    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$$;

COMMENT ON FUNCTION public.auto_cancel_stale_orders() IS
  'idea-067 Phase 2: only auto-closes reopened orders whose items field matches completed_snapshot (no pending edits). Reopened orders with edits are left to a human. On auto-close, dissolves any Add-On group binding (group_id NULL on siblings + DELETE order_groups row).';
