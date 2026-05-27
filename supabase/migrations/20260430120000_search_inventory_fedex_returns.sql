-- Extend search_inventory_with_metadata so FedEx returns are searchable from
-- /inventory:
--   1. New OR clause matches by fedex_returns.tracking_number (normalized).
--   2. New parameter p_only_fedex_returns scopes results to rows linked to a
--      return; bypasses the bike/parts filter (returns are stored as serials,
--      not bike-pattern SKUs).
--   3. Returns 3 extra columns so the UI can render the badge:
--        fedex_tracking_number, fedex_return_id, fedex_return_status
--      Picks the most recently received return when 1+ returns share a sku.
--
-- Return-type change → drop+recreate.

DROP FUNCTION IF EXISTS public.search_inventory_with_metadata(
  TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, INT, INT
);
DROP FUNCTION IF EXISTS public.search_inventory_with_metadata(
  TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, INT, INT
);

CREATE OR REPLACE FUNCTION public.search_inventory_with_metadata(
  p_search             TEXT    DEFAULT '',
  p_warehouse          TEXT    DEFAULT NULL,
  p_include_inactive   BOOLEAN DEFAULT FALSE,
  p_show_parts         BOOLEAN DEFAULT FALSE,
  p_only_scratch_dent  BOOLEAN DEFAULT FALSE,
  p_only_fedex_returns BOOLEAN DEFAULT FALSE,
  p_offset             INT     DEFAULT 0,
  p_limit              INT     DEFAULT 30
)
RETURNS TABLE (
  id                BIGINT,
  sku               TEXT,
  quantity          INT,
  location          TEXT,
  location_id       UUID,
  sublocation       TEXT[],
  item_name         TEXT,
  warehouse         TEXT,
  is_active         BOOLEAN,
  internal_note     TEXT,
  distribution      JSONB,
  created_at        TIMESTAMPTZ,
  location_sort_key INT,
  image_url         TEXT,
  length_in         NUMERIC,
  width_in          NUMERIC,
  height_in         NUMERIC,
  weight_lbs        NUMERIC,
  is_bike           BOOLEAN,
  is_scratch_dent   BOOLEAN,
  serial_number     TEXT,
  upc               TEXT,
  model             TEXT,
  condition_description TEXT,
  pdf_link          TEXT,
  sd_price          NUMERIC,
  condition         TEXT,
  fedex_tracking_number TEXT,
  fedex_return_id   UUID,
  fedex_return_status TEXT,
  total_count       BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH normalized AS (
    SELECT
      TRIM(p_search)                                     AS raw_search,
      regexp_replace(TRIM(p_search), '[-\s]', '', 'g')   AS normalized_search
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
      fx.status          AS fedex_return_status
    FROM public.inventory i
    JOIN public.sku_metadata m ON m.sku = i.sku
    LEFT JOIN fdx_latest fx ON fx.sku = i.sku
    CROSS JOIN normalized n
    WHERE (p_warehouse IS NULL OR i.warehouse = p_warehouse)
      AND (p_include_inactive OR (i.is_active = TRUE AND i.quantity > 0))
      AND (NOT p_only_scratch_dent OR m.is_scratch_dent = TRUE)
      -- Bike/parts toggle: applies normally, but bypassed for FedEx-return
      -- rows (their seriales rarely match the bike-pattern trigger, so the
      -- toggle would hide them) and for scratch-and-dent / only-fedex modes.
      AND (
        p_only_fedex_returns
        OR p_only_scratch_dent
        OR fx.return_id IS NOT NULL
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
    COUNT(*) OVER () AS total_count
  FROM filtered f
  ORDER BY f.location_sort_key ASC, f.sku ASC
  OFFSET p_offset
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.search_inventory_with_metadata(
  TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, INT, INT
) TO anon, authenticated, service_role;
