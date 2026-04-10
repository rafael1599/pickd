-- ─────────────────────────────────────────────────────────────────────────────
-- Security hardening — Phase 1
-- 2026-04-10
--
-- Fixes 3 critical issues identified in the security audit:
--   1. profiles.role privilege escalation (any staff could promote themselves)
--   2. project_tasks RLS lying about admin restrictions (USING WITH CHECK true)
--   3. Missing SET search_path on SECURITY DEFINER functions (search_path attacks)
--
-- All changes are additive and reversible. No data is modified.
-- ─────────────────────────────────────────────────────────────────────────────


-- ─── 1. profiles.role anti-escalation trigger ────────────────────────────────
-- Prevents any non-admin from changing their own role.
-- Even admins cannot change their OWN role (defense in depth — must be done by
-- another admin via the manage-users flow).

CREATE OR REPLACE FUNCTION public.prevent_role_self_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Only fire when role actually changes
  IF OLD.role IS DISTINCT FROM NEW.role THEN
    -- Caller must be admin
    IF NOT public.is_admin() THEN
      RAISE EXCEPTION 'Only admins can change user roles' USING ERRCODE = '42501';
    END IF;
    -- Even admins cannot promote/demote themselves
    IF NEW.id = auth.uid() THEN
      RAISE EXCEPTION 'Admins cannot change their own role' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_prevent_role_escalation ON public.profiles;
CREATE TRIGGER profiles_prevent_role_escalation
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_role_self_escalation();


-- ─── 2. project_tasks RLS — actually enforce admin ───────────────────────────
-- The original migration created policies named "Admins can ..." but used
-- WITH CHECK (true), meaning any authenticated user could write.
-- This rewrites them to actually require is_admin().

DROP POLICY IF EXISTS "Admins can insert project_tasks" ON public.project_tasks;
DROP POLICY IF EXISTS "Admins can update project_tasks" ON public.project_tasks;
DROP POLICY IF EXISTS "Admins can delete project_tasks" ON public.project_tasks;

CREATE POLICY "Admins can insert project_tasks" ON public.project_tasks
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update project_tasks" ON public.project_tasks
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can delete project_tasks" ON public.project_tasks
  FOR DELETE TO authenticated
  USING (public.is_admin());

-- task_state_changes — only admins can log state changes (matches the kanban
-- UI which is already admin-only)
DROP POLICY IF EXISTS "Authenticated users can insert task_state_changes"
  ON public.task_state_changes;

CREATE POLICY "Admins can insert task_state_changes" ON public.task_state_changes
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());


-- ─── 3. SET search_path on SECURITY DEFINER functions ────────────────────────
-- Adds `SET search_path = public, pg_temp` to functions that don't have it.
-- This is a pure security hardening — no behavior change.
--
-- We use ALTER FUNCTION instead of CREATE OR REPLACE to avoid touching the
-- function bodies. ALTER FUNCTION ... SET search_path is the recommended
-- approach for retrofitting search_path on existing SECURITY DEFINER functions.

DO $$
DECLARE
  fn text;
  fn_list text[] := ARRAY[
    'public.adjust_inventory_quantity(text, text, text, integer, text, uuid, text, uuid, text, text, boolean, text)',
    'public.auto_cancel_stale_orders()',
    'public.create_daily_snapshot(date)',
    'public.delete_inventory_item(integer, text, uuid)',
    'public.get_snapshot(date)',
    'public.get_snapshot_summary(date)',
    'public.move_inventory_stock(text, text, text, text, text, integer, text, uuid, text, text)',
    'public.process_picking_list(uuid, text, uuid, integer, integer, text)',
    'public.resolve_location(text, text, text)',
    'public.undo_inventory_action(uuid)',
    'public.upsert_inventory_log(text, text, text, text, text, integer, integer, integer, text, bigint, uuid, uuid, text, uuid, uuid, text, jsonb, boolean)',
    'public.handle_new_user()',
    'public.update_user_presence(uuid)'
  ];
BEGIN
  FOREACH fn IN ARRAY fn_list LOOP
    BEGIN
      EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', fn);
      RAISE NOTICE 'Hardened search_path on %', fn;
    EXCEPTION
      WHEN undefined_function THEN
        RAISE NOTICE 'Function not found (skipping): %', fn;
      WHEN others THEN
        RAISE NOTICE 'Failed to harden % — %', fn, SQLERRM;
    END;
  END LOOP;
END $$;
