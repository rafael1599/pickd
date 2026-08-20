-- picking_list_notes: tell apart what a person wrote from what the system recorded.
--
-- 24% of this table (95 of 389 rows in prod) is structured data smuggled inside
-- free text: '[Waiting]: …', '[Parked]: 14D', '[AUTO] Stale pick location: …',
-- '[Resumed from waiting]'. Five writers invented five formats — '[AUTO]' without
-- the colon the rest use — and every reader grew its own parser: useParkedLocations
-- runs an ILIKE query of its own, useStaleLocationCheck keeps a prefix constant,
-- the Ship screen reads a pallet count back out of prose with a regex. The next
-- tag would have brought a fourth parser.
--
-- `kind` is that classification, decided ONCE, here. `metadata` holds whatever the
-- tag was carrying, so no reader has to parse prose again.
--
-- The derivation lives in a BEFORE INSERT trigger rather than inside the four RPCs
-- that write these notes, for two reasons:
--   1. Those RPCs stay untouched, so their bodies cannot drift from this rule.
--   2. The client keeps inserting `message` alone — it never names the new columns
--      on a write, so the frontend can deploy before OR after this migration with
--      no window where inserts 400. (See the post-merge migration checklist in
--      CLAUDE.md for why that window is a real hazard here.)
--
-- Same contract as tr_sku_metadata_set_is_bike: the trigger only fills what came in
-- NULL, so an explicit value always wins.

ALTER TABLE public.picking_list_notes
  ADD COLUMN IF NOT EXISTS kind text,
  ADD COLUMN IF NOT EXISTS metadata jsonb;

COMMENT ON COLUMN public.picking_list_notes.kind IS
  'What kind of system note this is, or NULL when a person wrote it. NULL is the '
  'signal the one-line preview keys off: human notes preview, system notes do not.';
COMMENT ON COLUMN public.picking_list_notes.metadata IS
  'Whatever the note tag was carrying (parked location, waiting reason, pallet '
  'count), so readers never parse it back out of the message text.';

-- The single classifier. Mirrored in TS by src/utils/systemNotes.ts, which reads
-- `kind` when it is there and falls back to these same prefixes when it is not
-- (rows written by a client older than this migration). This is the authority.
CREATE OR REPLACE FUNCTION public.classify_picking_note(p_message text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_message LIKE '[Waiting]:%' THEN jsonb_build_object(
      'kind', 'waiting',
      'metadata', jsonb_build_object('reason', NULLIF(btrim(substring(p_message from 11)), '')))
    WHEN p_message LIKE '[Resumed from waiting]%' THEN
      jsonb_build_object('kind', 'resumed_from_waiting', 'metadata', NULL)
    WHEN p_message LIKE '[Cancelled from waiting]%' THEN
      jsonb_build_object('kind', 'cancelled_from_waiting', 'metadata', NULL)
    WHEN p_message LIKE '[Parked]:%' THEN jsonb_build_object(
      'kind', 'parked',
      'metadata', jsonb_build_object('location', NULLIF(btrim(substring(p_message from 10)), '')))
    WHEN p_message LIKE '[AUTO]%' THEN
      jsonb_build_object('kind', 'auto_stale_location', 'metadata', NULL)
    WHEN p_message LIKE '[Daylight]:%' THEN jsonb_build_object(
      'kind', 'daylight_pickup_sms',
      'metadata', jsonb_build_object(
        'pallets', NULLIF(substring(p_message from '(\d+)\s*pallets?'), '')::int))
    ELSE NULL
  END;
$$;

ALTER FUNCTION public.classify_picking_note(text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tg_set_picking_note_kind()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_classified jsonb;
BEGIN
  -- An explicit kind always wins.
  IF NEW.kind IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_classified := public.classify_picking_note(NEW.message);
  IF v_classified IS NOT NULL THEN
    NEW.kind := v_classified ->> 'kind';
    NEW.metadata := COALESCE(NEW.metadata, NULLIF(v_classified -> 'metadata', 'null'::jsonb));
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.tg_set_picking_note_kind() OWNER TO postgres;

DROP TRIGGER IF EXISTS tr_picking_list_notes_set_kind ON public.picking_list_notes;
CREATE TRIGGER tr_picking_list_notes_set_kind
  BEFORE INSERT ON public.picking_list_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_set_picking_note_kind();

-- Backfill. Dry-run against prod classified all 95 tagged rows and left the 294
-- human ones alone, with zero bracketed messages falling through.
UPDATE public.picking_list_notes
   SET kind     = public.classify_picking_note(message) ->> 'kind',
       metadata = NULLIF(public.classify_picking_note(message) -> 'metadata', 'null'::jsonb)
 WHERE kind IS NULL
   AND public.classify_picking_note(message) IS NOT NULL;

-- useParkedLocations stops scanning the table with ILIKE '[Parked]:%' and filters
-- on kind instead; the partial index keeps that cheap and skips the human notes,
-- which are the majority.
CREATE INDEX IF NOT EXISTS idx_picking_list_notes_kind
  ON public.picking_list_notes (kind)
  WHERE kind IS NOT NULL;
