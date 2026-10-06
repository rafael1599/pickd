-- La búsqueda de Stock conoce las PH (5 oct 2026, idea-248 paso 3).
--
-- Devuelve `unit_kind` y `base_sku` de cada fila (el Stock pinta la etiqueta PH
-- y el filtro Condition la cuenta), y `p_only_photo` limita a las PH para la
-- casilla PH de Stock, igual que `p_only_scratch_dent` hace con las S/D.
-- Como S/D, una PH se ve con bicis y partes juntas: el toggle Parts no la esconde.
--
-- Sólo se AÑADEN un parámetro con default y dos columnas al final del
-- resultado: un front viejo sigue llamando igual. Cambiar la firma obliga a
-- DROP + CREATE; los permisos se devuelven tal cual.

DROP FUNCTION IF EXISTS public.search_inventory_with_metadata(text, text, boolean, boolean, boolean, boolean, integer, integer, text);
DROP FUNCTION IF EXISTS public.search_inventory_with_metadata(text, text, boolean, boolean, boolean, boolean, integer, integer, text, boolean);

CREATE FUNCTION public.search_inventory_with_metadata(p_search text DEFAULT ''::text, p_warehouse text DEFAULT NULL::text, p_include_inactive boolean DEFAULT false, p_show_parts boolean DEFAULT false, p_only_scratch_dent boolean DEFAULT false, p_only_fedex_returns boolean DEFAULT false, p_offset integer DEFAULT 0, p_limit integer DEFAULT 30, p_field text DEFAULT 'all'::text, p_only_photo boolean DEFAULT false)
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
  -- Latest fedex_return per sku (when >1 returns share a sku, take the most
  -- recently received). Drives both the "which return is this" enrichment
  -- and the p_only_fedex_returns scope filter.
  fdx_latest AS (
    SELECT DISTINCT ON (fri.sku)
      fri.sku,
      fr.id              AS return_id,
      fr.tracking_number,
      fr.status,
      fr.received_at
    FROM public.fedex_return_items fri
    JOIN public.fedex_returns fr ON fr.id = fri.return_id
    ORDER BY fri.sku, fr.received_at DESC NULLS LAST
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
      fx.tracking_number AS fedex_tracking_number,
      fx.return_id       AS fedex_return_id,
      fx.status          AS fedex_return_status,
      m.size, m.category, m.unit_kind, m.base_sku
    FROM public.inventory i
    JOIN public.sku_metadata m ON m.sku = i.sku
    LEFT JOIN fdx_latest fx ON fx.sku = i.sku
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
        OR fx.return_id IS NOT NULL
        OR p_show_parts IS NULL
        OR m.is_bike = (NOT p_show_parts)
      )
      AND (NOT p_only_fedex_returns OR fx.return_id IS NOT NULL)
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
          -- Match by FedEx tracking number → finds the inventory row linked to
          -- the return via fedex_return_items.sku, no matter where the bike
          -- currently lives.
          OR i.sku IN (
            SELECT fri2.sku FROM public.fedex_return_items fri2
            JOIN public.fedex_returns fr2 ON fr2.id = fri2.return_id
            WHERE regexp_replace(fr2.tracking_number, '[-\s]', '', 'g')
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

GRANT EXECUTE ON FUNCTION public.search_inventory_with_metadata(text, text, boolean, boolean, boolean, boolean, integer, integer, text, boolean)
  TO anon, authenticated, service_role;

-- split_unit (20261005204330) nació con el EXECUTE por defecto de Postgres, que
-- incluye a PUBLIC y por tanto a anon: una función SECURITY DEFINER que mueve
-- stock no se llama sin sesión. Queda como adjust_inventory_quantity.
REVOKE EXECUTE ON FUNCTION public.split_unit(text, text, text, integer, text, text, uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.split_unit(text, text, text, integer, text, text, uuid, text, text, text) TO authenticated, service_role;
