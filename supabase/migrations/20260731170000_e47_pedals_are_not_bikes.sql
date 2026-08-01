-- E47 holds pedals, not bikes.
--
-- Five SKUs in the E47 parts bin are flagged `is_bike = true`, so they are
-- counted as bikes everywhere: the stats, the pallet math (bikes paginate by
-- capacity, parts ride in one pallet), the label view, the FedEx lane rule.
--
-- They read as bikes because the item_name is the bike the pedal *belongs to* —
-- "LASER 16 MEAN GREEN" is the pedal for that model, not the bicycle. Nothing in
-- the record contradicts it either: weight_lbs 45 and length_in 55 are the
-- registration defaults, not measurements. The classification came from the
-- `LEFT(sku,2) IN ('01','02',...)` trigger, which is right for the 120 other
-- 01-/02- SKUs that really are bikes and wrong for these.
--
-- So the name gets the part in it. A pedal named after a bike model will be
-- mistaken for that bike again otherwise — this file exists because it already
-- happened. PEDAL goes first so it is the first thing read in any list.

UPDATE public.inventory
SET item_name = 'PEDAL ' || regexp_replace(COALESCE(item_name, ''), '^[`''"\s]+', '')
WHERE sku IN ('01-8771SL', '01-8798BK', '01-8803GN', '02-2404BL', '02-5352WH')
  AND COALESCE(item_name, '') NOT ILIKE 'PEDAL %';

UPDATE public.sku_metadata
SET is_bike = false
WHERE sku IN ('01-8771SL', '01-8798BK', '01-8803GN', '02-2404BL', '02-5352WH')
  AND is_bike IS DISTINCT FROM false;

-- Not touched, on purpose:
--   The trigger keeps 01-/02- as bike prefixes. 139 SKUs start with 01- and 107
--   of them have lived in a ROW; 20 start with 02- and 13 have. Dropping those
--   prefixes to catch five pedals would misclassify roughly 120 real bikes.
--   The fix for the root cause is making the operator choose at registration,
--   which the trigger already allows for: it only fills `is_bike` when NULL, so
--   an explicit choice always wins and needs no change here.
