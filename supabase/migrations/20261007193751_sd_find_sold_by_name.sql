-- idea-257 P4: search_sd_units also matches the name a sold S/D carries in
-- inventory (item_name), not only its catalogue model — a few S/D have no
-- model (6 of 213 on 7 Oct 2026) and their name is all there is.
-- Base: 20261007193244_sd_find_sold.sql.

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
           COALESCE(nm.item_name, m.as400_description),
           m.image_url, l.created_at, l.order_number
      FROM public.sku_metadata m
      CROSS JOIN t
      LEFT JOIN LATERAL (
        SELECT i.item_name FROM public.inventory i
         WHERE i.sku = m.sku AND i.item_name IS NOT NULL
         ORDER BY i.updated_at DESC NULLS LAST LIMIT 1) nm ON true
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
            OR nm.item_name ILIKE '%' || t.raw || '%'
            OR m.as400_description ILIKE '%' || t.raw || '%')))
  )
  SELECT * FROM (SELECT * FROM archived UNION ALL SELECT * FROM sold) x
   ORDER BY x.left_at DESC NULLS LAST
   LIMIT GREATEST(COALESCE(p_limit, 10), 1);
$function$;
REVOKE ALL ON FUNCTION public.search_sd_units(text, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.search_sd_units(text, integer) TO authenticated, service_role;
