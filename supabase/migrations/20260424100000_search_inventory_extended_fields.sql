-- Extend search_inventory_with_metadata to also OR across:
--   * sku_metadata.upc                     — UPC scanning from packaging
--   * sku_metadata.model                   — S/D-friendly ("Coda 21 Blue")
--   * sku_metadata.condition_description   — S/D-friendly
--
-- Return the new columns as well so callers (InventoryCard) can display them.
-- Normalized match (dashes/whitespace stripped) is reused for `upc` because
-- UPC values may be entered with or without separators.

-- Return-type changed (added upc/model/condition_description), so drop + recreate.
DROP FUNCTION IF EXISTS public.search_inventory_with_metadata(
  TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, INT, INT
);

CREATE OR REPLACE FUNCTION public.search_inventory_with_metadata(
  p_search            TEXT    DEFAULT '',
  p_warehouse         TEXT    DEFAULT NULL,
  p_include_inactive  BOOLEAN DEFAULT FALSE,
  p_show_parts        BOOLEAN DEFAULT FALSE,
  p_only_scratch_dent BOOLEAN DEFAULT FALSE,
  p_offset            INT     DEFAULT 0,
  p_limit             INT     DEFAULT 30
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
  filtered AS (
    SELECT
      i.id, i.sku, i.quantity, i.location, i.location_id, i.sublocation,
      i.item_name, i.warehouse, i.is_active, i.internal_note, i.distribution,
      i.created_at, i.location_sort_key,
      m.image_url, m.length_in, m.width_in, m.height_in, m.weight_lbs,
      m.is_bike, m.is_scratch_dent, m.serial_number,
      m.upc, m.model, m.condition_description
    FROM public.inventory i
    JOIN public.sku_metadata m ON m.sku = i.sku
    CROSS JOIN normalized n
    WHERE (p_warehouse IS NULL OR i.warehouse = p_warehouse)
      AND (p_include_inactive OR (i.is_active = TRUE AND i.quantity > 0))
      AND (NOT p_only_scratch_dent OR m.is_scratch_dent = TRUE)
      AND (p_only_scratch_dent OR m.is_bike = (NOT p_show_parts))
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
      )
  )
  SELECT
    f.id, f.sku, f.quantity, f.location, f.location_id, f.sublocation,
    f.item_name, f.warehouse, f.is_active, f.internal_note, f.distribution,
    f.created_at, f.location_sort_key,
    f.image_url, f.length_in, f.width_in, f.height_in, f.weight_lbs,
    f.is_bike, f.is_scratch_dent, f.serial_number,
    f.upc, f.model, f.condition_description,
    COUNT(*) OVER () AS total_count
  FROM filtered f
  ORDER BY f.location_sort_key ASC, f.sku ASC
  OFFSET p_offset
  LIMIT p_limit;
$$;

-- Trigram index on normalized UPC to keep the new match path performant
-- (same pattern as the existing serial_number / sku indexes).
CREATE INDEX IF NOT EXISTS idx_sku_metadata_upc_normalized_trgm
  ON public.sku_metadata
  USING gin (regexp_replace(upc, '[-\s]', '', 'g') gin_trgm_ops)
  WHERE upc IS NOT NULL;

GRANT EXECUTE ON FUNCTION public.search_inventory_with_metadata(
  TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, INT, INT
) TO anon, authenticated, service_role;
