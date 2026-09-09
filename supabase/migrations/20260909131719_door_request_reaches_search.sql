-- ============================================================================
-- The door's search reaches past the list, so requesting has to reach with it
--
-- v_as400_door deliberately hides archived and dismissed captures: the board
-- should offer today's work, not a year of it. But Rafael asked for the
-- watchdog's order search here (2026-09-09), and the case he described when the
-- door was designed is exactly the one the list hides — "una orden no elegida
-- hoy que se busca para jalar mañana". A search that finds a capture and cannot
-- act on it is a worse answer than not finding it.
--
-- `archived` was already requestable. `junk` was not, and dismissing is
-- something anyone signed in can do, so an accidental dismissal had no way back
-- at all. Bringing the order in IS the undo — no second verb, no second button.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.request_as400_capture(p_order_number text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'request_as400_capture: a signed-in user is required';
  END IF;

  UPDATE public.as400_captures
     SET status       = 'requested',
         requested_by = auth.uid(),
         requested_at = now(),
         hold_reason  = NULL,
         last_error   = NULL,
         dismissed_by = NULL,
         dismissed_at = NULL,
         updated_at   = now()
   WHERE order_number = p_order_number
     AND (
       status = 'pending'
       -- Found by search after the list let it go, or after somebody dismissed
       -- it. Asking for it is the undo.
       OR status IN ('archived', 'junk')
       -- Held for a reason waiting or a person can clear. A lost page
       -- (total_mismatch) still cannot: it needs a re-capture on Bay 2.
       OR (status = 'held' AND hold_reason IN ('stale', 'waiting_locked'))
     );

  RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION public.request_as400_capture(text) IS
  'Tap "Bring in": asks the watchdog to send this capture. Accepts pending, '
  'held (stale/waiting_locked), archived and dismissed — bringing an order in '
  'is also how a dismissal is undone. false = not requestable now.';

REVOKE ALL ON FUNCTION public.request_as400_capture(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_as400_capture(text) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
