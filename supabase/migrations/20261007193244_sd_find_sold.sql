-- idea-257 P4 — find the S/D that left.
--
-- 1. search_inventory_with_metadata: `#81` (or `#1A`) finds the S/D with that
--    number on its box. Base: the live definition (20261006181655, read from prod +
--    p_only_photo); only the sd_code_term column and its OR are new.
-- 2. search_sd_units(p_term): the S/D that are no longer on a shelf — archived
--    in sd_units, or sold and still sitting at 0 in their own row — by serial,
--    name, SKU or `#code`. Stock lists them under the results as SOLD S/D.

CREATE OR REPLACE FUNCTION public.search_inventory_with_metadata(p_search text DEFAULT ''::text, p_warehouse text DEFAULT NULL::text, p_include_inactive boolean DEFAULT false, p_show_parts boolean DEFAULT false, p_only_scratch_dent boolean DEFAULT false, p_only_fedex_returns boolean DEFAULT false, p_offset integer DEFAULT 0, p_limit integer DEFAULT 30, p_field text DEFAULT 'all'::text, p_only_photo boolean DEFAULT false)
 RETURNS TABLE(id bigint, sku text, quantity integer, location text, location_id uuid, sublocation text[], item_name text, warehouse text, is_active boolean, internal_note text, distribution jsonb, created_at timestamp with time zone, location_sort_key integer, image_url text, length_in numeric, width_in numeric, height_in numeric, weight_lbs numeric, is_bike boolean, is_scratch_dent boolean, serial_number text, upc text, model text, condition_description text, pdf_link text, sd_price numeric, condition text, fedex_tracking_number text, size text, category text, unit_kind text, base_sku text, received_at timestamp with time zone, sd_number integer, rma text, total_count bigint)
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
      COALESCE(NULLIF(p_field, ''), 'all')               AS field,
      -- idea-257 P4: `#81`, `#1A` is an S/D by the number on its box.
      CASE WHEN TRIM(p_search) ~ '^#\s*[0-9A-Za-z]{1,6}$'
           THEN upper(regexp_replace(TRIM(p_search), '^#\s*', '')) END AS sd_code_term
  ),
  filtered AS (
    SELECT
      i.id, i.sku, i.quantity, i.location, i.location_id, i.sublocation,
      i.item_name, i.warehouse, i.is_active, i.internal_note, i.distribution,
      i.created_at, i.location_sort_key,
      -- A return's photo is its FedEx label, which lives in sku_photos, not in
      -- image_url (52 of 64 have none): the Stock card shows it (6 Oct 2026).
      COALESCE(m.image_url, CASE WHEN m.unit_kind = 'return' THEN (
        SELECT COALESCE(p.thumbnail_url, p.url) FROM public.sku_photos p
         WHERE p.sku = m.sku ORDER BY p.created_at LIMIT 1) END) AS image_url,
      m.length_in, m.width_in, m.height_in, m.weight_lbs,
      m.is_bike, m.is_scratch_dent, m.serial_number,
      m.upc, m.model, m.condition_description,
      m.pdf_link, m.sd_price, m.condition,
      -- A return's SKU is its tracking (idea-250).
      CASE WHEN m.unit_kind = 'return' THEN i.sku END AS fedex_tracking_number,
      m.size, m.category, m.unit_kind, m.base_sku,
      -- When a return came in: its card's birth, not the row's (a move makes a new row).
      CASE WHEN m.unit_kind = 'return' THEN m.created_at END AS received_at,
      -- The card of photo-first Stock: an S/D's #n and a return's RMA.
      m.sd_number, m.rma
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
        OR (n.sd_code_term IS NOT NULL AND m.sd_number IS NOT NULL
            AND public.sd_code(m.sd_number) = n.sd_code_term)
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
    f.sd_number, f.rma,
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

CREATE OR REPLACE FUNCTION public.search_sd_units(p_term text, p_limit integer DEFAULT 10)
 RETURNS TABLE(unit_id bigint, sku text, sd_number integer, serial_number text, item_name text,
               cover_url text, left_at timestamp with time zone, left_order text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH t AS (
    SELECT TRIM(p_term) AS raw,
           regexp_replace(TRIM(p_term), '[-\s]', '', 'g') AS norm,
           CASE WHEN TRIM(p_term) ~ '^#\s*[0-9A-Za-z]{1,6}$'
                THEN upper(regexp_replace(TRIM(p_term), '^#\s*', '')) END AS code
  ),
  archived AS (
    SELECT u.id, u.sku, u.sd_number, u.serial_number, u.item_name, u.cover_url,
           u.left_at, u.left_order
      FROM public.sd_units u CROSS JOIN t
     WHERE (t.code IS NOT NULL AND public.sd_code(u.sd_number) = t.code)
        OR (t.code IS NULL AND length(t.norm) >= 3 AND (
              regexp_replace(COALESCE(u.serial_number, ''), '[-\s]', '', 'g') ILIKE '%' || t.norm || '%'
           OR regexp_replace(u.sku, '[-\s]', '', 'g') ILIKE '%' || t.norm || '%'
           OR u.item_name ILIKE '%' || t.raw || '%'
           OR u.catalog->>'model' ILIKE '%' || t.raw || '%'
           OR u.catalog->>'as400_description' ILIKE '%' || t.raw || '%'))
  ),
  -- Sold and never archived: the bike is still its row, at 0 (sd_sold_unit's rule).
  sold AS (
    SELECT NULL::bigint, m.sku, m.sd_number, m.serial_number,
           COALESCE((SELECT i.item_name FROM public.inventory i
                      WHERE i.sku = m.sku AND i.item_name IS NOT NULL
                      ORDER BY i.updated_at DESC NULLS LAST LIMIT 1), m.as400_description),
           m.image_url, l.created_at, l.order_number
      FROM public.sku_metadata m
      CROSS JOIN t
      CROSS JOIN LATERAL (
        SELECT g.created_at, g.order_number FROM public.inventory_logs g
         WHERE g.sku = m.sku AND g.quantity_change < 0 AND g.sd_unit_id IS NULL
         ORDER BY g.created_at DESC LIMIT 1) l
     WHERE (m.unit_kind = 'sd' OR m.sku ~ '^01-')
       AND NOT EXISTS (SELECT 1 FROM public.inventory i WHERE i.sku = m.sku AND i.quantity > 0)
       AND ((t.code IS NOT NULL AND public.sd_code(m.sd_number) = t.code)
         OR (t.code IS NULL AND length(t.norm) >= 3 AND (
               regexp_replace(COALESCE(m.serial_number, ''), '[-\s]', '', 'g') ILIKE '%' || t.norm || '%'
            OR regexp_replace(m.sku, '[-\s]', '', 'g') ILIKE '%' || t.norm || '%'
            OR m.model ILIKE '%' || t.raw || '%'
            OR m.as400_description ILIKE '%' || t.raw || '%')))
  )
  SELECT * FROM (SELECT * FROM archived UNION ALL SELECT * FROM sold) x
   ORDER BY x.left_at DESC NULLS LAST
   LIMIT GREATEST(COALESCE(p_limit, 10), 1);
$function$;
REVOKE ALL ON FUNCTION public.search_sd_units(text, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.search_sd_units(text, integer) TO authenticated, service_role;
