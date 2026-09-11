-- ============================================================================
-- The AS400 door keeps the orders on hold, and says why (idea-179, 11 Sep 2026)
--
-- Rafael, 10 Sep: "Un board similar al fisico que tenemos para las ordenes pero
-- en virtual con una etiqueta para los holds". A hold is an order the office
-- writes into the AS400 Order Comments to be built but not shipped yet —
-- "HOLD FOR ADDS", "SHIP WITH REN" (the Renegade pre-orders), "HOLD FOR CONF".
--
-- The door could not see them. v_as400_door never exposed the Order Comments
-- (they live in raw_text, left out on purpose), and the watchdog ages every
-- capture nobody brings in: 'held:stale' at 3 days ("NOBODY BROUGHT IT IN"),
-- 'archived' at 8 — out of the list. That rule was written for junk, and it was
-- eating the holds: on 11 Sep, 27 of 65 captures were holds, the REN / ADDS
-- ones due to leave the list between 16 and 18 Sep. Waiting is the point of a
-- hold, so a hold must never age out.
--
-- Three pieces, no data change:
--   1. as400_order_comments(raw) — the watchdog's parse_order_comments in SQL.
--   2. order_note_hold(note)     — what a note holds the order for ('ADDS',
--      'REN', 'CONF', 'PAY', a model, 'HOLD') or NULL. The SQL mirror of
--      `readOrderNote(...).hold` in src/utils/orderNoteSignals.ts; both sides
--      must pass the same case table (validated below, and HOLD_CASES in the
--      TS test). If one changes, change the other.
--   3. v_as400_door gains order_comments and hold, and keeps showing an
--      archived capture that is a hold. Junk (dismissed by a person) and sent
--      stay out; anything already in picking_lists stays out.
--
-- PostgreSQL regex notes for whoever edits this: \m and \M are the word
-- boundaries (\b is a backspace here), and a ']' first in a bracket is literal.
-- ============================================================================

BEGIN;

-- ── 1. Order Comments out of the screen text ───────────────────────────────
-- 'Order Comments: SHIP W/881495 & 2ND REN  NET 90 TERMS      ' — one line; the
-- 5250 legend ('Cmd5 Cmd6=…') can share the row and is cut. Empty → NULL.
CREATE OR REPLACE FUNCTION public.as400_order_comments(p_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT nullif(
           btrim(regexp_replace(
             regexp_replace(
               substring(coalesce(p_raw, '') FROM '(?i)Order\s+Comments:[ \t]*([^\n]*)'),
               '\s*\mCmd\d+\M.*$', '', 'i'),
             '\s+', ' ', 'g')),
           '')
$$;

COMMENT ON FUNCTION public.as400_order_comments(text) IS
  'The Order Comments line of an AS400 capture (watchdog parser.parse_order_comments). '
  'NULL when absent or empty. 20260911161528.';

-- ── 2. What a note holds the order for ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public._note_model_label(p_word text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
           WHEN w IS NULL OR w = '' THEN NULL
           -- A document, a warehouse or a filler word after "SHIP WITH", not a bike.
           WHEN w = ANY (ARRAY['FL','FLA','PS','ORDER','ORDERS','PARTS','PART','THE','A','AN',
                               'AND','MISSING','ALLOCATIONS']) THEN NULL
           WHEN w ~ '^CIT' THEN 'CITIZEN'
           WHEN w ~ '^REN' THEN 'REN'
           WHEN w = 'LASERS' THEN 'LASER'
           ELSE w
         END
  FROM (SELECT upper(btrim(regexp_replace(coalesce(p_word, ''), '\s+', ' ', 'g'))) AS w) s
$$;

CREATE OR REPLACE FUNCTION public.order_note_hold(p_note text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  t         text;
  is_pickup boolean;
  hold_text text;
  model     text;
  word      text;
BEGIN
  -- What PickD appended to the AS400 note is PickD's history, not the office's.
  t := regexp_replace(coalesce(p_note, ''), '\s*\[(System|User|Completed manually)[^]]*\]', '', 'gi');
  t := regexp_replace(t, '^\s*User Cancelled\s*$', '', 'i');
  t := btrim(regexp_replace(t, '\s+', ' ', 'g'));
  IF t = '' THEN
    RETURN NULL;
  END IF;

  -- "this order is not a pick up" is not one (#881353).
  is_pickup := regexp_replace(t, '\mnot\s+(a\s+)?(pick\s*-?\s*up|pickup)', ' ', 'gi')
               ~* '(pick\s*-?\s*up|pikcup|will\s*call|drop\s*-?\s*off)';
  -- On a pickup, "DO NOT SHIP" is the pickup, not a hold.
  hold_text := CASE WHEN is_pickup THEN regexp_replace(t, 'do\s*n[o'']?t\s+ship', ' ', 'gi') ELSE t END;

  -- A model after "SHIP WITH" is a hold for that model ("SHIP WITH REN");
  -- "with" whole or "w/" with its slash, never a bare "w" ("SHIP WITH 881418").
  model := public._note_model_label(
             (regexp_match(t, '\mship\s*(?:with\M|w\s*/)\s*([a-z][a-z0-9]*(?:\s+access)?)', 'i'))[1]);
  IF model IS NULL THEN
    model := public._note_model_label(
               (regexp_match(t,
                 '\m(?:with|w/)\s*(hudson|cit(?:izen)?\s*\d?|renegades?|ren|allegro|lasers?|ventura|divides?|helix|komodo|all\s+access)\M',
                 'i'))[1]);
  END IF;

  IF NOT (hold_text ~* '\mhold\M|\mwait(ing)?\M|pending\s+payment|do\s*n[o'']?t\s+ship')
     AND model IS NULL THEN
    RETURN NULL;
  END IF;

  IF hold_text ~* '\madd(?:s|\s*-?\s*ons?)?\M' THEN RETURN 'ADDS'; END IF;
  IF hold_text ~* '\mren(?:egades?)?\M' THEN RETURN 'REN'; END IF;
  IF hold_text ~* '\mconf(?:irm(?:ation)?)?\M' THEN RETURN 'CONF'; END IF;
  IF hold_text ~* '\mpayment\M|\mcc\s*info\M|\mcredit\s*card\M' THEN RETURN 'PAY'; END IF;
  IF model IS NOT NULL THEN RETURN model; END IF;

  word := public._note_model_label((regexp_match(hold_text, '\mhold\s+(?:for|with)\s+([a-z][a-z0-9]*)', 'i'))[1]);
  RETURN coalesce(word, 'HOLD');
END;
$$;

COMMENT ON FUNCTION public.order_note_hold(text) IS
  'What an order note holds the order for: ADDS | REN | CONF | PAY | a model | HOLD, or NULL. '
  'SQL mirror of readOrderNote().hold (src/utils/orderNoteSignals.ts) — same case table. 20260911161528.';

-- ── 3. The door ────────────────────────────────────────────────────────────
-- CREATE OR REPLACE keeps the columns it had, in order; the two new ones go last.
CREATE OR REPLACE VIEW public.v_as400_door
WITH (security_invoker = true) AS
SELECT
  c.order_number, c.status, c.hold_reason, c.source, c.captured_at, c.updated_at,
  c.customer, c.ship_to, c.as400_account_number, c.order_date,
  c.item_count, c.total_units, c.subtotal, c.total_mismatch, c.items,
  c.requested_by, c.requested_at, c.last_error,
  x.order_comments,
  public.order_note_hold(x.order_comments) AS hold
FROM public.as400_captures c
CROSS JOIN LATERAL (SELECT public.as400_order_comments(c.raw_text) AS order_comments) x
WHERE (
        c.status NOT IN ('junk', 'archived', 'sent')
        -- A hold is supposed to wait: the aging that archives junk must not take it.
        OR (c.status = 'archived' AND public.order_note_hold(x.order_comments) IS NOT NULL)
      )
  AND NOT EXISTS (
    SELECT 1
    FROM public.picking_lists pl
    WHERE pl.order_number = c.order_number
       OR c.order_number = ANY (string_to_array(pl.order_number, ' / '))
  );

COMMENT ON VIEW public.v_as400_door IS
  'AS400 captures the board can offer: not junk, not sent, not archived unless the Order '
  'Comments put it on hold, and with no picking_lists row that already carries the number '
  '(exact or as a merged member). raw_text is left out; order_comments and hold come from it. '
  '20260911161528.';

-- ── Validation: the case table, the same as HOLD_CASES in the TS test ─────
DO $$
DECLARE
  r record;
  got text;
  bad text := '';
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('HOLD FOR ADDS', 'ADDS'),
      ('HOLD FOR ADDS MONDAY', 'ADDS'),
      ('DO NOT SHIP. HOLD FOR ADD', 'ADDS'),
      ('PLEASE HOLD FOR PREORDER ADDS', 'ADDS'),
      ('WAITING FOR ADDS', 'ADDS'),
      ('HOLD FOR ADDS PICK-UP ORDER', 'ADDS'),
      ('HOLD FOR ADDS [User Cancelled]', 'ADDS'),
      ('SHIP WITH REN', 'REN'),
      ('SHIP WITH REN PO# JAM61A', 'REN'),
      ('Ship with Renegades', 'REN'),
      ('HOLD FOR CONFIRM', 'CONF'),
      ('HOLD FOR CONFIRMATION', 'CONF'),
      ('ORDER HOLD PENDING PAYMENT', 'PAY'),
      ('EP 20% OFF HOLD FOR CC INFO', 'PAY'),
      ('HOLD WITH CITIZEN 2 STS', 'CITIZEN'),
      ('HOLD FOR CITIZEN 2 S/T', 'CITIZEN'),
      ('SHIP W/CITIZEN 2 S/T', 'CITIZEN'),
      ('SHIP W/ HUDSON E1 HOLD', 'HUDSON'),
      ('SHIP W/LASERS', 'LASER'),
      ('SAMPLE BIKES ----SHIP WITH VENTURA!', 'VENTURA'),
      ('SHIP W/ ALL ACCESS BIKE', 'ALL ACCESS'),
      ('HOLD FOR DIVIDES', 'DIVIDES'),
      ('HOLD TO SHIP WITH ALLOCATIONS', 'HOLD'),
      ('HOLD', 'HOLD'),
      ('PLEASE BUILD AND HOLD FORMICHELE THX', 'HOLD'),
      ('Hold for missing bike', 'HOLD'),
      ('DO NOT SHIP BEFORE 8/25', 'HOLD'),
      ('DO NOT SHIP DEALER PICK UP', NULL),
      ('DO NOT SHIP HAMISH DROP OFF', NULL),
      ('SHIP W/ 881424', NULL),
      ('SHIP WITH 881418', NULL),
      ('SHIP W/ 881416,881348', NULL),
      ('SHIP WITH ORDER 457414', NULL),
      ('NET 30 SHIP WITH PARTS ORDER', NULL),
      ('OKAY TO SHIP', NULL),
      ('FREE FREIGHT', NULL),
      ('CLOSED MONDAYS', NULL),
      ('this order is not a pick up, wrong notes were inputed here.', NULL),
      ('User Cancelled', NULL),
      ('', NULL)
    ) AS v(note, expected)
  LOOP
    got := public.order_note_hold(r.note);
    IF got IS DISTINCT FROM r.expected THEN
      bad := bad || format(E'\n  %L → %s (expected %s)', r.note, coalesce(got, 'NULL'), coalesce(r.expected, 'NULL'));
    END IF;
  END LOOP;

  IF public.as400_order_comments(E'Terms: NET\nOrder Comments: HOLD FOR ADDS          \nX') IS DISTINCT FROM 'HOLD FOR ADDS' THEN
    bad := bad || E'\n  as400_order_comments: plain line';
  END IF;
  IF public.as400_order_comments('Order Comments: SEE EMAIL   Cmd5 Cmd6=Refresh') IS DISTINCT FROM 'SEE EMAIL' THEN
    bad := bad || E'\n  as400_order_comments: legend';
  END IF;
  IF public.as400_order_comments(E'Order Comments:          \nNext') IS NOT NULL
     OR public.as400_order_comments('no comments here') IS NOT NULL THEN
    bad := bad || E'\n  as400_order_comments: empty';
  END IF;

  IF bad <> '' THEN
    RAISE EXCEPTION 'order_note_hold / as400_order_comments disagree with the case table:%', bad;
  END IF;
END;
$$;

COMMIT;
