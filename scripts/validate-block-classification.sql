-- Validación read-only de la lógica de get_block_classification_candidates.
-- Correr en el SQL Editor de Supabase (prod). No escribe nada.
-- Devuelve ~120 filas: unos pocos KB de egress.

WITH params AS (
  SELECT 30 AS recency_days,
         ARRAY['ROW 28','ROW 29','ROW 30','ROW 31','ROW 32','ROW 33'] AS rows_in_scope
),
stock AS (
  SELECT i.sku, sum(i.quantity) AS total_qty
  FROM inventory i, params p
  WHERE i.is_active AND i.quantity > 0 AND i.location = ANY(p.rows_in_scope)
  GROUP BY i.sku
),
main_cell AS (
  SELECT DISTINCT ON (i.sku) i.sku, i.location, i.sublocation
  FROM inventory i, params p
  WHERE i.is_active AND i.quantity > 0 AND i.location = ANY(p.rows_in_scope)
  ORDER BY i.sku, i.quantity DESC
)
SELECT
  CASE WHEN c.location IN ('ROW 31','ROW 32','ROW 33') THEN 'A' ELSE 'B' END AS bloque,
  CASE WHEN m.last_shipped IS NOT NULL
            AND m.last_shipped >= now() - make_interval(days => (SELECT recency_days FROM params))
       THEN 'MOVER' ELSE 'NO-MOVER' END AS clase,
  s.sku,
  s.total_qty,
  c.location,
  array_to_string(c.sublocation, '/') AS subloc,
  m.orders_completed,
  m.last_shipped::date AS ultimo_envio,
  CASE WHEN s.total_qty >= 20 THEN 'DS-Pallet' ELSE 'Pull First' END AS destino
FROM stock s
JOIN main_cell c ON c.sku = s.sku
CROSS JOIN LATERAL get_sku_movement_stats(s.sku, now() - interval '12 months') m
ORDER BY bloque, clase, s.total_qty DESC;

-- Resumen compacto (una sola fila por bloque/clase) si preferís pegar menos:
--
-- ... reemplazar el SELECT final por:
-- SELECT bloque, clase, count(*) AS skus, sum(total_qty) AS unidades,
--        count(*) FILTER (WHERE total_qty >= 20) AS ganan_pallet
-- FROM (...el mismo cuerpo...) t GROUP BY bloque, clase ORDER BY 1,2;
