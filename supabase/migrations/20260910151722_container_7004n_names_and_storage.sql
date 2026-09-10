-- ============================================================================
-- Container 7004N (10 Sep 2026): the names the sheet could not fix, one bike
-- the box label names, and the container locations counting as floor space.
--
-- Rafael registered 7004N from the Excel this morning and the intake worked as
-- 20260909184921 meant it to: the four new Renegade S4 Copper Tone SKUs landed
-- with model / size / colour apart. What it cannot do is correct a SKU the
-- catalog already had -- register_container only fills blanks -- and six of
-- the twelve lines were Renegade S3 Primer Grey rows created on 5 Mar with the
-- whole name pushed into `model`.
-- ============================================================================

-- ── 1) Renegade S3: one model, the size in its column, the colour whole ────
-- `model` is the FedEx export's grouping key, so 'RENEGADE S3 58 PRIMER' is a
-- group of one: the 58 cannot share the carton already measured for the same
-- frame in Monterey Grey (03-3828GY, 57 x 31 x 8). The spelling follows that
-- measured row, the one the catalog already had right.
--
-- Every value is read off `inventory.item_name`, which is not touched, so the
-- string each split came from survives. The guard is the exact old value: a
-- row somebody has fixed by hand since is left alone, and a second run is a
-- no-op. S&D rows (01-0366, 01-0408, WAKDG0790, 03-3826GY) keep their own
-- spelling and are out of the export anyway; 65-0022 is a hanger.
UPDATE sku_metadata AS m
SET model = v.new_model,
    size  = coalesce(m.size, v.new_size),
    color = v.new_color
FROM (VALUES
    -- sku,         old model,                 old colour, model,         size, colour
    ('03-3824GY', 'RENEGADE S3 48 MONTEREY', 'GREY',     'RENEGADE S3', '48', 'MONTEREY GREY'),
    ('03-3825GY', 'RENEGADE S3 51 MONTEREY', 'GREY',     'RENEGADE S3', '51', 'MONTEREY GREY'),
    ('03-3827BL', 'RENEGADE S3 56 MIDNIGHT', 'BLUE',     'RENEGADE S3', '56', 'MIDNIGHT BLUE'),
    ('03-3828GY', 'RENEGADE S3',             'GREY',     'RENEGADE S3', '58', 'MONTEREY GREY'),
    ('03-4702GY', 'RENEGADE S3 48 PRIMER',   'GREY',     'RENEGADE S3', '48', 'PRIMER GREY'),
    ('03-4703GY', 'RENEGADE S3 51 PRIMER',   'GREY',     'RENEGADE S3', '51', 'PRIMER GREY'),
    ('03-4704GY', 'RENEGADE S3 54 PRIMER',   'GREY',     'RENEGADE S3', '54', 'PRIMER GREY'),
    ('03-4705GY', 'RENEGADE S3 56 PRIMER',   'GREY',     'RENEGADE S3', '56', 'PRIMER GREY'),
    ('03-4706GY', 'RENEGADE S3 58 PRIMER',   'GREY',     'RENEGADE S3', '58', 'PRIMER GREY'),
    ('03-4707GY', 'RENEGADE S3 61 PRIMER',   'GREY',     'RENEGADE S3', '61', 'PRIMER GREY')
) AS v(sku, old_model, old_color, new_model, new_size, new_color)
WHERE m.sku = v.sku
  AND m.model = v.old_model
  AND m.color = v.old_color;

-- ── 2) 03-4710BL: what the box label says ──────────────────────────────────
-- Registered by hand on 2 Jul as "Renegade s4", no size, no colour, 1 unit in
-- ROW 37. It shares its number with 03-4710BR (Renegade S4 54 Copper Tone,
-- which arrived in 7004N) and looked like a colour typo -- it is not. The photo
-- on the record (photos/03-4710BL.webp) is the carton label: ITEM 03-4710BL,
-- MODEL RENEGADE S4, SIZE 700C x 54cm, COLOR Blue Smoke. JAMIS reuses the
-- number across colours, so the two are colour twins -- one carton group --
-- and neither is merged into the other.
--
-- The card name is rewritten too: "Renegade s4" gives a picker no colour to
-- tell it from the Copper Tone 54 that now shares its number, and the label it
-- came from stays in R2.
UPDATE sku_metadata
SET model = 'Renegade S4', size = '54', color = 'Blue Smoke'
WHERE sku = '03-4710BL'
  AND model = 'Renegade s4' AND size IS NULL AND color IS NULL;

UPDATE inventory
SET item_name = 'Renegade S4 54 Blue Smoke'
WHERE sku = '03-4710BL' AND item_name = 'Renegade s4';

-- ── 3) Containers are not storage ──────────────────────────────────────────
-- 20260731160000 set `counts_as_storage = false` on every '^[0-9]{4}N$' name
-- once, and resolve_location kept creating new ones with the column default.
-- Four came in since: 3445N, 6434N, 6435N empty, and 7004N, which with 235
-- bikes in it adds its 550 to the Inventory screen's available space.
UPDATE locations
SET counts_as_storage = false
WHERE warehouse = 'LUDLOW'
  AND location ~ '^[0-9]{4}N$'
  AND counts_as_storage;

-- ...and the next one is born knowing it. resolve_location is the only thing
-- that creates a location on the fly (container intake, receiving, moves);
-- LocationEditorModal sets the flag explicitly. Same signature and body; the
-- INSERT is the only change.
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

  -- Create on the fly (UPPERCASE). A container name ('7004N') is staging, not
  -- floor space: same rule as 20260731160000, so its 550 never counts.
  INSERT INTO locations (warehouse, location, zone, is_active, counts_as_storage)
  VALUES (p_warehouse, v_resolved_name, 'UNASSIGNED', true,
          v_resolved_name !~ '^[0-9]{4}N$')
  RETURNING id INTO v_location_id;

  RETURN v_location_id;
END;
$function$;
