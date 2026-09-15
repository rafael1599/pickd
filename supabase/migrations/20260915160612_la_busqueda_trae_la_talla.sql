-- La búsqueda de Stock trae la talla (y la categoría) de la SKU.
--
-- Rafael, 15 sep 2026, con una foto de la tarjeta de 03-3970BL: «Las comillas de
-- la medida de ayer solucionamos parece no estar funcionando, ahí en la foto el
-- 14 debería ser 14"». La unidad se pone al pintar (`withSizeUnit`, 530ba22),
-- pero la tarjeta de Stock se pinta desde esta RPC, que devolvía `model` y
-- `serial_number` y no `size`: sin la talla guardada no hay número que marcar.
-- `category` va con ella porque un cuadro suelto (`frame`) lleva la suya en cm
-- aunque sea una parte (2a49568).
--
-- Con la talla guardada, la unidad sale en 516 de los 699 nombres activos de bici
-- y cuadro; sacándola del propio nombre (`parseBikeName`) sólo en 219, porque la
-- mitad de los nombres no tiene año detrás de la talla.
--
-- Cambiar RETURNS TABLE obliga a DROP + CREATE; los permisos se devuelven tal
-- cual estaban (anon, authenticated, service_role). Sólo se AÑADEN dos columnas:
-- un front que no las lee sigue funcionando.

DROP FUNCTION IF EXISTS public.search_inventory_with_metadata(text, text, boolean, boolean, boolean, boolean, integer, integer);

CREATE FUNCTION public.search_inventory_with_metadata(p_search text DEFAULT ''::text, p_warehouse text DEFAULT NULL::text, p_include_inactive boolean DEFAULT false, p_show_parts boolean DEFAULT false, p_only_scratch_dent boolean DEFAULT false, p_only_fedex_returns boolean DEFAULT false, p_offset integer DEFAULT 0, p_limit integer DEFAULT 30)
 RETURNS TABLE(id bigint, sku text, quantity integer, location text, location_id uuid, sublocation text[], item_name text, warehouse text, is_active boolean, internal_note text, distribution jsonb, created_at timestamp with time zone, location_sort_key integer, image_url text, length_in numeric, width_in numeric, height_in numeric, weight_lbs numeric, is_bike boolean, is_scratch_dent boolean, serial_number text, upc text, model text, condition_description text, pdf_link text, sd_price numeric, condition text, fedex_tracking_number text, fedex_return_id uuid, fedex_return_status text, size text, category text, total_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH normalized AS (
    SELECT
      TRIM(p_search)                                     AS raw_search,
      regexp_replace(TRIM(p_search), '[-\s]', '', 'g')   AS normalized_search,
      -- idea-154: the canonical spelling of the whole term, so '01-530' finds 01-0530.
      regexp_replace(public.canonical_sku(TRIM(p_search)), '[-\s]', '', 'g') AS canonical_key
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
      m.size, m.category
    FROM public.inventory i
    JOIN public.sku_metadata m ON m.sku = i.sku
    LEFT JOIN fdx_latest fx ON fx.sku = i.sku
    CROSS JOIN normalized n
    WHERE (p_warehouse IS NULL OR i.warehouse = p_warehouse)
      AND (p_include_inactive OR (i.is_active = TRUE AND i.quantity > 0))
      AND (NOT p_only_scratch_dent OR m.is_scratch_dent = TRUE)
      -- Bike/parts toggle: applies normally, but bypassed for FedEx-return
      -- rows (their seriales rarely match the bike-pattern trigger, so the
      -- toggle would hide them), for scratch-and-dent / only-fedex modes, and
      -- when p_show_parts IS NULL (search mode: bikes and parts together).
      AND (
        p_only_fedex_returns
        OR p_only_scratch_dent
        OR fx.return_id IS NOT NULL
        OR p_show_parts IS NULL
        OR m.is_bike = (NOT p_show_parts)
      )
      AND (NOT p_only_fedex_returns OR fx.return_id IS NOT NULL)
      AND (
        n.raw_search = ''
        OR i.item_name ILIKE '%' || n.raw_search || '%'
        OR i.location  ILIKE '%' || n.raw_search || '%'
        OR m.model ILIKE '%' || n.raw_search || '%'
        OR m.condition_description ILIKE '%' || n.raw_search || '%'
        OR (
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
        OR (
          n.normalized_search <> ''
          AND m.serial_number IS NOT NULL
          AND regexp_replace(m.serial_number, '[-\s]', '', 'g')
              ILIKE '%' || n.normalized_search || '%'
        )
        OR (
          n.normalized_search <> ''
          AND m.upc IS NOT NULL
          AND regexp_replace(m.upc, '[-\s]', '', 'g')
              ILIKE '%' || n.normalized_search || '%'
        )
        -- Match by FedEx tracking number → finds the inventory row linked to
        -- the return via fedex_return_items.sku, no matter where the bike
        -- currently lives. Uses a subquery rather than fx.tracking_number so
        -- it works for items whose sku didn't make it into fdx_latest's
        -- DISTINCT ON (e.g., a sku that lives in older returns).
        OR (
          n.normalized_search <> ''
          AND i.sku IN (
            SELECT fri2.sku FROM public.fedex_return_items fri2
            JOIN public.fedex_returns fr2 ON fr2.id = fri2.return_id
            WHERE regexp_replace(fr2.tracking_number, '[-\s]', '', 'g')
                  ILIKE '%' || n.normalized_search || '%'
          )
        )
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
    f.size, f.category,
    COUNT(*) OVER () AS total_count
  FROM filtered f
  ORDER BY
    f.location_sort_key ASC,
    (f.is_active AND f.quantity > 0) DESC,
    f.sku ASC
  OFFSET p_offset
  LIMIT p_limit;
$function$;

GRANT EXECUTE ON FUNCTION public.search_inventory_with_metadata(text, text, boolean, boolean, boolean, boolean, integer, integer)
  TO anon, authenticated, service_role;
