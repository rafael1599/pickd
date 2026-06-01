-- ============================================================================
-- Registrar Container — bulk container intake RPCs
--
-- Powers the "Registrar Container" view: ingest a parsed shipment breakdown
-- (array of {sku, qty, item_name}) and (1) preview the canonical resolution,
-- (2) apply it transactionally into a new location.
--
-- Core rule (idea: container intake): the 3rd trailing letter of a bike SKU
-- is NOT a filter — BL / BLD / BLT are the same bike (different origin). We
-- resolve each incoming SKU to the "family" form that already HOLDS live
-- stock, so received units consolidate where pickers actually find them.
--
-- family_key(sku) = <all digits> || <first 2 color letters>
--   '03-3768BL'  -> '0337680'... no: digits='033768', letters='BL'  -> '033768BL'
--   '03-3768BLD' -> digits='033768', letters='BLD' -> left2 'BL'      -> '033768BL'
--   '03-3768BLT' -> '033768BL'   (all three collapse to the same family)
--
-- Canonical target = the family member with the most active stock; if none,
-- the clean 2-letter base form (e.g. '03-3768BL'), which register_new_sku
-- will create (its dash-dedup handles format variants like '033741GN').
-- ============================================================================

-- helpers -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._container_digits(p_sku text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(upper(coalesce(p_sku,'')), '[^0-9]', '', 'g');
$$;

CREATE OR REPLACE FUNCTION public._container_color2(p_sku text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT left(regexp_replace(upper(coalesce(p_sku,'')), '[^A-Z]', '', 'g'), 2);
$$;

-- base 2-letter canonical form: '03' || '-' || rest-of-digits || color2
CREATE OR REPLACE FUNCTION public._container_base_sku(p_sku text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN length(public._container_digits(p_sku)) >= 3
      THEN left(public._container_digits(p_sku), 2) || '-'
           || substr(public._container_digits(p_sku), 3)
           || public._container_color2(p_sku)
    ELSE upper(trim(p_sku))
  END;
$$;

-- ── 1) PREVIEW: resolve incoming items to canonical SKUs ───────────────────
-- p_items: jsonb array of { "sku": text, "qty": int, "item_name": text }
CREATE OR REPLACE FUNCTION public.resolve_container_skus(
  p_items jsonb,
  p_warehouse text DEFAULT 'LUDLOW'
)
RETURNS TABLE (
  canonical_sku      text,
  qty                integer,
  item_name          text,
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

-- ── 2) APPLY: register a container into a location (transactional) ──────────
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
        r.canonical_sku,
        coalesce(r.item_name, r.canonical_sku),
        p_warehouse,
        v_location
      );
      v_new := array_append(v_new, r.canonical_sku);
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
