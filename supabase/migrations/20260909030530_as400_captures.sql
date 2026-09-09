-- ============================================================================
-- The door: AS400 captures the watchdog has seen, listed in Pickd, brought in
-- with one tap
--
-- Today, knowing which orders the watchdog captured from the AS400 means
-- walking to the Bay 2 MacBook and pressing "Send" on its own little UI. Rafael
-- (2026-09-08): "el watcher se encarga de la parte operativa y pickd de la
-- visual". So the watcher publishes every capture here — parsed summary, items
-- and the raw screen text — the moment it captures it, and the Live Board shows
-- them as FedEx or regular like any other order, with customer, pallets, bikes
-- and parts. A tap on "Traer" only flips `status` to `requested`; the watcher
-- polls for that and sends through the exact pipeline it always used. Nothing
-- travels from the app to Bay 2, because nothing can: that Mac sits behind the
-- warehouse NAT and its Flask UI only listens on loopback.
--
-- Why the data is published at capture time and not fetched at tap time:
-- Rafael's own worry — "perdería en pickd la vista si es una orden fedex o
-- regular y de qué cliente es, cuántos pallets y cantidad de bicicletas". With
-- the items (and each item's is_bike) already here, the board classifies and
-- counts before anyone taps anything.
--
-- Transitions live in SECURITY DEFINER functions, not in table policies. A row
-- policy cannot say "only from pending to requested, and only stamp yourself";
-- a function can, and a second tap on the same order then simply updates zero
-- rows. The app gets SELECT and nothing else. The watcher (service_role) is the
-- only writer, and even it goes through publish_as400_capture so a re-capture
-- can never overwrite a request that is in flight.
--
-- Visibility does NOT trust `status = 'sent'`. The view v_as400_door hides any
-- capture that already has a picking_lists row (exact, or a member of a merged
-- "A / B" number — the same rule as the watchdog's split_order_numbers), so a
-- stale status can never show a phantom order that is already on the board.
--
-- Measured before designing (2026-09-08, last 30 days): 304 AS400 order
-- numbers walked, 182 reached picking_lists, 122 gaps; real orders complete in
-- a median of 1.1 h. Hence held-as-stale at 3 days and archived at 8 — both
-- applied by the watcher, tunable on Bay 2, not baked in here.
-- ============================================================================

BEGIN;

-- ── the captures ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.as400_captures (
  order_number         text PRIMARY KEY,
  status               text NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','held','requested','sending','sent','archived','junk')),
  -- Why a row is held: total_mismatch | waiting_locked | no_customer | stale.
  -- A held row must say why; other statuses may keep the last reason as history.
  hold_reason          text CHECK (status <> 'held' OR hold_reason IS NOT NULL),
  -- auto_scan | manual_capture — what the watchdog's own cache records.
  source               text,
  captured_at          timestamptz NOT NULL,
  updated_at           timestamptz NOT NULL DEFAULT now(),

  -- The parsed header, so a card can be drawn without the raw text.
  customer             text,
  ship_to              text,
  as400_account_number text,
  order_date           date,
  item_count           integer,
  total_units          integer,
  subtotal             numeric,
  -- Parsed lines do not add up to the header Sub-Total: a page was lost.
  total_mismatch       boolean NOT NULL DEFAULT false,
  -- [{sku (canonical), pickingQty, description, unit_price, sku_metadata:{is_bike}}]
  -- `pickingQty` and the embedded is_bike are what autoClassifyShippingType and
  -- calculatePalletsWithBikeAwareness read, so the board needs no lookup.
  items                jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- The screen text the watchdog will send from. Never shown in the app.
  raw_text             text,

  -- The request lifecycle. requested_by is a person (auth.uid()); the watcher
  -- acts as service_role and would stamp NULL, which is why it never sets it.
  requested_by         uuid REFERENCES public.profiles(id),
  requested_at         timestamptz,
  sent_at              timestamptz,
  picking_list_id      uuid REFERENCES public.picking_lists(id) ON DELETE SET NULL,
  -- process_order_text's answer: {status: created|appended|reopened|combined|duplicate…}
  result               jsonb,
  last_error           text,
  dismissed_by         uuid REFERENCES public.profiles(id),
  dismissed_at         timestamptz
);

COMMENT ON TABLE public.as400_captures IS
  'Every order the watchdog captured from the AS400, published at capture time. '
  'The Live Board lists the ones not yet in picking_lists; a tap requests one and '
  'the watchdog on Bay 2 sends it. Written only by the watchdog (service_role) '
  'through publish_as400_capture; the app only reads and calls the request/'
  'cancel/dismiss functions.';

CREATE INDEX IF NOT EXISTS as400_captures_status_captured_idx
  ON public.as400_captures (status, captured_at DESC);
-- The FK's ON DELETE SET NULL scans without this, and Pickd hard-deletes
-- cancelled rows.
CREATE INDEX IF NOT EXISTS as400_captures_picking_list_idx
  ON public.as400_captures (picking_list_id);

-- ── the watcher's pulse ──────────────────────────────────────────────────────
-- One row. When seen_at goes stale the board says "Bay 2 sin señal" and greys
-- out "Traer": a request nobody is there to execute should not look like it
-- is being worked on. Deliberately NOT in the realtime publication — it moves
-- every few seconds and would broadcast to every open client; the app polls it.

CREATE TABLE IF NOT EXISTS public.as400_watcher_heartbeat (
  id       integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  seen_at  timestamptz NOT NULL DEFAULT now(),
  version  text
);

COMMENT ON TABLE public.as400_watcher_heartbeat IS
  'Single row the watchdog on Bay 2 touches every poll. seen_at older than a '
  'minute means nobody is there to execute a request.';

-- ── RLS: the app reads; only functions and the watchdog write ────────────────

ALTER TABLE public.as400_captures          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.as400_watcher_heartbeat ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "signed-in read as400 captures"  ON public.as400_captures;
CREATE POLICY "signed-in read as400 captures"
  ON public.as400_captures FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "signed-in read watcher heartbeat" ON public.as400_watcher_heartbeat;
CREATE POLICY "signed-in read watcher heartbeat"
  ON public.as400_watcher_heartbeat FOR SELECT TO authenticated USING (true);

-- No INSERT/UPDATE/DELETE policy for authenticated, on purpose: transitions
-- go through the functions below, and the watchdog bypasses RLS.

-- ── what the board shows ─────────────────────────────────────────────────────
-- A capture that already has a picking_lists row — by exact number or as a
-- member of a merged "A / B" — is not a door candidate, whatever its status
-- says. security_invoker so the caller's own RLS applies to both tables.

CREATE OR REPLACE VIEW public.v_as400_door
WITH (security_invoker = true) AS
SELECT
  c.order_number, c.status, c.hold_reason, c.source, c.captured_at, c.updated_at,
  c.customer, c.ship_to, c.as400_account_number, c.order_date,
  c.item_count, c.total_units, c.subtotal, c.total_mismatch, c.items,
  c.requested_by, c.requested_at, c.last_error
FROM public.as400_captures c
WHERE c.status NOT IN ('junk', 'archived', 'sent')
  AND NOT EXISTS (
    SELECT 1
    FROM public.picking_lists pl
    WHERE pl.order_number = c.order_number
       OR c.order_number = ANY (string_to_array(pl.order_number, ' / '))
  );

COMMENT ON VIEW public.v_as400_door IS
  'AS400 captures the board can offer: not junk, not archived, not sent, and '
  'with no picking_lists row that already carries the number (exact or as a '
  'merged member). raw_text is left out on purpose.';

-- ── transitions ──────────────────────────────────────────────────────────────

-- The watchdog publishes. Refreshes what it read every time (a re-capture is a
-- newer read) but only moves `status` when the row is not mid-request: a
-- manual re-capture on Bay 2 must never reset a `requested` back to `pending`,
-- nor re-open a `sent`. The intended status comes from the caller — the
-- watcher's reconciler owns the junk rules (ebay, stale, no_customer) — so the
-- same cached entry published twice lands in the same state twice.
CREATE OR REPLACE FUNCTION public.publish_as400_capture(
  p_order_number text,
  p_status       text,
  p_hold_reason  text,
  p_payload      jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status text;
BEGIN
  IF p_status NOT IN ('pending', 'held', 'archived', 'junk') THEN
    RAISE EXCEPTION 'publish_as400_capture: % is not a status the watcher may set', p_status;
  END IF;
  IF p_status = 'held' AND p_hold_reason IS NULL THEN
    RAISE EXCEPTION 'publish_as400_capture: held needs a hold_reason';
  END IF;

  INSERT INTO public.as400_captures AS c (
    order_number, status, hold_reason, source, captured_at, updated_at,
    customer, ship_to, as400_account_number, order_date,
    item_count, total_units, subtotal, total_mismatch, items, raw_text
  ) VALUES (
    p_order_number, p_status, p_hold_reason,
    p_payload->>'source',
    COALESCE((p_payload->>'captured_at')::timestamptz, now()),
    now(),
    p_payload->>'customer',
    p_payload->>'ship_to',
    p_payload->>'as400_account_number',
    (p_payload->>'order_date')::date,
    (p_payload->>'item_count')::integer,
    (p_payload->>'total_units')::integer,
    (p_payload->>'subtotal')::numeric,
    COALESCE((p_payload->>'total_mismatch')::boolean, false),
    COALESCE(p_payload->'items', '[]'::jsonb),
    p_payload->>'raw_text'
  )
  ON CONFLICT (order_number) DO UPDATE SET
    source               = EXCLUDED.source,
    captured_at          = EXCLUDED.captured_at,
    updated_at           = now(),
    customer             = EXCLUDED.customer,
    ship_to              = EXCLUDED.ship_to,
    as400_account_number = EXCLUDED.as400_account_number,
    order_date           = EXCLUDED.order_date,
    item_count           = EXCLUDED.item_count,
    total_units          = EXCLUDED.total_units,
    subtotal             = EXCLUDED.subtotal,
    total_mismatch       = EXCLUDED.total_mismatch,
    items                = EXCLUDED.items,
    raw_text             = EXCLUDED.raw_text,
    -- Only a resting row takes the caller's status. A request in flight, or a
    -- row already sent, keeps what it has.
    status      = CASE WHEN c.status IN ('pending','held','archived','junk')
                       THEN EXCLUDED.status ELSE c.status END,
    hold_reason = CASE WHEN c.status IN ('pending','held','archived','junk')
                       THEN EXCLUDED.hold_reason ELSE c.hold_reason END
  RETURNING c.status INTO v_status;

  RETURN v_status;
END;
$$;

COMMENT ON FUNCTION public.publish_as400_capture(text, text, text, jsonb) IS
  'Watchdog only. Upserts a capture; never overwrites requested/sending/sent.';

REVOKE ALL ON FUNCTION public.publish_as400_capture(text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_as400_capture(text, text, text, jsonb) TO service_role;

-- A person asks for the order. pending → requested; a held row only when its
-- reason is one that waiting or a person can clear (stale, waiting_locked) —
-- total_mismatch is a lost page and sending it would create a wrong picking
-- list, so it needs a re-capture on Bay 2, not a tap. An archived row may be
-- brought back (the "buscar mañana" case). Returns false when the row was not
-- in a state that allows it: a second tap, or somebody else got there first.
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
         updated_at   = now()
   WHERE order_number = p_order_number
     AND (
       status = 'pending'
       OR status = 'archived'
       OR (status = 'held' AND hold_reason IN ('stale', 'waiting_locked'))
     );

  RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION public.request_as400_capture(text) IS
  'Tap "Traer": asks the watchdog to send this capture. false = not requestable now.';

REVOKE ALL ON FUNCTION public.request_as400_capture(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_as400_capture(text) TO authenticated;

-- Take a request back before the watcher picks it up — or after, if Bay 2 is
-- down and the row is stuck. Only the person who asked, or an admin.
CREATE OR REPLACE FUNCTION public.cancel_as400_request(p_order_number text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'cancel_as400_request: a signed-in user is required';
  END IF;

  UPDATE public.as400_captures
     SET status       = 'pending',
         requested_by = NULL,
         requested_at = NULL,
         updated_at   = now()
   WHERE order_number = p_order_number
     AND status IN ('requested', 'sending')
     AND (requested_by = auth.uid() OR public.is_admin());

  RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION public.cancel_as400_request(text) IS
  'requested/sending → pending, by the requester or an admin.';

REVOKE ALL ON FUNCTION public.cancel_as400_request(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_as400_request(text) TO authenticated;

-- Hide a capture for good. Rafael, 2026-09-08: anyone signed in. The row stays
-- so "what did AS400 emit" is still answerable in SQL.
CREATE OR REPLACE FUNCTION public.dismiss_as400_capture(p_order_number text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'dismiss_as400_capture: a signed-in user is required';
  END IF;

  UPDATE public.as400_captures
     SET status       = 'junk',
         dismissed_by = auth.uid(),
         dismissed_at = now(),
         updated_at   = now()
   WHERE order_number = p_order_number
     AND status IN ('pending', 'held', 'archived');

  RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION public.dismiss_as400_capture(text) IS
  'Mark a capture as junk so the board stops offering it. Kept as a ledger row.';

REVOKE ALL ON FUNCTION public.dismiss_as400_capture(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dismiss_as400_capture(text) TO authenticated;

-- ── realtime: the captures only ──────────────────────────────────────────────
-- Guarded, so re-running this file is a no-op. Without this line the client's
-- postgres_changes subscription never fires and never errors (see
-- 20260715120000_sku_metadata_realtime.sql).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'as400_captures'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.as400_captures;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
