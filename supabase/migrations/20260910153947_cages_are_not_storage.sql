-- ============================================================================
-- Cages are not storage, including the ones created since July.
--
-- Rafael, 10 Sep 2026: "esas no son espacio que tenemos disponible para
-- bicicletas". 20260731160000 set `counts_as_storage = false` on every CAGE%
-- once; CAGE 8 (19 Aug) and CAGE 7 (20 Aug) came in afterwards through
-- resolve_location (zone UNASSIGNED) with the column default, so their 550
-- each counted as free bike space while holding 17 bikes under lock.
-- Same cause as the containers in 20260910151722, same two-part fix.
-- ============================================================================

UPDATE locations
SET counts_as_storage = false
WHERE warehouse = 'LUDLOW'
  AND location ILIKE 'CAGE%'
  AND counts_as_storage;

-- The next cage is born knowing it. Same signature and body as
-- 20260910151722; the non-storage rule now names cages beside containers.
-- LocationEditorModal still sets the flag explicitly, with its checkbox.
CREATE OR REPLACE FUNCTION public.resolve_location(
  p_warehouse text,
  p_location_name text,
  p_user_role text DEFAULT 'staff'::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_location_id UUID;
  v_resolved_name TEXT;
BEGIN
  IF p_location_name IS NULL OR TRIM(p_location_name) = '' THEN RETURN NULL; END IF;

  -- UPPERCASE Normalization + TRIM
  v_resolved_name := UPPER(TRIM(p_location_name));

  -- A bare number is a row: '12' -> 'ROW 12'.
  IF v_resolved_name ~ '^[0-9]+$' THEN
    v_resolved_name := 'ROW ' || v_resolved_name;
  END IF;

  SELECT id INTO v_location_id FROM locations
  WHERE warehouse = p_warehouse AND UPPER(location) = v_resolved_name;

  IF v_location_id IS NOT NULL THEN RETURN v_location_id; END IF;

  -- Create on the fly (UPPERCASE). A container name ('7004N') is staging and a
  -- cage is locked-away stock, neither is floor space for bikes: same rules as
  -- 20260731160000, so their 550 never counts.
  INSERT INTO locations (warehouse, location, zone, is_active, counts_as_storage)
  VALUES (p_warehouse, v_resolved_name, 'UNASSIGNED', true,
          NOT (v_resolved_name ~ '^[0-9]{4}N$' OR v_resolved_name LIKE 'CAGE%'))
  RETURNING id INTO v_location_id;

  RETURN v_location_id;
END;
$function$;
