-- ============================================================================
-- El alta de una devolución pasa a la ficha (idea-250, fase 2).
--
-- 1. `register_return(...)`: una devolución en un paso — ficha con el tracking
--    como SKU, `unit_kind = 'return'`, tipo, RMA, misship, fila en FDX RETURNS
--    con 1 u (log ADD) y la foto de la etiqueta en sku_photos. Lo que antes
--    hacía useAddFedExReturn en cuatro llamadas sueltas, sin fedex_returns.
-- 2. `search_inventory_with_metadata` deja de leer fedex_returns /
--    fedex_return_items: la casilla FedEx Returns es `unit_kind = 'return'` y el
--    tracking se encuentra por SKU. Misma firma y mismas columnas
--    (fedex_return_id / fedex_return_status salen NULL) para el build viejo.
--
-- Las tablas, sync_return_unit y las funciones del flujo viejo se borran en
-- otra migración, cuando ningún teléfono siga con un build que las use.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.register_return(
  p_tracking text,
  p_is_bike boolean,
  p_performed_by text,
  p_user_id uuid DEFAULT NULL,
  p_rma text DEFAULT NULL,
  p_is_misship boolean DEFAULT false,
  p_label_url text DEFAULT NULL,
  p_warehouse text DEFAULT 'LUDLOW',
  p_location text DEFAULT 'FDX RETURNS'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_tracking text := upper(regexp_replace(COALESCE(p_tracking, ''), '\s', '', 'g'));
  v_sku text;
  v_location text := upper(btrim(COALESCE(nullif(btrim(p_location), ''), 'FDX RETURNS')));
BEGIN
  IF v_tracking = '' THEN
    RAISE EXCEPTION 'register_return: tracking number is required' USING ERRCODE = '22023';
  END IF;
  IF p_is_bike IS NULL THEN
    RAISE EXCEPTION 'register_return: bike or part?' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.sku_metadata WHERE sku = public.canonical_sku(v_tracking))
     OR EXISTS (SELECT 1 FROM public.inventory WHERE sku = public.canonical_sku(v_tracking)) THEN
    RAISE EXCEPTION 'Return % is already registered', v_tracking USING ERRCODE = '23505';
  END IF;

  v_sku := public.register_new_sku(
    v_tracking, 'FedEx Return ' || v_tracking, p_warehouse, v_location
  ) ->> 'sku';

  UPDATE public.sku_metadata
     SET unit_kind  = 'return',
         is_bike    = p_is_bike,
         rma        = nullif(btrim(p_rma), ''),
         is_misship = COALESCE(p_is_misship, false)
   WHERE sku = v_sku;

  PERFORM public.adjust_inventory_quantity(
    p_sku => v_sku,
    p_warehouse => p_warehouse,
    p_location => v_location,
    p_delta => 1,
    p_performed_by => p_performed_by,
    p_user_id => p_user_id
  );

  IF nullif(btrim(p_label_url), '') IS NOT NULL THEN
    INSERT INTO public.sku_photos (sku, url, thumbnail_url, created_by)
    VALUES (
      v_sku,
      p_label_url,
      replace(p_label_url, '/photos/returns/', '/photos/returns/thumbs/'),
      p_user_id
    );
  END IF;

  RETURN jsonb_build_object('sku', v_sku, 'location', v_location);
END;
$$;

COMMENT ON FUNCTION public.register_return(text, boolean, text, uuid, text, boolean, text, text, text) IS
  'Da de alta una devolución de FedEx como unidad return: SKU = tracking, 1 u en FDX RETURNS, etiqueta en sku_photos. idea-250.';

REVOKE EXECUTE ON FUNCTION public.register_return(text, boolean, text, uuid, text, boolean, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_return(text, boolean, text, uuid, text, boolean, text, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.search_inventory_with_metadata(p_search text DEFAULT ''::text, p_warehouse text DEFAULT NULL::text, p_include_inactive boolean DEFAULT false, p_show_parts boolean DEFAULT false, p_only_scratch_dent boolean DEFAULT false, p_only_fedex_returns boolean DEFAULT false, p_offset integer DEFAULT 0, p_limit integer DEFAULT 30, p_field text DEFAULT 'all'::text, p_only_photo boolean DEFAULT false)
 RETURNS TABLE(id bigint, sku text, quantity integer, location text, location_id uuid, sublocation text[], item_name text, warehouse text, is_active boolean, internal_note text, distribution jsonb, created_at timestamp with time zone, location_sort_key integer, image_url text, length_in numeric, width_in numeric, height_in numeric, weight_lbs numeric, is_bike boolean, is_scratch_dent boolean, serial_number text, upc text, model text, condition_description text, pdf_link text, sd_price numeric, condition text, fedex_tracking_number text, fedex_return_id uuid, fedex_return_status text, size text, category text, unit_kind text, base_sku text, total_count bigint)
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
      -- A return's SKU is its tracking (idea-250). The id and status columns
      -- stay so the shape does not change; nothing fills them any more.
      CASE WHEN m.unit_kind = 'return' THEN i.sku END AS fedex_tracking_number,
      NULL::uuid AS fedex_return_id,
      NULL::text AS fedex_return_status,
      m.size, m.category, m.unit_kind, m.base_sku
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
    f.fedex_tracking_number, f.fedex_return_id, f.fedex_return_status,
    f.size, f.category, f.unit_kind, f.base_sku,
    COUNT(*) OVER () AS total_count
  FROM filtered f
  ORDER BY
    f.location_sort_key ASC,
    (f.is_active AND f.quantity > 0) DESC,
    f.sku ASC
  OFFSET p_offset
  LIMIT p_limit;
$function$;

COMMIT;
