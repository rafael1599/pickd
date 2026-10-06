-- «Bring forward» (idea-253, P3; docs/prds/stock-card-edit-and-pick-square.md §4.C).
--
-- Lo contrario de DISTRIBUTE, que entierra lo que no se vende: una fila de un
-- SKU activo cuyos cuadros accesibles se quedaron sin stock mientras le queda
-- en uno enterrado. La tarjeta de Stock lo dice con una píldora (`B → A`) hasta
-- que un cuadro accesible vuelve a tener ese SKU.
--
-- Activo (Rafael, 6 oct 2026): ≥ 2 órdenes completadas en 90 días, o el SKU
-- saldría en «Bring to active» de /consolidation. Ni una regla nueva de
-- velocidad: las dos que ya existen (`get_sku_movement_stats_batch`,
-- `get_promotion_candidates`), unidas. Sólo filas cuyos grupos llevan cuadro:
-- sin la cantidad por cuadro no se sabe qué cara está vacía.

CREATE OR REPLACE FUNCTION public.bring_forward_rows()
 RETURNS TABLE(inventory_id bigint, sku text, location text, from_square text, to_square text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH squared AS (
    SELECT i.id, i.sku, upper(i.location) AS loc, e->>'square' AS sq,
           sum(GREATEST((e->>'count')::int, 0) * GREATEST((e->>'units_each')::int, 0)) AS units
    FROM inventory i
    CROSS JOIN LATERAL jsonb_array_elements(i.distribution) e
    WHERE i.is_active AND i.quantity > 0 AND i.warehouse = 'LUDLOW'
      AND i.location ILIKE 'ROW%'
      AND jsonb_typeof(i.distribution) = 'array' AND jsonb_array_length(i.distribution) > 0
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(i.distribution) x
        WHERE NOT (x ? 'square') OR (x->>'square') !~ '^[A-Z]$')
    GROUP BY 1, 2, 3, 4
  ),
  cand AS (
    SELECT s.id, s.sku, s.loc
    FROM squared s
    JOIN row_squares rs ON rs.location = s.loc AND rs.letter = s.sq
    GROUP BY 1, 2, 3
    HAVING NOT bool_or(rs.is_fast AND s.units > 0)
       AND bool_or(NOT rs.is_fast AND s.units > 0)
  ),
  recent AS (
    SELECT st.sku
    FROM get_sku_movement_stats_batch(
           (SELECT array_agg(DISTINCT c.sku) FROM cand c), now() - interval '90 days') st
    WHERE st.orders_completed >= 2
  ),
  active AS (
    SELECT r.sku FROM recent r
    UNION
    -- «Bring to active» reads the whole stock (~5 s): only when a candidate is
    -- not already active by its last 90 days.
    SELECT pc.sku FROM get_promotion_candidates(2, true, NULL) pc
    WHERE EXISTS (SELECT 1 FROM cand c WHERE c.sku NOT IN (SELECT r.sku FROM recent r))
      AND pc.sku IN (SELECT c.sku FROM cand c)
  )
  SELECT c.id, c.sku, c.loc, b.sq, b.to_sq
  FROM cand c
  CROSS JOIN LATERAL (
    -- The buried square closest to a face, and the face it goes to.
    SELECT s.sq,
           COALESCE((
             SELECT f.letter FROM row_squares f
             WHERE f.location = c.loc AND f.is_fast
             ORDER BY abs(ascii(f.letter) - ascii(s.sq)), f.letter
             LIMIT 1), 'A') AS to_sq
    FROM squared s
    JOIN row_squares rs ON rs.location = s.loc AND rs.letter = s.sq AND NOT rs.is_fast
    WHERE s.id = c.id AND s.units > 0
    ORDER BY (SELECT min(abs(ascii(f.letter) - ascii(s.sq))) FROM row_squares f
              WHERE f.location = c.loc AND f.is_fast), s.sq
    LIMIT 1
  ) b
  WHERE EXISTS (SELECT 1 FROM cand) AND c.sku IN (SELECT a.sku FROM active a)
  ORDER BY c.loc, c.sku;
$function$;

GRANT EXECUTE ON FUNCTION public.bring_forward_rows() TO authenticated, service_role;
