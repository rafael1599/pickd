-- ============================================================================
-- idea-053 (follow-up): Clear waiting state on complete or cancel
--
-- Ensures that any picking list that moves to 'completed' or 'cancelled'
-- has its is_waiting_inventory set to FALSE and waiting_reason set to NULL.
-- This prevents completed/cancelled orders from staying marked as waiting
-- in the database, which blocks watchdogs and corrupts state metrics.
-- ============================================================================

-- 1. Retroactive cleanup of existing inconsistent rows
UPDATE public.picking_lists
SET is_waiting_inventory = FALSE,
    waiting_reason = NULL
WHERE status IN ('completed', 'cancelled')
  AND is_waiting_inventory = TRUE;

-- 2. Trigger function to clear waiting status automatically
CREATE OR REPLACE FUNCTION public.clear_waiting_on_complete_or_cancel()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IN ('completed', 'cancelled') THEN
    NEW.is_waiting_inventory := FALSE;
    NEW.waiting_reason := NULL;
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.clear_waiting_on_complete_or_cancel() OWNER TO postgres;

-- 3. Create before-update trigger
DROP TRIGGER IF EXISTS trg_clear_waiting_on_complete_or_cancel ON public.picking_lists;
CREATE TRIGGER trg_clear_waiting_on_complete_or_cancel
  BEFORE INSERT OR UPDATE OF status ON public.picking_lists
  FOR EACH ROW
  EXECUTE FUNCTION public.clear_waiting_on_complete_or_cancel();

-- ============================================================================
-- Enforce unique active orders
--
-- Ensures that at any given time, there can be at most ONE active picking list 
-- (not in 'completed' or 'cancelled' status) for a given order number.
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_picking_lists_unique_active_order_number
  ON public.picking_lists (order_number)
  WHERE status NOT IN ('completed', 'cancelled')
    AND order_number IS NOT NULL
    AND order_number <> '';
