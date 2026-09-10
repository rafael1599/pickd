-- Dónde discrepan PickD y AS400, por SKU.
--
-- El watchdog lee la pantalla `02. Stock File Inquiry` y guarda la pantalla
-- ENTERA en `sku_metadata.as400_snapshot` (watchdog f11a7e2, 8 sep 2026), no
-- solo el nombre. Ahí viene el `On Hand` de AS400 por almacén:
--
--       Inventory  NJ       FL       CA
--    On Hand       56        0        0
--
-- **LUDLOW es NJ** (Rafael, 10 sep 2026). Es la única correspondencia que hay
-- que saber para comparar, no se deduce de los datos, y hasta hoy no estaba
-- escrita en ninguna parte. Vive aquí, en SQL, porque aquí no puede quedar
-- desincronizada de la comparación que la usa.
--
-- Qué compara y qué no: AS400 da un total por SKU y almacén; PickD lo tiene
-- repartido por estante. Así que esto contesta "me faltan 3 CODA S2", nunca
-- "están en ROW 13 y no en ROW 8" — para eso está el cycle count. La suma NO
-- filtra por `is_active`: unidades escondidas en una fila inactiva son
-- exactamente el tipo de cosa que esta vista debe delatar, no ocultar, y por
-- eso van aparte en `pickd_en_filas_inactivas`.
--
-- Vacía hasta que el enriquecimiento escriba (fase F3, `SKU_ENRICH_WRITE`).
-- Eso es correcto: la vista existe para que el día que haya datos la respuesta
-- sea una query y no un proyecto.

CREATE OR REPLACE VIEW public.v_inventory_vs_as400 AS
SELECT
  m.sku,
  m.as400_description,
  m.as400_read_at,
  COALESCE(p.total, 0) AS pickd_ludlow,
  (m.as400_snapshot -> 'on_hand' ->> 'NJ')::int AS as400_nj,
  COALESCE(p.total, 0) - (m.as400_snapshot -> 'on_hand' ->> 'NJ')::int AS diferencia,
  COALESCE(p.inactivas, 0) AS pickd_en_filas_inactivas,
  COALESCE(p.filas, 0) AS pickd_filas
FROM sku_metadata m
LEFT JOIN (
  SELECT
    sku,
    SUM(quantity)::int AS total,
    SUM(quantity) FILTER (WHERE is_active IS NOT TRUE)::int AS inactivas,
    COUNT(*)::int AS filas
  FROM inventory
  WHERE warehouse = 'LUDLOW'
  GROUP BY sku
) p ON p.sku = m.sku
-- Solo los SKUs de los que AS400 ya dijo algo, y solo si dijo un número: sin
-- esto serían 2197 filas de NULL, y un `::int` sobre texto tumbaría la vista.
WHERE jsonb_typeof(m.as400_snapshot -> 'on_hand' -> 'NJ') = 'number';

COMMENT ON VIEW public.v_inventory_vs_as400 IS
  'PickD (LUDLOW) vs AS400 (On Hand NJ) por SKU. LUDLOW = NJ (Rafael, 10 sep 2026). Se llena cuando el enriquecimiento del watchdog entre en F3 (SKU_ENRICH_WRITE). Filtrar por diferencia <> 0.';
