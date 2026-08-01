-- Parts weigh 1 lb by default, not 45.
--
-- `sku_metadata.weight_lbs` has carried a column DEFAULT of 45 since
-- 20260318000002 — the weight of a boxed bicycle, applied to every SKU
-- including pedals. 1,376 of the 1,387 parts sit at exactly 45, so the
-- shipment weights on the Ship screen have been adding a bike per part.
--
-- idea-025 (20260403210000) already tried to fix this, but it keyed on
-- `length_in = 54` — the older of the two dimension defaults — so everything
-- registered after the defaults changed to 55 was missed. That is why the E47
-- pedals still read 45 lbs. This one keys on the weight itself.
--
-- Three different answers existed for "what does a part weigh by default":
-- 0 (ItemDetailView), 0.1 (ShipScreen), 45 (inventory.service and the column
-- default). The trigger below becomes the single authority; the frontend
-- mirrors it in src/utils/skuDefaults.ts for pre-filling forms, and the two
-- must be kept in sync.
--
-- Safe for shipping classification: classify_picking_list_fedex routes on
-- `weight_lbs > 50`, and both 45 and 1 are under it, so no order changes lane.

-- Backfill: parts still carrying the bike default. Parts with any other value
-- were either measured or set by hand — left alone.
UPDATE public.sku_metadata
SET weight_lbs = 1
WHERE is_bike = false
  AND weight_lbs = 45;

-- A column default cannot depend on is_bike, and while one exists NULL never
-- reaches the trigger, so the trigger could never decide. Drop all three.
--
-- length_in and width_in carried defaults of 5 and 6 — neither a bicycle nor
-- anything else in particular. They are the reason a freshly registered SKU
-- came out 5 inches long: the trigger's dimension logic below was unreachable
-- until these went away.
ALTER TABLE public.sku_metadata ALTER COLUMN weight_lbs DROP DEFAULT;
ALTER TABLE public.sku_metadata ALTER COLUMN length_in DROP DEFAULT;
ALTER TABLE public.sku_metadata ALTER COLUMN width_in DROP DEFAULT;

-- One place decides what an unmeasured SKU weighs and measures.
CREATE OR REPLACE FUNCTION public.set_is_bike_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Unchanged: only fills when the caller said nothing, so an explicit choice
  -- at registration always wins.
  IF NEW.is_bike IS NULL THEN
    NEW.is_bike := LEFT(NEW.sku, 2) IN ('01','02','03','06','07');
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
$function$;

COMMENT ON COLUMN public.sku_metadata.weight_lbs IS
  'Peso en libras. Sin valor explicito lo pone el trigger tr_sku_metadata_set_is_bike segun el tipo: bike 45, part 1. Espejo en TS: src/utils/skuDefaults.ts — mantener ambos en sync. classify_picking_list_fedex rutea a Regular con > 50.';
