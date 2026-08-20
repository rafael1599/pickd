-- dimensions_verified: does this SKU's box come from a tape measure, or from a default?
--
-- The FedEx export must never send a default carton -- it would overwrite a
-- verified row in Ship Manager with a number nobody measured. Until now the only
-- way to tell them apart was to match the default values themselves, and there
-- are four of them, not one:
--
--   55 x 8.5 x 30.5 @ 45 lb   the live trigger default          144 SKUs
--   54 x 8 x 30     @ 45 lb   a legacy default                  474 SKUs
--   5 x 6 (x NULL or x 30)    the dead column defaults           63 SKUs
--   0 x 0 x 0                 the parts default, on 3 bikes       3 SKUs
--
-- Matching on values fails in the direction that costs money: a carton that
-- genuinely measures 54 x 8 x 30 is indistinguishable from one nobody touched,
-- so a real measurement gets silently dropped from the export.
--
-- The sentinel alternative -- storing 55.0001 so the default is recognisable --
-- was considered and rejected. ItemDetailView.executeSave rewrites the whole
-- metadata row on every save, including dimensions the user never touched, and
-- the form loads the stored value. Either the operator sees 55.0001 in the
-- Length box, or it is rounded for display and the next save of that item for
-- any reason at all -- a quantity change, a note -- writes 55 back and silently
-- promotes an unmeasured SKU into the export. PublicTagView and StockCountScreen
-- also interpolate the raw number, so it would have been visible in two more
-- places. A column survives rounding, CSV round-trips and bulk updates; the
-- fourth decimal does not.
--
-- The good idea in the sentinel was that it clears itself: change the dimension
-- and it stops being a default, with nobody having to remember a checkbox. That
-- property is kept here by the trigger below, which keys off an actual change of
-- value rather than a form submit -- so saving an item for an unrelated reason
-- does not falsely mark it verified.

BEGIN;

ALTER TABLE public.sku_metadata
  ADD COLUMN IF NOT EXISTS dimensions_verified boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.sku_metadata.dimensions_verified IS
  'True when length/width/height were actually measured rather than filled by the '
  'default trigger. Set automatically whenever a dimension changes value. The '
  'FedEx Ship Manager export ships only verified rows; everything else goes to '
  'the exceptions report.';

-- Any change to a dimension is a measurement. Never sets false: un-verifying is
-- an explicit act, and a caller can still write false in the same statement as
-- long as it is not also changing a dimension.
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
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_sku_metadata_dimensions_verified ON public.sku_metadata;
CREATE TRIGGER tr_sku_metadata_dimensions_verified
  BEFORE UPDATE ON public.sku_metadata
  FOR EACH ROW
  EXECUTE FUNCTION public.set_dimensions_verified();

-- On INSERT the answer is decided inside the existing defaults trigger, where it
-- is unambiguous: whatever the caller supplied before COALESCE filled the gaps.
-- Putting it here rather than in a second BEFORE INSERT trigger avoids depending
-- on trigger firing order, which is alphabetical by name and easy to break with
-- a rename. Body is otherwise unchanged from 20260731190000.
CREATE OR REPLACE FUNCTION public.set_is_bike_on_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Unchanged: only fills when the caller said nothing, so an explicit choice
  -- at registration always wins.
  IF NEW.is_bike IS NULL THEN
    NEW.is_bike := LEFT(NEW.sku, 2) IN ('01','02','03','06','07');
  END IF;

  -- New: a caller that supplied all three dimensions measured them. Read before
  -- the COALESCE below fills the missing ones with defaults.
  IF NEW.length_in IS NOT NULL
     AND NEW.width_in IS NOT NULL
     AND NEW.height_in IS NOT NULL
  THEN
    NEW.dimensions_verified := true;
  END IF;

  -- Defaults follow the resolved type. A bike gets its boxed dimensions; a part
  -- gets 1 lb and no dimensions, because a pedal in a bike-sized box is what
  -- made every parts shipment weigh like a truckload of bicycles.
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

-- The 172 bike SKUs measured on the floor between Aug 12 and Aug 20 2026 --
-- 20260814120000 (new factories), 20260814160000 (Highpoint A1),
-- 20260814180000 (DXT A3 / Renegade LTD), 20260814200000 (Durango), plus the
-- rows that already carried hand-entered measurements. Listed explicitly rather
-- than derived by "not equal to a default", which is the test this column exists
-- to replace.
UPDATE sku_metadata SET dimensions_verified = true WHERE sku IN (
    '01-0513',
    '03-2540WH',
    '03-3058CL',
    '03-3060CL',
    '03-3062CL',
    '03-3382BK',
    '03-3502BL',
    '03-3516BL',
    '03-3604BL',
    '03-3606BL',
    '03-3607GY',
    '03-3726RD',
    '03-3731GY',
    '03-3732BL',
    '03-3733GY',
    '03-3734BL',
    '03-3735GY',
    '03-3738BK',
    '03-3746GY',
    '03-3769BL',
    '03-3769BLD',
    '03-3781BL',
    '03-3789BL',
    '03-3810GN',
    '03-3828GY',
    '03-3854GY',
    '03-3861BK',
    '03-3868BL',
    '03-3869BL',
    '03-3870BL',
    '03-3871BL',
    '03-3872BL',
    '03-3873BL',
    '03-3882BK',
    '03-3885BK',
    '03-3895BL',
    '03-3905BL',
    '03-3906GY',
    '03-3908GY',
    '03-3927BK',
    '03-3934MN',
    '03-3966BL',
    '03-3993PD',
    '03-3995PD',
    '03-3997PD',
    '03-3999PD',
    '03-4046MN',
    '03-4059PD',
    '03-4075BL',
    '03-4207BR',
    '03-4209GY',
    '03-4211GY',
    '03-4213GY',
    '03-4227BL',
    '03-4230BL',
    '03-4231BL',
    '03-4251BK',
    '03-4257BL',
    '03-4259BL',
    '03-4266BK',
    '03-4267GN',
    '03-4268BK',
    '03-4270BK',
    '03-4272BK',
    '03-4276BK',
    '03-4277GN',
    '03-4369BL',
    '03-4370BL',
    '03-4371BL',
    '03-4372BL',
    '03-4448BK',
    '03-4450BK',
    '03-4456BL',
    '03-4457GN',
    '03-4458GN',
    '03-4460GN',
    '03-4461GN',
    '03-4462GN',
    '03-4466BR',
    '03-4467BR',
    '03-4468BR',
    '03-4512GY',
    '03-4515GY',
    '03-4536BL',
    '03-4545MN',
    '03-4582BL',
    '03-4583GY',
    '03-4585BL',
    '03-4586GY',
    '03-4588BL',
    '03-4589GY',
    '03-4591BL',
    '03-4592GY',
    '03-4606BL',
    '03-4607BL',
    '03-4608BL',
    '03-4609BL',
    '03-4610BK',
    '03-4611BK',
    '03-4612BK',
    '03-4613BK',
    '03-4614BK',
    '03-4615BK',
    '03-4616BK',
    '03-4617BK',
    '03-4618GN',
    '03-4619GN',
    '03-4620GN',
    '03-4621GN',
    '03-4623BL',
    '03-4626BR',
    '03-4627BR',
    '03-4628BR',
    '03-4629BR',
    '03-4630GY',
    '03-4631GY',
    '03-4632GY',
    '03-4633GY',
    '03-4634RD',
    '03-4635MN',
    '03-4637MN',
    '03-4638RD',
    '03-4639MN',
    '03-4664BR',
    '03-4664YL',
    '03-4665GN',
    '03-4691GY',
    '03-4692GY',
    '03-4693GY',
    '03-4694GY',
    '03-4695GY',
    '03-4805RD',
    '03-4806BK',
    '03-4807RD',
    '03-4808BK',
    '03-4809RD',
    '03-4810BK',
    '03-4811RD',
    '03-4812BK',
    '03-4813RD',
    '03-4814BK',
    '03-4889GY',
    '06-4293MG',
    '06-4297RD',
    '06-4430RB',
    '06-4432BK',
    '06-4448WH',
    '06-4450BL',
    '06-4451BK',
    '06-4453BL',
    '06-4455SL',
    '06-4456BL',
    '06-4473TL',
    '06-4507BK',
    '06-4562BL',
    '06-4565BL',
    '06-4566VL',
    '06-4572GY',
    '06-4573GY',
    '06-4590BL',
    '06-4606OR',
    '06-4608MN',
    '06-4614GN',
    '06-4615GN',
    '06-4617RD',
    '06-4641BK',
    '07-3529BL',
    '07-3606GP',
    '07-3674GY',
    '09-4827CL',
    '09-4828CL',
    '09-4829CL'
);

COMMIT;
