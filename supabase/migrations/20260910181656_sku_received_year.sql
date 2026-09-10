-- ============================================================================
-- sku_metadata.received_year: the year a SKU came in.
--
-- Rafael, 10 Sep 2026: "crea un campo año recibido para poner el año en todas
-- las que se reciben el año en la fecha que se registró o se registra el
-- container, las que no se han registrado a través de container pero tienen
-- año se coloca en esa columna y las que no tienen se omite".
--
-- Three sources, in this order of authority:
--   1. A container intake: the (New York) year of the most recent one that
--      brought the SKU in. register_container stamps it from now on, so a SKU
--      that arrives again takes the year it arrived. This wins over a year in
--      the name: the 2025 bikes of the Florida container arrived in 2026.
--   2. No container: the year a bike's name carries -- AS400 writes the model
--      year into it ('EXPLORER S/O 18 2019 WHITE', 'Renegade C4 (2020) 61cm').
--      Bikes only. A part's name carries the year of the bike it fits
--      ('HEADSET 2009 VENTURA SPORT', 'PEDAL TAXI 2020 20'), which says nothing
--      about when the part came in -- CLAUDE.md: parts are named after bikes.
--   3. Neither: NULL.
--
-- What counts as a container intake, read off inventory_logs (which start on
-- 14 Feb 2026, so nothing older is visible): an ADD that raised the quantity
-- into a container name ('^[0-9]{4}N$') by a person or register_container,
-- or the Florida container import. An ADD by 'system: unpick' or 'System
-- Auto-Cancel' into a container location is stock going back where it was,
-- not a receipt (memory: receipt detection). 7002N has no receipt on record;
-- its five SKUs arrived again in 7003N / 7004N and are covered by those.
--
-- smallint, 1980-2100: the oldest year any name carries is a 1988 Dakota
-- (Scratch & Dent).
-- ============================================================================

ALTER TABLE public.sku_metadata
  ADD COLUMN IF NOT EXISTS received_year smallint;

ALTER TABLE public.sku_metadata
  DROP CONSTRAINT IF EXISTS sku_metadata_received_year_range;
ALTER TABLE public.sku_metadata
  ADD CONSTRAINT sku_metadata_received_year_range
  CHECK (received_year IS NULL OR received_year BETWEEN 1980 AND 2100);

COMMENT ON COLUMN public.sku_metadata.received_year IS
  'Año en que llegó el SKU. Container: el año del último registro que lo trajo '
  '(register_container lo sella). Sin container: el año que trae el nombre de '
  'una bici (año del modelo en AS400). Partes sin container y lo demás: NULL. '
  'Ver 20260910181656.';

-- ── 1) Container intakes ───────────────────────────────────────────────────
UPDATE public.sku_metadata AS m
SET received_year = extract(year FROM r.last_at AT TIME ZONE 'America/New_York')::smallint
FROM (
  SELECT sku, max(created_at) AS last_at
  FROM public.inventory_logs
  WHERE action_type = 'ADD'
    AND quantity_change > 0
    AND (
      (to_location ~ '^[0-9]{4}N$' AND performed_by !~* '^system')
      OR performed_by ILIKE 'Florida Container%'
    )
  GROUP BY sku
) AS r
WHERE m.sku = r.sku;

-- ── 2) Bikes with a year in their name, never through a container ──────────
-- Any of the SKU's card names, or a `model` still holding the whole line.
-- A four-digit 19xx / 20xx standing on its own (not inside '2.125' or a
-- longer number). A SKU whose names disagree on the year is skipped rather
-- than guessed -- none do today.
UPDATE public.sku_metadata AS m
SET received_year = y.yr
FROM (
  SELECT n.sku, min(n.yr)::smallint AS yr
  FROM (
    SELECT sm.sku,
           (regexp_match(src.name, '(?:^|[^0-9.])((?:19|20)[0-9]{2})(?:[^0-9.]|$)'))[1] AS yr
    FROM public.sku_metadata sm
    CROSS JOIN LATERAL (
      SELECT i.item_name AS name FROM public.inventory i WHERE i.sku = sm.sku
      UNION
      SELECT sm.model
    ) AS src
    WHERE sm.is_bike
      AND src.name ~ '(^|[^0-9.])(19|20)[0-9]{2}([^0-9.]|$)'
  ) AS n
  GROUP BY n.sku
  HAVING count(DISTINCT n.yr) = 1
) AS y
WHERE m.sku = y.sku
  AND m.received_year IS NULL;

-- ── 3) register_container stamps it ────────────────────────────────────────
-- Same signature and body as 20260909184921; the stamp is the only addition.
CREATE OR REPLACE FUNCTION public.register_container(
  p_location     text,
  p_items        jsonb,
  p_user_id      uuid,
  p_performed_by text,
  p_warehouse    text DEFAULT 'LUDLOW',
  p_order_number text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_location text := upper(trim(p_location));
  v_year     smallint := extract(year FROM now() AT TIME ZONE 'America/New_York')::smallint;
  v_existing int;
  v_skus int := 0;
  v_units int := 0;
  v_new text[] := '{}';
  r record;
BEGIN
  IF v_location = '' OR v_location IS NULL THEN
    RAISE EXCEPTION 'Location is required' USING ERRCODE = '22023';
  END IF;

  -- Re-run guard: refuse if the target location already holds stock.
  SELECT count(*) INTO v_existing
  FROM inventory
  WHERE warehouse = p_warehouse
    AND upper(trim(coalesce(location, ''))) = v_location
    AND quantity > 0;
  IF v_existing > 0 THEN
    RAISE EXCEPTION 'Location % already has % row(s) with stock — aborting to avoid double-load.',
      v_location, v_existing USING ERRCODE = '23505';
  END IF;

  FOR r IN
    SELECT * FROM public.resolve_container_skus(p_items, p_warehouse)
  LOOP
    IF r.is_new THEN
      PERFORM public.register_new_sku(
        p_sku       => r.canonical_sku,
        p_item_name => coalesce(r.item_name, r.canonical_sku),
        p_warehouse => p_warehouse,
        p_location  => v_location,
        p_model     => r.model,
        p_size      => r.size,
        p_color     => r.color
      );
      v_new := array_append(v_new, r.canonical_sku);
    END IF;

    -- A SKU the catalog already had keeps everything it already knows; the
    -- sheet only fills what is blank. A container is a shipping document, not
    -- the authority on a bike somebody has since named properly by hand.
    IF r.model IS NOT NULL OR r.size IS NOT NULL OR r.color IS NOT NULL THEN
      UPDATE sku_metadata sm
         SET model = coalesce(sm.model, r.model),
             size  = coalesce(sm.size,  r.size),
             color = coalesce(sm.color, r.color)
       WHERE sm.sku = r.canonical_sku
         AND (sm.model IS NULL OR sm.size IS NULL OR sm.color IS NULL);
    END IF;

    -- The year it came in is a fact of this intake, not of the sheet: it is
    -- always written, new SKU or old (20260910181656).
    UPDATE sku_metadata SET received_year = v_year WHERE sku = r.canonical_sku;

    PERFORM public.adjust_inventory_quantity(
      r.canonical_sku, p_warehouse, v_location, r.qty,
      coalesce(p_performed_by, 'Container Intake'),
      p_user_id, 'admin', NULL, p_order_number,
      coalesce(r.item_name, r.canonical_sku)
    );

    v_skus  := v_skus + 1;
    v_units := v_units + r.qty;
  END LOOP;

  RETURN jsonb_build_object(
    'location', v_location,
    'warehouse', p_warehouse,
    'skus', v_skus,
    'units', v_units,
    'new_skus', v_new
  );
END;
$$;
