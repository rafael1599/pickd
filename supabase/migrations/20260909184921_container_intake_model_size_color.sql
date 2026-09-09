-- ============================================================================
-- Container intake: keep the split the sheet already made.
--
-- The JAMIS breakdown writes Model, Size and Colour in three columns (F/G/H).
-- The parser joined them into one name, register_container passed that name to
-- register_new_sku as `p_item_name`, and the four structured parameters the
-- function grew on 2026-07-17 (20260717200000) were never filled in. So every
-- SKU a container has ever created landed with model = size = color = NULL and
-- the whole line in `inventory.item_name`.
--
-- That is not cosmetic. `model` is the grouping key of the FedEx Dimensions
-- export, and `fedexCartonGap` holds a carton back with `no_model` however many
-- times somebody measures the box: on 9 Sep Rafael measured and weighed
-- 07-3743PK and 07-3746PU on the floor and Double Check asked him for the same
-- two boxes again, because a tape measure cannot fix a missing name.
--
-- Two changes, and the six bikes that are already wrong:
--   1. resolve_container_skus carries model/size/color through, so the preview
--      shows what will be registered.
--   2. register_container hands them to register_new_sku, and fills the blanks
--      on a SKU that already existed -- COALESCE only, so a value on the row
--      always beats one off a sheet.
--   3. The September Laser container, split by hand from the joined name.
-- ============================================================================

-- ── 1) PREVIEW ─────────────────────────────────────────────────────────────
-- Dropped rather than replaced: the return type gains three columns, and
-- CREATE OR REPLACE cannot change it. register_container is recreated below
-- against the new shape, inside this same transaction.
DROP FUNCTION IF EXISTS public.resolve_container_skus(jsonb, text);

CREATE FUNCTION public.resolve_container_skus(
  p_items jsonb,
  p_warehouse text DEFAULT 'LUDLOW'
)
RETURNS TABLE (
  canonical_sku      text,
  qty                integer,
  item_name          text,
  model              text,
  size               text,
  color              text,
  merged_from        text[],
  is_new             boolean,
  is_bike            boolean,
  existing_qty       integer,
  existing_locations jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  WITH input AS (
    SELECT
      upper(trim(e->>'sku'))                       AS in_sku,
      GREATEST(coalesce((e->>'qty')::int, 0), 0)   AS in_qty,
      nullif(trim(e->>'item_name'), '')            AS in_name,
      nullif(trim(e->>'model'), '')                AS in_model,
      nullif(trim(e->>'size'), '')                 AS in_size,
      nullif(trim(e->>'color'), '')                AS in_color,
      public._container_digits(e->>'sku')          AS digits,
      public._container_color2(e->>'sku')          AS color2
    FROM jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e
    WHERE coalesce(nullif(trim(e->>'sku'), ''), '') <> ''
  ),
  -- the family member with the most live stock (if any)
  resolved AS (
    SELECT
      i.*,
      (
        SELECT inv.sku FROM inventory inv
        WHERE public._container_digits(inv.sku) = i.digits
          AND public._container_color2(inv.sku) = i.color2
          AND inv.quantity > 0
        ORDER BY inv.quantity DESC, inv.sku ASC
        LIMIT 1
      ) AS live_sku
    FROM input i
  ),
  with_canon AS (
    SELECT
      r.*,
      coalesce(r.live_sku, public._container_base_sku(r.in_sku)) AS canon
    FROM resolved r
  ),
  grouped AS (
    SELECT
      canon AS canonical_sku,
      sum(in_qty)::int           AS qty,
      max(in_name)               AS item_name,
      max(in_model)              AS model,
      max(in_size)               AS size,
      max(in_color)              AS color,
      array_agg(DISTINCT in_sku) AS merged_from,
      min(digits)                AS digits,
      min(color2)                AS color2
    FROM with_canon
    GROUP BY canon
  )
  SELECT
    g.canonical_sku,
    g.qty,
    g.item_name,
    g.model,
    g.size,
    g.color,
    g.merged_from,
    NOT EXISTS (SELECT 1 FROM sku_metadata sm WHERE sm.sku = g.canonical_sku) AS is_new,
    coalesce(
      (SELECT sm.is_bike FROM sku_metadata sm WHERE sm.sku = g.canonical_sku),
      (g.digits ~ '^0[13567]' AND g.color2 <> '')
    ) AS is_bike,
    coalesce((
      SELECT sum(inv.quantity)::int FROM inventory inv
      WHERE public._container_digits(inv.sku) = g.digits
        AND public._container_color2(inv.sku) = g.color2
        AND inv.quantity > 0
        AND inv.warehouse = p_warehouse
    ), 0) AS existing_qty,
    coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'sku', inv.sku, 'location', inv.location,
               'sublocation', inv.sublocation, 'qty', inv.quantity
             ) ORDER BY inv.quantity DESC)
      FROM inventory inv
      WHERE public._container_digits(inv.sku) = g.digits
        AND public._container_color2(inv.sku) = g.color2
        AND inv.quantity > 0
        AND inv.warehouse = p_warehouse
    ), '[]'::jsonb) AS existing_locations
  FROM grouped g
  ORDER BY g.qty DESC, g.canonical_sku;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_container_skus(jsonb, text)
  TO anon, authenticated, service_role;

-- ── 2) APPLY ───────────────────────────────────────────────────────────────
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

GRANT EXECUTE ON FUNCTION public.register_container(text, jsonb, uuid, text, text, text)
  TO authenticated, service_role;

-- ── 3) The container that is already wrong ─────────────────────────────────
-- The six Lasers registered on 2026-09-08 (ROW 42, 1101 units). Their names
-- survive in `inventory.item_name`; the split below is that name read by hand:
-- the model half is the one the FedEx record has to be named after, and the
-- rest is the colour. No size -- the joined name carries none, and inventing
-- one would put a wrong value in the export's second grouping key. If the
-- sheet's Size column did hold something for these rows, it is one UPDATE.
UPDATE sku_metadata AS m
SET model = v.model,
    color = coalesce(m.color, v.color)
FROM (VALUES
    ('07-3741RD', 'Laser 1.6', 'Crimson'),
    ('07-3742BK', 'Laser 1.6', 'Gloss Black'),
    ('07-3743PK', 'Laser 1.6', 'Popstar Pink'),
    ('07-3744BL', 'Laser 2.0', 'Royal Blue'),
    ('07-3745WH', 'Laser 2.0', 'Pure White'),
    ('07-3746PU', 'Laser 2.0', 'Velvet Lilac')
) AS v(sku, model, color)
WHERE m.sku = v.sku
  AND nullif(btrim(coalesce(m.model, '')), '') IS NULL;
