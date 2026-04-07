-- Add a generated column for natural sorting of locations.
-- PALLETIZED = 0, UNASSIGNED = 1, ROW N = 100 + N, everything else = 9999.
-- This allows PostgREST to ORDER BY location_sort_key for correct natural order.
ALTER TABLE public.inventory
ADD COLUMN location_sort_key integer GENERATED ALWAYS AS (
  CASE
    WHEN location = 'PALLETIZED' THEN 0
    WHEN location = 'UNASSIGNED' THEN 1
    WHEN location ~ '^ROW \d+$' THEN 100 + (regexp_replace(location, '\D', '', 'g'))::integer
    ELSE 9999
  END
) STORED;

CREATE INDEX idx_inventory_location_sort_key ON public.inventory (location_sort_key, sku);
