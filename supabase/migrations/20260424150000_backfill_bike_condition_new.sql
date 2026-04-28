-- Data migration (idea-086).
--
-- Goal: mark all non-S/D bikes as condition='new' so the Details card shows
-- a meaningful value out of the box. Also fix 4 rows mis-classified as bikes
-- (they're actually pedals → parts).
--
-- Exclusions reviewed with the user:
--
--   Parts mis-tagged as bikes (corrected to is_bike=false, NOT marked 'new'):
--     01-8264BK  NIRVE SAVANNAH PEDALS
--     01-8808BK  X26 DICS PEDALS
--     01-8809WH  LADY BUG WHITE BIKE PEDALS
--     03-0100RB  EXPLORER 2003 12 PEDAL
--
--   Malformed / UPC-as-SKU rows (left untouched — investigate separately):
--     022648OR  023680GY  023683GN  033768BLD  033769BLD  034070BL  792284968385
--
-- Everything else with is_bike=true AND is_scratch_dent IS NOT TRUE AND the
-- condition column NULL/empty gets 'new'.

-- Step 0: drop the legacy CHECK constraint that restricted `condition` to
-- the old S/D-only enum values (new_unbuilt, new_built, ridden_demo,
-- returned, defective_frame). idea-083 already relaxed the Zod schema to
-- free-form text; the DB needs to match so the new generalized values
-- (new, used, damaged, refurbished) are accepted.
ALTER TABLE public.sku_metadata
  DROP CONSTRAINT IF EXISTS sku_metadata_condition_check;

-- Step 1: reclassify mis-tagged parts.
UPDATE public.sku_metadata
SET is_bike = false
WHERE sku IN (
  '01-8264BK',
  '01-8808BK',
  '01-8809WH',
  '03-0100RB'
);

-- Step 2: backfill condition='new' for the rest.
-- Idempotent — the WHERE clause skips rows that already have a value.
UPDATE public.sku_metadata
SET condition = 'new'
WHERE is_bike = true
  AND (is_scratch_dent IS NULL OR is_scratch_dent = false)
  AND (condition IS NULL OR condition = '')
  AND sku NOT IN (
    -- Excluded: malformed SKUs / UPC-as-SKU.
    '022648OR',
    '023680GY',
    '023683GN',
    '033768BLD',
    '033769BLD',
    '034070BL',
    '792284968385'
  );
