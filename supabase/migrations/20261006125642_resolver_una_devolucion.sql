-- ============================================================================
-- La ficha de una devolución: RESOLVE y el orden de la lista
-- (docs/prds/fedex-return-card.md, F2 y F3; Rafael, 6 oct 2026: «sí a todo»).
--
-- 1. `resolve_return(p_sku, p_action, …)`: las tres salidas de una devolución,
--    cada una en una transacción.
--      stock   → la unidad pasa al stock de su modelo en la ubicación elegida.
--                Un MOVE con previous_sku = tracking y nota «FedEx return
--                <tracking>», como el process_fedex_return_item que se borró.
--      sd      → la devolución es la S/D, en su sitio y con su serial; el
--                tracking queda de SKU provisional hasta que Jayme le dé su 01-.
--      dispose → DEDUCT a DISPOSED con la razón, como dispose_fedex_return.
--    La ficha de la devolución se queda (en 0): sigue en el informe de recibidas.
-- 2. La búsqueda devuelve `received_at` (alta de la devolución) y la lista de
--    devoluciones sale de la más nueva a la más vieja.
-- 3. FDX y FDX 1 son FDX RETURNS: las devoluciones con stock se mudan (MOVE sin
--    nota). Las ubicaciones viejas se quedan, vacías.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.resolve_return(
  p_sku text,
  p_action text,
  p_performed_by text,
  p_user_id uuid,
  p_model_sku text DEFAULT NULL,
  p_location text DEFAULT NULL,
  p_sublocation text[] DEFAULT NULL,
  p_serial text DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_warehouse text DEFAULT 'LUDLOW',
  p_user_role text DEFAULT 'staff'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_meta public.sku_metadata%ROWTYPE;
  v_row public.inventory%ROWTYPE;
  v_qty integer := 0;
  v_from_loc text;
  v_from_loc_id uuid;
  v_model text := NULLIF(upper(btrim(p_model_sku)), '');
  v_dest jsonb;
  v_prev integer;
  v_note text;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'sign-in required' USING ERRCODE = '22023';
  END IF;
  IF p_action NOT IN ('stock', 'sd', 'dispose') THEN
    RAISE EXCEPTION 'Unknown action %', p_action USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_meta FROM public.sku_metadata WHERE sku = p_sku FOR UPDATE;
  IF NOT FOUND OR v_meta.unit_kind <> 'return' THEN
    RAISE EXCEPTION '% is not a FedEx return', p_sku USING ERRCODE = '22023';
  END IF;

  -- The unit: the row(s) of the return that still hold it.
  FOR v_row IN
    SELECT * FROM public.inventory
     WHERE sku = p_sku AND warehouse = p_warehouse AND quantity > 0
     ORDER BY quantity DESC
     FOR UPDATE
  LOOP
    v_qty := v_qty + v_row.quantity;
    IF v_from_loc IS NULL THEN
      v_from_loc := v_row.location;
      v_from_loc_id := v_row.location_id;
    END IF;
  END LOOP;
  IF v_qty = 0 THEN
    RAISE EXCEPTION 'Return % is already resolved', p_sku USING ERRCODE = '22023';
  END IF;

  v_note := 'FedEx return ' || p_sku;

  IF p_action = 'sd' THEN
    IF NULLIF(btrim(p_serial), '') IS NULL THEN
      RAISE EXCEPTION 'An S/D needs its serial' USING ERRCODE = '22023';
    END IF;
    UPDATE public.sku_metadata
       SET unit_kind = 'sd', serial_number = upper(btrim(p_serial))
     WHERE sku = p_sku;
    RETURN jsonb_build_object('sku', p_sku, 'action', 'sd', 'qty', v_qty);
  END IF;

  -- stock and dispose both take the unit off the return's rows.
  IF p_action = 'stock' THEN
    IF v_model IS NULL OR NULLIF(btrim(p_location), '') IS NULL THEN
      RAISE EXCEPTION 'Back to stock needs the model and where' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.sku_metadata
                    WHERE sku = v_model AND unit_kind = 'new') THEN
      RAISE EXCEPTION '% is not a catalogue SKU', v_model USING ERRCODE = '22023';
    END IF;
  END IF;

  FOR v_row IN
    SELECT * FROM public.inventory
     WHERE sku = p_sku AND warehouse = p_warehouse AND quantity > 0
  LOOP
    PERFORM public.adjust_inventory_quantity(
      p_sku, p_warehouse, v_row.location, -v_row.quantity,
      p_performed_by, p_user_id, p_user_role, NULL, NULL, NULL, true, NULL);
  END LOOP;

  IF p_action = 'dispose' THEN
    v_note := 'Disposed (' || v_note || ')'
      || CASE WHEN NULLIF(btrim(p_reason), '') IS NOT NULL THEN ' — ' || btrim(p_reason) ELSE '' END;
    PERFORM public.upsert_inventory_log(
      p_sku, p_warehouse, v_from_loc, p_warehouse, 'DISPOSED',
      -v_qty, v_qty, 0, 'DEDUCT',
      (SELECT id FROM public.inventory WHERE sku = p_sku AND warehouse = p_warehouse AND location = v_from_loc),
      v_from_loc_id, NULL, p_performed_by, p_user_id,
      NULL, NULL, NULL, false, v_note, NULL);
    RETURN jsonb_build_object('sku', p_sku, 'action', 'dispose', 'qty', v_qty);
  END IF;

  -- Back to stock: the model's row gains the unit, one MOVE says where from.
  SELECT quantity INTO v_prev FROM public.inventory
   WHERE sku = v_model AND warehouse = p_warehouse
     AND upper(btrim(location)) = upper(btrim(p_location));
  v_dest := public.adjust_inventory_quantity(
    v_model, p_warehouse, p_location, v_qty,
    p_performed_by, p_user_id, p_user_role, NULL, NULL, NULL, true, NULL);
  IF p_sublocation IS NOT NULL AND cardinality(p_sublocation) > 0
     AND upper(btrim(p_location)) LIKE 'ROW%' THEN
    UPDATE public.inventory
       SET sublocation = (SELECT array_agg(DISTINCT s ORDER BY s)
                            FROM unnest(COALESCE(sublocation, '{}') || p_sublocation) s)
     WHERE id = (v_dest->>'id')::bigint;
  END IF;
  PERFORM public.upsert_inventory_log(
    v_model, p_warehouse, v_from_loc, p_warehouse, v_dest->>'location',
    v_qty, COALESCE(v_prev, 0), (v_dest->>'quantity')::integer, 'MOVE',
    (v_dest->>'id')::bigint, v_from_loc_id, (v_dest->>'location_id')::uuid,
    p_performed_by, p_user_id, NULL, NULL, NULL, false, v_note, p_sku);
  UPDATE public.sku_metadata SET base_sku = v_model WHERE sku = p_sku;

  RETURN jsonb_build_object('sku', p_sku, 'action', 'stock', 'qty', v_qty,
                            'model', v_model, 'location', v_dest->>'location');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.resolve_return(text, text, text, uuid, text, text, text[], text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_return(text, text, text, uuid, text, text, text[], text, text, text, text) TO authenticated, service_role;

DROP FUNCTION public.search_inventory_with_metadata(text, text, boolean, boolean, boolean, boolean, integer, integer, text, boolean);

CREATE FUNCTION public.search_inventory_with_metadata(p_search text DEFAULT ''::text, p_warehouse text DEFAULT NULL::text, p_include_inactive boolean DEFAULT false, p_show_parts boolean DEFAULT false, p_only_scratch_dent boolean DEFAULT false, p_only_fedex_returns boolean DEFAULT false, p_offset integer DEFAULT 0, p_limit integer DEFAULT 30, p_field text DEFAULT 'all'::text, p_only_photo boolean DEFAULT false)
 RETURNS TABLE(id bigint, sku text, quantity integer, location text, location_id uuid, sublocation text[], item_name text, warehouse text, is_active boolean, internal_note text, distribution jsonb, created_at timestamp with time zone, location_sort_key integer, image_url text, length_in numeric, width_in numeric, height_in numeric, weight_lbs numeric, is_bike boolean, is_scratch_dent boolean, serial_number text, upc text, model text, condition_description text, pdf_link text, sd_price numeric, condition text, fedex_tracking_number text, size text, category text, unit_kind text, base_sku text, received_at timestamp with time zone, total_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH normalized AS (
    SELECT
      TRIM(p_search)                                     AS raw_search,
      regexp_replace(TRIM(p_search), '[-\s]', '', 'g')   AS normalized_search,
      -- idea-154: the canonical spelling of the whole term, so '01-530' finds 01-0530.
      regexp_replace(public.canonical_sku(TRIM(p_search)), '[-\s]', '', 'g') AS canonical_key,
      regexp_replace(TRIM(p_search), '\s', '', 'g')     AS spaceless_search,
      COALESCE(NULLIF(p_field, ''), 'all')               AS field
  ),
  filtered AS (
    SELECT
      i.id, i.sku, i.quantity, i.location, i.location_id, i.sublocation,
      i.item_name, i.warehouse, i.is_active, i.internal_note, i.distribution,
      i.created_at, i.location_sort_key,
      m.image_url, m.length_in, m.width_in, m.height_in, m.weight_lbs,
      m.is_bike, m.is_scratch_dent, m.serial_number,
      m.upc, m.model, m.condition_description,
      m.pdf_link, m.sd_price, m.condition,
      -- A return's SKU is its tracking (idea-250).
      CASE WHEN m.unit_kind = 'return' THEN i.sku END AS fedex_tracking_number,
      m.size, m.category, m.unit_kind, m.base_sku,
      -- When a return came in: its card's birth, not the row's (a move makes a new row).
      CASE WHEN m.unit_kind = 'return' THEN m.created_at END AS received_at
    FROM public.inventory i
    JOIN public.sku_metadata m ON m.sku = i.sku
    CROSS JOIN normalized n
    WHERE (p_warehouse IS NULL OR i.warehouse = p_warehouse)
      AND (p_include_inactive OR (i.is_active = TRUE AND i.quantity > 0))
      AND (NOT p_only_scratch_dent OR m.is_scratch_dent = TRUE)
      AND (NOT p_only_photo OR m.unit_kind = 'photo')
      -- Bike/parts toggle: applies normally, but bypassed for FedEx-return
      -- rows (their seriales rarely match the bike-pattern trigger, so the
      -- toggle would hide them), for scratch-and-dent / only-fedex modes, and
      -- when p_show_parts IS NULL (search mode: bikes and parts together).
      AND (
        p_only_fedex_returns
        OR p_only_scratch_dent
        OR p_only_photo
        OR m.unit_kind = 'return'
        OR p_show_parts IS NULL
        OR m.is_bike = (NOT p_show_parts)
      )
      AND (NOT p_only_fedex_returns OR m.unit_kind = 'return')
      AND (
        n.raw_search = ''
        OR (n.field IN ('all', 'name') AND (
          i.item_name ILIKE '%' || n.raw_search || '%'
          OR m.model ILIKE '%' || n.raw_search || '%'
          OR m.condition_description ILIKE '%' || n.raw_search || '%'
        ))
        OR (n.field = 'all' AND i.location ILIKE '%' || n.raw_search || '%')
        OR (
          n.field = 'location'
          AND n.spaceless_search <> ''
          AND regexp_replace(i.location, '\s', '', 'g') ILIKE '%' || n.spaceless_search || '%'
        )
        OR (n.field IN ('all', 'sku') AND (
          (
            n.normalized_search <> ''
            AND regexp_replace(i.sku, '[-\s]', '', 'g')
                ILIKE '%' || n.normalized_search || '%'
          )
          -- Substring above keeps '03-37' finding every 03-37xx; this equality
          -- only adds the zero-padded form of a complete term (idea-154).
          OR (
            n.canonical_key <> ''
            AND regexp_replace(i.sku, '[-\s]', '', 'g') = n.canonical_key
          )
        ))
        OR (n.field IN ('all', 'serial') AND n.normalized_search <> '' AND (
          (
            m.serial_number IS NOT NULL
            AND regexp_replace(m.serial_number, '[-\s]', '', 'g')
                ILIKE '%' || n.normalized_search || '%'
          )
          OR (
            m.upc IS NOT NULL
            AND regexp_replace(m.upc, '[-\s]', '', 'g')
                ILIKE '%' || n.normalized_search || '%'
          )
        ))
      )
  )
  SELECT
    f.id, f.sku, f.quantity, f.location, f.location_id, f.sublocation,
    f.item_name, f.warehouse, f.is_active, f.internal_note, f.distribution,
    f.created_at, f.location_sort_key,
    f.image_url, f.length_in, f.width_in, f.height_in, f.weight_lbs,
    f.is_bike, f.is_scratch_dent, f.serial_number,
    f.upc, f.model, f.condition_description,
    f.pdf_link, f.sd_price, f.condition,
    f.fedex_tracking_number,
    f.size, f.category, f.unit_kind, f.base_sku, f.received_at,
    COUNT(*) OVER () AS total_count
  FROM filtered f
  ORDER BY
    -- The returns list: newest first, to print the labels of what just came in
    -- (Rafael, 6 oct 2026).
    CASE WHEN p_only_fedex_returns THEN f.received_at END DESC NULLS LAST,
    f.location_sort_key ASC,
    (f.is_active AND f.quantity > 0) DESC,
    f.sku ASC
  OFFSET p_offset
  LIMIT p_limit;
$function$;

GRANT EXECUTE ON FUNCTION public.search_inventory_with_metadata(text, text, boolean, boolean, boolean, boolean, integer, integer, text, boolean)
  TO anon, authenticated, service_role;


-- ─── FDX y FDX 1 son FDX RETURNS ─────────────────────────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT i.sku, i.location, i.quantity
      FROM public.inventory i
      JOIN public.sku_metadata m ON m.sku = i.sku AND m.unit_kind = 'return'
     WHERE i.warehouse = 'LUDLOW' AND i.location IN ('FDX', 'FDX 1')
       AND i.is_active AND i.quantity > 0
  LOOP
    PERFORM public.move_inventory_stock(
      r.sku, 'LUDLOW', r.location, 'LUDLOW', 'FDX RETURNS', r.quantity,
      'Rafael Lopez',
      -- His user in prod; a fresh database (local, a new clone) has none.
      (SELECT id FROM auth.users WHERE id = '2ac0450c-d80a-47ac-8e50-d9d0ee586321'), 'admin',
      NULL, NULL, NULL);
  END LOOP;
END $$;

COMMIT;
