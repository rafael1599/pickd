-- "Somebody took this off the box" is something only the writer knows.
--
-- `set_dimensions_verified` inferred it from the values changing:
--
--     IF NEW.length_in IS DISTINCT FROM OLD.length_in OR ... THEN verified := true
--
-- which is right almost always and silently wrong in exactly the case the flag
-- exists for. Measure a carton, find it is 55 x 8.5 x 30.5 -- the trigger's own
-- default for a boxed bicycle, and a perfectly ordinary reading -- save it, and
-- the UPDATE changes nothing, so the flag stays false, `dimensions_measured_at`
-- stays NULL, and the box drops straight back into the unmeasured queue and out
-- of the FedEx file. The operator did the work and Pickd threw the fact away.
-- Verified against prod: re-saving a row's own numbers leaves it false; changing
-- one digit turns it true. The legacy default 54 x 8 x 30 is on 474 SKUs and is
-- round enough that a tape lands on it regularly.
--
-- So the forms that exist to record a measurement now say so, and the trigger
-- honours them. Three rules, in this order:
--
--   1. A value changed  -> verified (unchanged behaviour, still the common path).
--   2. The writer said `verified = true` -> verified, and stamped.
--   3. Never lowered. A row that was verified stays verified whatever a later
--      write leaves in the field -- `ItemDetailView` rewrites the whole metadata
--      row on every save, and without this an unrelated edit could carry a stale
--      `false` back over a real measurement.
--
-- Nothing that does not send the flag changes: `ItemDetailView` does not send
-- it, so it behaves exactly as before.
--
-- Weight gets the same treatment and its own column. It had no flag at all, so
-- 45 lbs on a bike could not be told apart from 45 lbs meaning "nobody weighed
-- it" -- and 241 of the 264 bikes on hand sit on that number. That weight is
-- what Ship totals into the figure the station types into Audit Source, so it
-- is not a cosmetic distinction.

ALTER TABLE public.sku_metadata
  ADD COLUMN IF NOT EXISTS weight_verified boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.sku_metadata.weight_verified IS
  'True when a scale was involved. Set by tr_sku_metadata_dimensions_verified '
  'on a value change or an explicit true from a form that just weighed the box; '
  'never lowered. Distinguishes a real 45 lbs from the trigger default.';

-- 1. UPDATE: the three rules above, for both facts.
CREATE OR REPLACE FUNCTION public.set_dimensions_verified()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.length_in IS DISTINCT FROM OLD.length_in
     OR NEW.width_in  IS DISTINCT FROM OLD.width_in
     OR NEW.height_in IS DISTINCT FROM OLD.height_in
     -- The writer measured it and the numbers happened not to move.
     OR (COALESCE(NEW.dimensions_verified, false) AND NOT COALESCE(OLD.dimensions_verified, false))
  THEN
    NEW.dimensions_verified := true;
    NEW.dimensions_measured_at := now();
  ELSE
    -- Monotonic: a later write cannot carry a stale false over a measurement.
    NEW.dimensions_verified := COALESCE(OLD.dimensions_verified, false);
    NEW.dimensions_measured_at := OLD.dimensions_measured_at;
  END IF;

  IF NEW.weight_lbs IS DISTINCT FROM OLD.weight_lbs
     OR (COALESCE(NEW.weight_verified, false) AND NOT COALESCE(OLD.weight_verified, false))
  THEN
    NEW.weight_verified := true;
  ELSE
    NEW.weight_verified := COALESCE(OLD.weight_verified, false);
  END IF;

  RETURN NEW;
END;
$function$;

-- 2. INSERT: a weight the caller actually sent was read off something. Same
--    shape as the dimensions branch right above it, and the same contract with
--    the form: send NULL for the type's default and the trigger fills it in
--    without claiming anybody weighed it.
CREATE OR REPLACE FUNCTION public.set_is_bike_on_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
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

  IF NEW.weight_lbs IS NOT NULL THEN
    NEW.weight_verified := true;
  ELSE
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

-- 3. Backfill: a weight that is not the type's default was typed by somebody.
--    The same value comparison the screen was doing, run once, so nobody is
--    asked to re-weigh the 53 boxes that already have a real reading. It cannot
--    recover a real weight that landed exactly on the default -- those stay
--    unverified and get weighed again, which is the safe direction.
UPDATE public.sku_metadata
   SET weight_verified = true
 WHERE weight_lbs IS NOT NULL
   AND weight_lbs <> (CASE WHEN is_bike THEN 45 ELSE 1 END)
   AND weight_verified = false;

-- 4. The measuring queue needs the new flag, so the screen can say "nobody
--    weighed this" as a fact rather than by comparing against 45. RETURNS TABLE
--    changes, so drop and recreate; the arguments do not, so a frontend
--    deployed before this keeps working and ignores the column.
DROP FUNCTION IF EXISTS public.get_bike_demand_ranking(int, int);

CREATE FUNCTION public.get_bike_demand_ranking(
  p_months int DEFAULT 12,
  p_min_stock int DEFAULT 3
)
RETURNS TABLE(
  sku text,
  model text,
  size text,
  image_url text,
  length_in numeric,
  width_in numeric,
  height_in numeric,
  weight_lbs numeric,
  weight_verified boolean,
  dimensions_verified boolean,
  dimensions_measured_at timestamptz,
  orders bigint,
  units numeric,
  last_ordered timestamptz,
  stock bigint,
  location text,
  sublocation text[]
)
LANGUAGE sql STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH RECURSIVE edges AS (
    SELECT DISTINCT ON (l.previous_sku) l.previous_sku AS old_sku, l.sku AS new_sku
    FROM public.inventory_logs l
    WHERE l.previous_sku IS NOT NULL
      AND l.previous_sku <> ''
      AND l.previous_sku <> l.sku
    ORDER BY l.previous_sku, l.created_at DESC
  ),
  chain AS (
    SELECT e.old_sku, e.new_sku, 1 AS hops FROM edges e
    UNION ALL
    SELECT c.old_sku, e.new_sku, c.hops + 1
    FROM chain c
    JOIN edges e ON e.old_sku = c.new_sku
    WHERE c.hops < 10 AND e.new_sku <> c.old_sku
  ),
  canonical AS (
    SELECT DISTINCT ON (c.old_sku) c.old_sku, c.new_sku
    FROM chain c ORDER BY c.old_sku, c.hops DESC
  ),
  lines AS (
    SELECT pl.id,
           pl.created_at,
           COALESCE(cn.new_sku, it->>'sku') AS sku,
           COALESCE((it->>'pickingQty')::numeric, 0) AS qty
    FROM public.picking_lists pl
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(pl.items, '[]'::jsonb)) it
    LEFT JOIN canonical cn ON cn.old_sku = (it->>'sku')
    WHERE pl.status = 'completed'
      AND pl.created_at >= now() - make_interval(months => GREATEST(COALESCE(p_months, 12), 1))
  ),
  demand AS (
    SELECT l.sku,
           count(DISTINCT l.id)::bigint AS orders,
           COALESCE(sum(l.qty), 0) AS units,
           max(l.created_at) AS last_ordered
    FROM lines l
    GROUP BY l.sku
  ),
  stock AS (
    SELECT i.sku, sum(i.quantity)::bigint AS qty
    FROM public.inventory i
    WHERE i.is_active AND i.quantity > 0
    GROUP BY i.sku
  ),
  home AS (
    SELECT DISTINCT ON (i.sku) i.sku, i.location, i.sublocation
    FROM public.inventory i
    WHERE i.is_active AND i.quantity > 0
    ORDER BY i.sku, i.quantity DESC, i.location
  )
  SELECT m.sku,
         m.model,
         m.size,
         m.image_url,
         m.length_in,
         m.width_in,
         m.height_in,
         m.weight_lbs,
         COALESCE(m.weight_verified, false),
         COALESCE(m.dimensions_verified, false),
         m.dimensions_measured_at,
         d.orders,
         d.units,
         d.last_ordered,
         s.qty,
         h.location,
         h.sublocation
  FROM demand d
  JOIN public.sku_metadata m ON m.sku = d.sku
  JOIN stock s ON s.sku = d.sku
  LEFT JOIN home h ON h.sku = d.sku
  WHERE m.is_bike IS TRUE
    AND COALESCE(m.is_scratch_dent, false) = false
    AND s.qty >= GREATEST(COALESCE(p_min_stock, 0), 0)
  ORDER BY d.orders DESC, d.last_ordered DESC, m.sku;
$function$;

GRANT EXECUTE ON FUNCTION public.get_bike_demand_ranking(int, int)
  TO authenticated, service_role;
