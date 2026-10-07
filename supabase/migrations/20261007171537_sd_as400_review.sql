-- ============================================================================
-- AS400 review: what someone has to change in AS400 for the S/D on the floor
-- (idea-257 P3, Rafael 7 Oct 2026; docs/prds/sd-units-reuse.md §5.4). PickD
-- cannot write AS400; it says what to type there. Printed 4×6 like History's
-- AS400 Sync.
--
-- Three kinds of line, S/D in stock in LUDLOW only:
--   CREATE  an 01- number taken from the never-used pool (sd_sku_probes) or
--           that AS400 answered «no such number» for: it has to be created.
--   UPDATE  AS400's description ends in a serial that is not the box's:
--           OLD UNIT = it is the serial of a bike archived from that SKU
--           (sd_units), ≈ = one or two characters off (a typo on one side),
--           otherwise another bike. PickD with no real serial says so.
-- «Done in AS400» (sd_as400_done) clears what the watchdog read, so it reads
-- the SKU again: a fixed line goes away by itself and an unfixed one comes
-- back. A CREATE line is hidden by the same stamp (the watchdog keeps its own
-- list of numbers AS400 lacked and does not re-ask them).
-- ============================================================================

ALTER TABLE public.sku_metadata ADD COLUMN IF NOT EXISTS as400_checked_at timestamptz;
COMMENT ON COLUMN public.sku_metadata.as400_checked_at IS
  'When someone marked this SKU done in AS400 from the S/D AS400 review (sd_as400_done).';

-- Levenshtein distance for two short codes (serials). No extension needed.
CREATE OR REPLACE FUNCTION public.short_edit_distance(a text, b text)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  la int := length(a);
  lb int := length(b);
  prev int[];
  cur int[];
  i int;
  j int;
BEGIN
  IF a IS NULL OR b IS NULL THEN RETURN NULL; END IF;
  IF la > 40 OR lb > 40 THEN RETURN abs(la - lb) + 3; END IF;
  prev := array(SELECT g FROM generate_series(0, lb) g);
  FOR i IN 1..la LOOP
    cur := array[i] || array_fill(0, array[lb]);
    FOR j IN 1..lb LOOP
      cur[j + 1] := least(prev[j + 1] + 1, cur[j] + 1,
                          prev[j] + CASE WHEN substr(a, i, 1) = substr(b, j, 1) THEN 0 ELSE 1 END);
    END LOOP;
    prev := cur;
  END LOOP;
  RETURN prev[lb + 1];
END;
$function$;

CREATE OR REPLACE VIEW public.v_sd_as400_review
WITH (security_invoker = true) AS
WITH live AS (
  SELECT m.sku, m.sd_number, m.serial_number, m.as400_description, m.as400_read_at,
         m.as400_absent_at, m.as400_checked_at,
         (SELECT i.item_name FROM public.inventory i
           WHERE i.sku = m.sku AND i.quantity > 0 ORDER BY i.quantity DESC LIMIT 1) AS item_name,
         upper(regexp_replace(COALESCE(m.serial_number, ''), '[^A-Za-z0-9]', '', 'g')) AS pickd_serial,
         -- The serial AS400 keeps at the end of an S/D's description: a word of
         -- 8+ with at least one digit (CHARCOAL is a colour, not a serial).
         (SELECT CASE WHEN w ~ '[0-9]' AND length(w) >= 8 THEN w END
            FROM (SELECT upper(substring(m.as400_description from '([A-Za-z0-9]+)\s*$')) AS w) x) AS as400_serial,
         EXISTS (SELECT 1 FROM public.sd_sku_probes p WHERE p.sku = m.sku) AS from_pool
    FROM public.sku_metadata m
   WHERE m.unit_kind = 'sd'
     AND EXISTS (SELECT 1 FROM public.inventory i
                  WHERE i.sku = m.sku AND i.quantity > 0
                    AND COALESCE(i.warehouse, 'LUDLOW') = 'LUDLOW')
),
lines AS (
  SELECT l.*, 'CREATE'::text AS action, NULL::text AS reason
    FROM live l
   WHERE l.sku ~ '^01-[0-9]{4}$'
     AND (l.as400_absent_at IS NOT NULL OR (l.from_pool AND l.as400_description IS NULL))
  UNION ALL
  SELECT l.*, 'UPDATE',
         CASE
           WHEN EXISTS (SELECT 1 FROM public.sd_units u
                         WHERE u.sku = l.sku AND upper(u.serial_number) = l.as400_serial)
             THEN 'OLD UNIT'
           WHEN EXISTS (SELECT 1 FROM public.sku_metadata o
                         WHERE o.sku <> l.sku AND upper(o.serial_number) = l.as400_serial)
             THEN 'SERIAL OF ' || (SELECT COALESCE('#' || public.sd_code(o.sd_number), o.sku)
                                     FROM public.sku_metadata o
                                    WHERE o.sku <> l.sku AND upper(o.serial_number) = l.as400_serial
                                    LIMIT 1)
           WHEN l.pickd_serial = '' OR l.pickd_serial = upper(regexp_replace(l.sku, '[^A-Za-z0-9]', '', 'g'))
             THEN 'PICKD HAS NO SERIAL'
           WHEN public.short_edit_distance(l.pickd_serial, l.as400_serial) <= 2 THEN 'TYPO'
           ELSE 'OTHER BIKE'
         END
    FROM live l
   WHERE l.sku ~ '^01-'
     AND l.as400_serial IS NOT NULL
     AND l.as400_serial <> l.pickd_serial
)
SELECT sku, sd_number, item_name, serial_number, as400_description, as400_serial,
       action, reason, as400_read_at, as400_checked_at
  FROM lines
 WHERE as400_checked_at IS NULL
    OR as400_checked_at < COALESCE(as400_read_at, '-infinity'::timestamptz);

GRANT SELECT ON public.v_sd_as400_review TO authenticated;

-- «Done in AS400»: stamp it, and hand the SKU back to the watchdog to read
-- again (as400_description NULL is what puts it in the queue).
CREATE OR REPLACE FUNCTION public.sd_as400_done(p_sku text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL AND current_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'not authenticated' USING errcode = '42501';
  END IF;
  UPDATE public.sku_metadata
     SET as400_checked_at = now(),
         as400_description = CASE WHEN as400_absent_at IS NULL THEN NULL ELSE as400_description END,
         as400_read_at = CASE WHEN as400_absent_at IS NULL THEN NULL ELSE as400_read_at END,
         as400_snapshot = CASE WHEN as400_absent_at IS NULL THEN NULL ELSE as400_snapshot END
   WHERE sku = p_sku AND unit_kind = 'sd';
END;
$function$;
REVOKE ALL ON FUNCTION public.sd_as400_done(text) FROM public;
GRANT EXECUTE ON FUNCTION public.sd_as400_done(text) TO authenticated, service_role;
