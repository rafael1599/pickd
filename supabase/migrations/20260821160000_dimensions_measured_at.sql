-- When was this carton last measured, and had FedEx been told by then?
--
-- `dimensions_verified` answers "did somebody measure this box", which was the
-- right question for the export -- it decides what may go in the file. It is
-- the wrong question for the warning on the double-check screen, and today
-- showed why: 20260821120000 corrected 33 cartons, and the most recent export
-- ran forty minutes before it. Every one of those SKUs is `verified`, so the
-- warning stayed quiet, while Ship Manager went on quoting the carton the tape
-- had just disproved. "Measured" and "FedEx knows" are not the same fact.
--
-- So the measurement gets a timestamp, and the export log already has one. FedEx
-- has a SKU's current carton when it was measured no later than the last export
-- ran. One comparison, one answer, and the warning and the export now read the
-- same source instead of each holding an opinion.
--
-- The export itself is unchanged: it still ships everything measured, stale or
-- not, because Replace current data means the file must always carry the whole
-- catalogue. Staleness only decides who gets warned.

BEGIN;

ALTER TABLE public.sku_metadata
  ADD COLUMN IF NOT EXISTS dimensions_measured_at timestamptz;

COMMENT ON COLUMN public.sku_metadata.dimensions_measured_at IS
  'When a dimension last changed value. Compared against the most recent row in '
  'fedex_dimension_exports to tell whether Ship Manager has this carton yet. '
  'NULL means never measured, same as dimensions_verified = false.';

-- Stamped by the same trigger that sets dimensions_verified, for the same
-- reason: it keys off an actual change of value, so saving an item for an
-- unrelated reason does not restamp a carton nobody touched. Body otherwise
-- unchanged from 20260820170000.
CREATE OR REPLACE FUNCTION public.set_dimensions_verified()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.length_in IS DISTINCT FROM OLD.length_in
     OR NEW.width_in  IS DISTINCT FROM OLD.width_in
     OR NEW.height_in IS DISTINCT FROM OLD.height_in
  THEN
    NEW.dimensions_verified := true;
    NEW.dimensions_measured_at := now();
  END IF;
  RETURN NEW;
END;
$$;

-- INSERT side, decided inside the defaults trigger where "did the caller supply
-- all three" is already known. Body otherwise unchanged from 20260820170000.
CREATE OR REPLACE FUNCTION public.set_is_bike_on_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_bike IS NULL THEN
    NEW.is_bike := LEFT(NEW.sku, 2) IN ('01','02','03','06','07');
  END IF;

  IF NEW.length_in IS NOT NULL
     AND NEW.width_in IS NOT NULL
     AND NEW.height_in IS NOT NULL
  THEN
    NEW.dimensions_verified := true;
    NEW.dimensions_measured_at := COALESCE(NEW.dimensions_measured_at, now());
  END IF;

  IF NEW.weight_lbs IS NULL THEN
    NEW.weight_lbs := CASE WHEN NEW.is_bike THEN 45 ELSE 1 END;
  END IF;

  IF NEW.is_bike THEN
    NEW.length_in := COALESCE(NEW.length_in, 55);
    NEW.width_in  := COALESCE(NEW.width_in, 8.5);
    NEW.height_in := COALESCE(NEW.height_in, 30.5);
  ELSE
    NEW.length_in := COALESCE(NEW.length_in, 0);
    NEW.width_in  := COALESCE(NEW.width_in, 0);
    NEW.height_in := COALESCE(NEW.height_in, 0);
  END IF;

  RETURN NEW;
END;
$$;

-- Backfill, in two passes, because the two groups are genuinely different.
--
-- Everything measured before today was in the export that ran on 2026-08-20 --
-- 124 records, the same count the two runs on the 21st reported, which is how
-- we know nothing changed between them. Those are stamped a second before that
-- export so they read as "FedEx has it".
UPDATE sku_metadata
SET dimensions_measured_at = timestamptz '2026-08-20 20:22:28+00'
WHERE dimensions_verified AND dimensions_measured_at IS NULL;

-- The 33 cartons 20260821120000 corrected, plus nothing else, were measured
-- after the last export ran. They are stamped now() so they read as stale --
-- which they are, and which is the whole point of the column.
UPDATE sku_metadata
SET dimensions_measured_at = now()
WHERE sku IN (
    '03-3769BL','03-3769BLD','03-3847BK','03-3847BL','03-3869BL','03-3871BL',
    '03-3905BL','03-3906GY','03-3966BL','03-4277GN','03-4585BL','03-4586GY',
    '03-4588BL','03-4589GY','03-4592GY','03-4607BL','03-4609BL','03-4611BK',
    '03-4612BK','03-4613BK','03-4616BK','03-4618GN','03-4621GN','03-4623BL',
    '03-4626BR','03-4638RD','03-4639MN','03-4693GY','03-4807RD','03-4808BK',
    '03-4809RD','03-4813RD','03-4814BK'
);

-- When the Dimensions table was last refreshed from Pickd.
--
-- SECURITY DEFINER because fedex_dimension_exports is admin-only for read, and
-- has to stay that way -- it names who exported. The warning runs for whoever
-- is at the double-check station, and all it needs is the one timestamp, so
-- that is all this returns.
CREATE OR REPLACE FUNCTION public.fedex_dimensions_exported_at()
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT max(exported_at) FROM public.fedex_dimension_exports;
$$;

COMMENT ON FUNCTION public.fedex_dimensions_exported_at() IS
  'Timestamp of the most recent FedEx Dimensions export, or NULL if none ran. '
  'Readable by any authenticated user; the export log itself stays admin-only.';

REVOKE ALL ON FUNCTION public.fedex_dimensions_exported_at() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fedex_dimensions_exported_at() TO authenticated;

COMMIT;
