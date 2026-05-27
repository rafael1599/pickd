-- Migration: Audit trail for picking_lists hard deletes
-- Origin: 2026-04-30 — order 879469 vanished overnight without trace.
-- Root cause was the client-side stale-session DELETE in usePickingSync.ts
-- (already fixed in commit 1645bff). This migration adds a BEFORE DELETE
-- trigger that captures the full row + caller identity into a dedicated
-- audit table, so any future deletion (UI, RPC, manual SQL, anything that
-- bypasses RLS) leaves a forensic trail.
--
-- Aditive only: new table + trigger. No existing schema is altered.

-- ─── 1. Audit table ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.picking_lists_deleted_audit (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id       uuid        NOT NULL,
  order_number  text,
  status        text,
  user_id       uuid,                                -- original picking_lists.user_id (owner)
  deleted_by    uuid,                                -- auth.uid() at delete time (may be NULL for service role)
  deleted_at    timestamptz NOT NULL DEFAULT NOW(),
  row_snapshot  jsonb       NOT NULL                 -- full OLD row, including items
);

CREATE INDEX IF NOT EXISTS picking_lists_deleted_audit_deleted_at_idx
  ON public.picking_lists_deleted_audit (deleted_at DESC);

CREATE INDEX IF NOT EXISTS picking_lists_deleted_audit_order_number_idx
  ON public.picking_lists_deleted_audit (order_number);

CREATE INDEX IF NOT EXISTS picking_lists_deleted_audit_list_id_idx
  ON public.picking_lists_deleted_audit (list_id);

COMMENT ON TABLE public.picking_lists_deleted_audit IS
  'idea-099 follow-up: audit trail for hard deletes on picking_lists. Created after order 879469 disappeared on 2026-04-30 without leaving any trace. Captures full row snapshot + caller identity at delete time.';

-- ─── 2. RLS — admins read; system writes via SECURITY DEFINER trigger ──────
ALTER TABLE public.picking_lists_deleted_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read deletion audit"
  ON public.picking_lists_deleted_audit;

CREATE POLICY "Admins can read deletion audit"
  ON public.picking_lists_deleted_audit
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- No INSERT/UPDATE/DELETE policies for end-users: the trigger writes via
-- SECURITY DEFINER, so it bypasses RLS. Manual writes are not allowed.

-- ─── 3. Trigger function ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_picking_list_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  INSERT INTO public.picking_lists_deleted_audit (
    list_id,
    order_number,
    status,
    user_id,
    deleted_by,
    row_snapshot
  ) VALUES (
    OLD.id,
    OLD.order_number,
    OLD.status,
    OLD.user_id,
    auth.uid(),
    to_jsonb(OLD)
  );
  RETURN OLD;
END;
$$;

ALTER FUNCTION public.log_picking_list_deletion() OWNER TO postgres;

COMMENT ON FUNCTION public.log_picking_list_deletion() IS
  'BEFORE DELETE trigger on picking_lists: writes a row to picking_lists_deleted_audit with auth.uid() as deleted_by and the full OLD row as JSON.';

-- ─── 4. Trigger ─────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_picking_list_deletion_audit ON public.picking_lists;

CREATE TRIGGER trg_picking_list_deletion_audit
  BEFORE DELETE ON public.picking_lists
  FOR EACH ROW
  EXECUTE FUNCTION public.log_picking_list_deletion();
