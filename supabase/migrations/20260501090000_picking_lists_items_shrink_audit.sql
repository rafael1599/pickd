-- Migration: Audit suspicious shrinkage of picking_lists.items
--
-- Origin: 2026-05-01. After diagnosing the 879484/879460 incident
-- (11 items lost via stale cartItems written by generatePickingPath),
-- we want a forensic safety net for any FUTURE silent-loss path. The
-- ' / ' guard added in dd64e78 + 7019260 covers the known cases, but
-- a soft audit on items shrinkage will catch any new path that bypasses
-- the guards before it costs another order.
--
-- Soft audit only: logs the event, does NOT block the UPDATE. We don't
-- want to risk breaking a legitimate flow.
--
-- Threshold: shrink of 3+ items. Picks up the "11 → 3" pattern; ignores
-- normal 1-item removals from Edit Order corrections.

-- ─── 1. Audit table ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.picking_lists_items_shrink_audit (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id         uuid        NOT NULL,
  order_number    text,
  status          text,
  prev_item_count int         NOT NULL,
  new_item_count  int         NOT NULL,
  shrink_by       int         GENERATED ALWAYS AS (prev_item_count - new_item_count) STORED,
  prev_items      jsonb       NOT NULL,
  new_items       jsonb       NOT NULL,
  caller          uuid,                                  -- auth.uid() at write time
  occurred_at     timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS picking_lists_items_shrink_audit_occurred_at_idx
  ON public.picking_lists_items_shrink_audit (occurred_at DESC);

CREATE INDEX IF NOT EXISTS picking_lists_items_shrink_audit_order_number_idx
  ON public.picking_lists_items_shrink_audit (order_number);

CREATE INDEX IF NOT EXISTS picking_lists_items_shrink_audit_list_id_idx
  ON public.picking_lists_items_shrink_audit (list_id);

COMMENT ON TABLE public.picking_lists_items_shrink_audit IS
  'idea-099 follow-up: audit suspicious shrinkage of picking_lists.items (>=3 items dropped in one UPDATE). Created after the 879484/879460 incident on 2026-04-30 where 11 items were silently lost via stale-state write-back.';

-- ─── 2. RLS — admins read; system writes via SECURITY DEFINER trigger ──────
ALTER TABLE public.picking_lists_items_shrink_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read items-shrink audit"
  ON public.picking_lists_items_shrink_audit;

CREATE POLICY "Admins can read items-shrink audit"
  ON public.picking_lists_items_shrink_audit
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- ─── 3. Trigger function ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_picking_list_items_shrink()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_prev_count int;
  v_new_count  int;
BEGIN
  v_prev_count := COALESCE(jsonb_array_length(OLD.items), 0);
  v_new_count  := COALESCE(jsonb_array_length(NEW.items), 0);

  -- Only log meaningful drops. 1- or 2-item removals are normal corrections.
  IF v_new_count < v_prev_count - 2 THEN
    INSERT INTO public.picking_lists_items_shrink_audit (
      list_id,
      order_number,
      status,
      prev_item_count,
      new_item_count,
      prev_items,
      new_items,
      caller
    ) VALUES (
      NEW.id,
      NEW.order_number,
      NEW.status,
      v_prev_count,
      v_new_count,
      COALESCE(OLD.items, '[]'::jsonb),
      COALESCE(NEW.items, '[]'::jsonb),
      auth.uid()
    );
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.log_picking_list_items_shrink() OWNER TO postgres;

COMMENT ON FUNCTION public.log_picking_list_items_shrink() IS
  'BEFORE UPDATE trigger on picking_lists: when NEW.items shrinks by 3 or more rows vs OLD.items, log a row to picking_lists_items_shrink_audit with both snapshots and auth.uid(). Soft audit — never blocks the UPDATE.';

-- ─── 4. Trigger ─────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_picking_list_items_shrink_audit ON public.picking_lists;

CREATE TRIGGER trg_picking_list_items_shrink_audit
  BEFORE UPDATE ON public.picking_lists
  FOR EACH ROW
  WHEN (OLD.items IS DISTINCT FROM NEW.items)
  EXECUTE FUNCTION public.log_picking_list_items_shrink();
