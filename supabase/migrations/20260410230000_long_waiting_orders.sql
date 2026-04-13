-- ============================================================================
-- idea-053: Long-Waiting Orders
--
-- ## Contexto
-- Las órdenes pueden esperar inventario por días, semanas, o meses (caso real:
-- una orden esperando una bici que no llega del proveedor). El timeout 24h de
-- auto_cancel_stale_orders rama verification asume que cualquier orden vieja
-- está abandonada — esa premisa es falsa y fue parte del bug-017.
--
-- ## Diseño
--   1. Flag boolean is_waiting_inventory en picking_lists (additive, default false)
--   2. Las waiting orders viven en needs_correction con el flag = true
--   3. El cómputo de "reservado" client-side YA itera needs_correction
--      (usePickingActions.ts:187-213 y watchdog _to_cart_items), así que las
--      waiting orders son respetadas automáticamente sin tocar nada más
--   4. UI de verification queue las oculta por defecto, con toggle "show waiting"
--   5. Solo admins (is_admin()) pueden marcar/desmarcar/take-over waiting
--   6. Se elimina la rama verification 24h de auto_cancel_stale_orders (no tiene
--      trigger automático, así que es zero-risk — el cron nunca corre)
--
-- ## RPCs nuevas
--   - mark_picking_list_waiting(list, reason)            — admin
--   - unmark_picking_list_waiting(list, action)          — admin (resume|cancel)
--   - take_over_sku_from_waiting(waiting, target, sku, qty) — admin
--
-- ## Cambios en función existente
--   - auto_cancel_stale_orders: branch verification 24h ELIMINADA
--     (quedan: building 15min [dead code de idea-032], reopened 2h)
--
-- Plan formal: ~/.claude/plans/long-waiting-orders.md
-- Backlog: idea-053
-- ============================================================================

-- ─── 1. Schema additions ────────────────────────────────────────────────────

ALTER TABLE public.picking_lists
  ADD COLUMN IF NOT EXISTS is_waiting_inventory boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS waiting_since timestamp with time zone NULL,
  ADD COLUMN IF NOT EXISTS waiting_reason text NULL;

CREATE INDEX IF NOT EXISTS picking_lists_waiting_idx
  ON public.picking_lists (is_waiting_inventory)
  WHERE is_waiting_inventory = TRUE;

COMMENT ON COLUMN public.picking_lists.is_waiting_inventory IS
  'idea-053: when true, the order is waiting for inventory and lives in needs_correction. Set/cleared by mark/unmark_picking_list_waiting RPCs (admin only). Hidden from default verification queue view; visible via toggle.';
COMMENT ON COLUMN public.picking_lists.waiting_since IS
  'idea-053: timestamp when the order was first marked as waiting for inventory. Preserved across re-marks.';
COMMENT ON COLUMN public.picking_lists.waiting_reason IS
  'idea-053: free-text reason from ReasonPicker (e.g. "Bike not yet received", "Backorder from vendor").';


-- ─── 2. RPC: mark_picking_list_waiting ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.mark_picking_list_waiting(
  p_list_id uuid,
  p_reason text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller_id uuid := public.current_user_id();
  v_existing record;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can mark orders as waiting for inventory'
      USING ERRCODE = '42501';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'waiting_reason is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT id, status, is_waiting_inventory
    INTO v_existing
    FROM public.picking_lists
   WHERE id = p_list_id
     FOR UPDATE;

  IF v_existing.id IS NULL THEN
    RAISE EXCEPTION 'picking_list not found: %', p_list_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_existing.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'cannot mark a % order as waiting', v_existing.status
      USING ERRCODE = '22023';
  END IF;

  -- Update the list. Preserve waiting_since on re-mark (only set on first transition).
  UPDATE public.picking_lists
     SET is_waiting_inventory = TRUE,
         waiting_since        = COALESCE(waiting_since, NOW()),
         waiting_reason       = p_reason,
         status               = CASE
                                  WHEN status = 'reopened' THEN status
                                  ELSE 'needs_correction'
                                END,
         updated_at           = NOW()
   WHERE id = p_list_id;

  INSERT INTO public.picking_list_notes (list_id, user_id, message)
  VALUES (p_list_id, v_caller_id, '[Waiting]: ' || p_reason);
END;
$$;

ALTER FUNCTION public.mark_picking_list_waiting(uuid, text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.mark_picking_list_waiting(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_picking_list_waiting(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.mark_picking_list_waiting(uuid, text) IS
  'idea-053: Mark a picking_list as waiting for inventory. Admin-only. Transitions status to needs_correction unless already in reopened. Preserves waiting_since across re-marks.';


-- ─── 3. RPC: unmark_picking_list_waiting ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.unmark_picking_list_waiting(
  p_list_id uuid,
  p_action  text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller_id uuid := public.current_user_id();
  v_new_status text;
  v_message text;
  v_updated int;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can unmark waiting orders'
      USING ERRCODE = '42501';
  END IF;

  IF p_action NOT IN ('resume', 'cancel') THEN
    RAISE EXCEPTION 'p_action must be ''resume'' or ''cancel'', got: %', p_action
      USING ERRCODE = '22023';
  END IF;

  v_new_status := CASE WHEN p_action = 'resume' THEN 'ready_to_double_check' ELSE 'cancelled' END;
  v_message    := CASE WHEN p_action = 'resume' THEN '[Resumed from waiting]' ELSE '[Cancelled from waiting]' END;

  UPDATE public.picking_lists
     SET is_waiting_inventory = FALSE,
         waiting_since        = NULL,
         waiting_reason       = NULL,
         status               = v_new_status,
         updated_at           = NOW()
   WHERE id = p_list_id
     AND is_waiting_inventory = TRUE;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RAISE EXCEPTION 'picking_list not found or not in waiting state: %', p_list_id
      USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.picking_list_notes (list_id, user_id, message)
  VALUES (p_list_id, v_caller_id, v_message);
END;
$$;

ALTER FUNCTION public.unmark_picking_list_waiting(uuid, text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.unmark_picking_list_waiting(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unmark_picking_list_waiting(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.unmark_picking_list_waiting(uuid, text) IS
  'idea-053: Resume (back to ready_to_double_check) or cancel a waiting picking_list. Admin-only. Defensive: only acts on rows that are actually waiting.';


-- ─── 4. RPC: take_over_sku_from_waiting ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.take_over_sku_from_waiting(
  p_waiting_list_id uuid,
  p_target_list_id  uuid,
  p_sku             text,
  p_qty             integer
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller_id            uuid := public.current_user_id();
  v_waiting_items        jsonb;
  v_waiting_order_number text;
  v_target_order_number  text;
  v_item_idx             int;
  v_item                 jsonb;
  v_current_qty          int;
  v_new_items            jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can take over SKUs from waiting orders'
      USING ERRCODE = '42501';
  END IF;

  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'p_qty must be a positive integer, got: %', p_qty
      USING ERRCODE = '22023';
  END IF;

  IF p_waiting_list_id = p_target_list_id THEN
    RAISE EXCEPTION 'cannot take over a SKU from a list onto itself'
      USING ERRCODE = '22023';
  END IF;

  -- Lock the waiting row
  SELECT items, order_number
    INTO v_waiting_items, v_waiting_order_number
    FROM public.picking_lists
   WHERE id = p_waiting_list_id
     AND is_waiting_inventory = TRUE
     FOR UPDATE;

  IF v_waiting_order_number IS NULL THEN
    RAISE EXCEPTION 'waiting picking_list not found or not in waiting state: %', p_waiting_list_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Confirm target exists (not locking — we don't modify it, just append a note)
  SELECT order_number
    INTO v_target_order_number
    FROM public.picking_lists
   WHERE id = p_target_list_id;

  IF v_target_order_number IS NULL THEN
    RAISE EXCEPTION 'target picking_list not found: %', p_target_list_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Find the first item in items[] whose sku matches.
  -- WITH ORDINALITY is 1-based; jsonb arrays are 0-indexed for jsonb_set/`-`.
  SELECT (ord - 1)::int, elem
    INTO v_item_idx, v_item
    FROM jsonb_array_elements(COALESCE(v_waiting_items, '[]'::jsonb)) WITH ORDINALITY AS arr(elem, ord)
   WHERE elem->>'sku' = p_sku
   LIMIT 1;

  IF v_item IS NULL THEN
    RAISE EXCEPTION 'sku % not found in waiting list %', p_sku, p_waiting_list_id
      USING ERRCODE = 'P0002';
  END IF;

  v_current_qty := COALESCE((v_item->>'pickingQty')::int, 0);

  IF v_current_qty < p_qty THEN
    RAISE EXCEPTION 'cannot take over % units of % — only % available in waiting list',
                    p_qty, p_sku, v_current_qty
      USING ERRCODE = '22023';
  END IF;

  -- Mutate items[]: if remaining qty is 0, drop the element; else decrement pickingQty.
  IF v_current_qty - p_qty = 0 THEN
    v_new_items := v_waiting_items - v_item_idx;
  ELSE
    v_new_items := jsonb_set(
      v_waiting_items,
      ARRAY[v_item_idx::text, 'pickingQty'],
      to_jsonb(v_current_qty - p_qty)
    );
  END IF;

  UPDATE public.picking_lists
     SET items      = v_new_items,
         updated_at = NOW()
   WHERE id = p_waiting_list_id;

  -- Audit notes on both sides
  INSERT INTO public.picking_list_notes (list_id, user_id, message)
  VALUES (
    p_waiting_list_id,
    v_caller_id,
    '[Item ' || p_sku || ' qty ' || p_qty || ' taken over by order ' || v_target_order_number || ']'
  );

  INSERT INTO public.picking_list_notes (list_id, user_id, message)
  VALUES (
    p_target_list_id,
    v_caller_id,
    '[Took over ' || p_sku || ' qty ' || p_qty || ' from waiting order ' || v_waiting_order_number || ']'
  );
END;
$$;

ALTER FUNCTION public.take_over_sku_from_waiting(uuid, uuid, text, integer) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.take_over_sku_from_waiting(uuid, uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.take_over_sku_from_waiting(uuid, uuid, text, integer) TO authenticated;

COMMENT ON FUNCTION public.take_over_sku_from_waiting(uuid, uuid, text, integer) IS
  'idea-053: Move N units of a SKU from a waiting picking_list to another list. Admin-only. Removes the item entirely if qty drops to 0. Leaves the waiting flag intact even if list ends up empty — admin decides what to do next.';


-- ─── 5. Modify auto_cancel_stale_orders ─────────────────────────────────────
-- Eliminamos completamente la rama verification 24h. Era conceptualmente
-- equivocada (las órdenes pueden esperar inventario meses) y, de cualquier
-- forma, no tiene trigger automático — esto es código durmiente que estaba
-- esperando hacer daño si alguien lo activaba.
--
-- Las dos ramas que quedan también son código durmiente, pero al menos no
-- están equivocadas conceptualmente:
--   - building 15min: dead code post-idea-032 (status `building` eliminado).
--     Se mantiene solo para no romper la firma — borrarlo es scope de otra idea.
--   - reopened 2h: válido conceptualmente pero también sin trigger.

CREATE OR REPLACE FUNCTION public.auto_cancel_stale_orders()
RETURNS TABLE(id uuid, order_number text, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_stale_reopen RECORD;
BEGIN
  -- 1. 'building' orders inactive > 15 mins (dead code post-idea-032)
  --    Status `building` was eliminated; this branch never matches anything
  --    in practice. Kept to preserve the function shape. No inventory touch.
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

  -- 2. REMOVED: verification 24h branch
  --    Reason: orders can legitimately wait months for inventory. Use
  --    mark_picking_list_waiting() (idea-053) instead. The old branch was
  --    the conceptual root cause behind bug-017 (phantom inventory when it
  --    used to call adjust_inventory_quantity with positive delta).

  -- 3. Stuck 'reopened' orders > 2 hours
  --    Restore items from completed_snapshot and return to 'completed'.
  --    No inventory touch (snapshot-based).
  FOR v_stale_reopen IN
    SELECT * FROM picking_lists
     WHERE picking_lists.status = 'reopened'
       AND reopened_at < NOW() - INTERVAL '2 hours'
       FOR UPDATE
  LOOP
    UPDATE picking_lists
       SET items              = COALESCE(completed_snapshot, items),
           status             = 'completed',
           completed_snapshot = NULL,
           reopened_by        = NULL,
           reopened_at        = NULL,
           updated_at         = NOW(),
           notes              = COALESCE(notes, '') || ' [System: Auto-closed reopen after 2h timeout]'
     WHERE picking_lists.id = v_stale_reopen.id;

    id           := v_stale_reopen.id;
    order_number := v_stale_reopen.order_number;
    status       := 'cancelled_reopen_timeout';
    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$$;

COMMENT ON FUNCTION public.auto_cancel_stale_orders() IS
  'idea-053: removed verification 24h branch — orders can wait months for inventory; use mark_picking_list_waiting() instead. Building 15min branch is dead code post-idea-032. Reopened 2h branch unchanged. This function still has NO automatic trigger.';


-- ─── 6. Smoke tests (transactional, rolled back at the end) ─────────────────
-- Estos tests verifican el contrato de las RPCs creando datos efímeros y
-- haciendo rollback al final. Si falla cualquier ASSERT, la migración entera
-- se aborta.

DO $smoke$
DECLARE
  v_admin_user_id   uuid;
  v_staff_user_id   uuid;
  v_waiting_list    uuid;
  v_target_list     uuid;
  v_qty_after       int;
  v_status_after    text;
  v_flag_after      boolean;
  v_caught          boolean;
BEGIN
  -- Pick an existing admin and staff for the test (read-only on profiles).
  -- If none exist (fresh DB), skip the smoke tests entirely.
  SELECT id INTO v_admin_user_id FROM public.profiles WHERE role = 'admin' LIMIT 1;
  SELECT id INTO v_staff_user_id FROM public.profiles WHERE role = 'staff' LIMIT 1;

  IF v_admin_user_id IS NULL THEN
    RAISE NOTICE 'idea-053 smoke tests: no admin user in profiles, skipping';
    RETURN;
  END IF;

  -- Build a fake JWT context that current_user_id() will read. This is the
  -- same trick used by the rest of the codebase to test SECURITY DEFINER
  -- RPCs with a synthetic caller.
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_admin_user_id::text)::text,
    true
  );

  -- Create the waiting list with one item: SKU TEST-WAIT-A qty 5
  INSERT INTO public.picking_lists (id, user_id, items, status, order_number, source)
  VALUES (
    gen_random_uuid(),
    v_admin_user_id,
    '[{"sku":"TEST-WAIT-A","pickingQty":5,"warehouse":"LUDLOW","location":"ROW 99"}]'::jsonb,
    'ready_to_double_check',
    'TEST-IDEA053-WAIT',
    'manual'
  )
  RETURNING id INTO v_waiting_list;

  INSERT INTO public.picking_lists (id, user_id, items, status, order_number, source)
  VALUES (
    gen_random_uuid(),
    v_admin_user_id,
    '[{"sku":"TEST-WAIT-A","pickingQty":2,"warehouse":"LUDLOW","location":"ROW 99"}]'::jsonb,
    'double_checking',
    'TEST-IDEA053-TARGET',
    'manual'
  )
  RETURNING id INTO v_target_list;

  -- T1: mark_picking_list_waiting
  PERFORM public.mark_picking_list_waiting(v_waiting_list, 'Bike not yet received');
  SELECT is_waiting_inventory, status INTO v_flag_after, v_status_after
    FROM public.picking_lists WHERE id = v_waiting_list;
  ASSERT v_flag_after  = TRUE,                     'T1.flag failed: %',   v_flag_after;
  ASSERT v_status_after = 'needs_correction',      'T1.status failed: %', v_status_after;

  -- T2: take_over_sku_from_waiting (partial — 2 of 5 units)
  PERFORM public.take_over_sku_from_waiting(v_waiting_list, v_target_list, 'TEST-WAIT-A', 2);
  SELECT (items->0->>'pickingQty')::int INTO v_qty_after
    FROM public.picking_lists WHERE id = v_waiting_list;
  ASSERT v_qty_after = 3, 'T2.partial qty failed (expected 3 remaining): %', v_qty_after;

  -- T2b: take over the rest (3 units) — item should be removed entirely
  PERFORM public.take_over_sku_from_waiting(v_waiting_list, v_target_list, 'TEST-WAIT-A', 3);
  SELECT jsonb_array_length(items) INTO v_qty_after
    FROM public.picking_lists WHERE id = v_waiting_list;
  ASSERT v_qty_after = 0, 'T2b.full take-over failed (expected empty array): %', v_qty_after;

  -- T2c: take over more than available — must raise
  v_caught := FALSE;
  BEGIN
    -- put one item back so the sku exists again
    UPDATE public.picking_lists
       SET items = '[{"sku":"TEST-WAIT-A","pickingQty":1,"warehouse":"LUDLOW","location":"ROW 99"}]'::jsonb
     WHERE id = v_waiting_list;

    PERFORM public.take_over_sku_from_waiting(v_waiting_list, v_target_list, 'TEST-WAIT-A', 999);
  EXCEPTION WHEN OTHERS THEN
    v_caught := TRUE;
  END;
  ASSERT v_caught, 'T2c.over-take expected to raise but did not';

  -- T3: unmark with resume → status back to ready_to_double_check
  PERFORM public.unmark_picking_list_waiting(v_waiting_list, 'resume');
  SELECT is_waiting_inventory, status INTO v_flag_after, v_status_after
    FROM public.picking_lists WHERE id = v_waiting_list;
  ASSERT v_flag_after = FALSE,                       'T3.flag failed: %',   v_flag_after;
  ASSERT v_status_after = 'ready_to_double_check',   'T3.status failed: %', v_status_after;

  -- T4: re-mark and unmark with cancel → status = cancelled
  PERFORM public.mark_picking_list_waiting(v_waiting_list, 'Test cancel path');
  PERFORM public.unmark_picking_list_waiting(v_waiting_list, 'cancel');
  SELECT is_waiting_inventory, status INTO v_flag_after, v_status_after
    FROM public.picking_lists WHERE id = v_waiting_list;
  ASSERT v_flag_after = FALSE,           'T4.flag failed: %',   v_flag_after;
  ASSERT v_status_after = 'cancelled',   'T4.status failed: %', v_status_after;

  -- T5: non-admin must be rejected
  IF v_staff_user_id IS NOT NULL THEN
    PERFORM set_config(
      'request.jwt.claims',
      json_build_object('sub', v_staff_user_id::text)::text,
      true
    );
    v_caught := FALSE;
    BEGIN
      PERFORM public.mark_picking_list_waiting(v_target_list, 'should fail');
    EXCEPTION WHEN insufficient_privilege THEN
      v_caught := TRUE;
    END;
    ASSERT v_caught, 'T5.staff-rejection expected insufficient_privilege but did not raise';
  ELSE
    RAISE NOTICE 'idea-053 smoke T5: no staff user, skipping admin-only check';
  END IF;

  -- T6: auto_cancel_stale_orders should NOT cancel an old verification order.
  --     We backdate v_target_list 48h and confirm the function leaves it alone.
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_admin_user_id::text)::text,
    true
  );
  UPDATE public.picking_lists
     SET status     = 'ready_to_double_check',
         updated_at = NOW() - INTERVAL '48 hours'
   WHERE id = v_target_list;

  PERFORM public.auto_cancel_stale_orders();

  SELECT status INTO v_status_after
    FROM public.picking_lists WHERE id = v_target_list;
  ASSERT v_status_after = 'ready_to_double_check',
    'T6.verification-branch-removed failed (expected ready_to_double_check, got %)', v_status_after;

  -- Cleanup
  DELETE FROM public.picking_list_notes WHERE list_id IN (v_waiting_list, v_target_list);
  DELETE FROM public.picking_lists      WHERE id      IN (v_waiting_list, v_target_list);
  PERFORM set_config('request.jwt.claims', '', true);

  RAISE NOTICE 'idea-053 smoke tests: ALL PASSED ✓';
END
$smoke$;
