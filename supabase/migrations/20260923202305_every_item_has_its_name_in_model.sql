-- ============================================================================
-- Todo item con su nombre en `model` (23 sep 2026)
--
-- Rafael, al pasar 99-4807CL a parte: «eso borró por completo su nombre… cualquier
-- item que esté en pickd debe tener el nombre en model porque de no ser así
-- cualquier cosa que se edite hace que se pierda el nombre».
--
-- El formulario (ItemDetailView) no tiene campo de nombre: lo rehacía en cada
-- guardado como «modelo talla color». Sin modelo eso dejaba sólo talla y color —
-- 99-4807CL, `JRP FRAME RENEGADE S1 54 2024 CHARCOAL`, quedó en `54cm CHARCOAL`.
-- El formulario ya sólo rehace el nombre cuando hay modelo y esa edición tocó
-- modelo, talla o color (mismo commit); esto cierra el otro lado: que el modelo
-- esté.
--
-- Sólo rellena huecos. Nunca pisa un `model` ni un nombre con valor:
--   1. Partes y cuadros sin model: model := su nombre en inventario, o la
--      descripción del AS400 si no tienen nombre. Una parte se nombra por su
--      modelo solo — así están ya 1.232 de las partes que tienen model.
--   2. Un nombre de inventario vacío con descripción del AS400: se rellena.
--   3. 99-4807CL: su nombre vuelve (as400_description y las órdenes dicen
--      `JRP FRAME RENEGADE S1 54 2024 CHARCOAL`) y es un cuadro: category 'frame',
--      como los otros cinco.
--
-- Fuera, a propósito:
--   - Los marcadores de devolución FedEx (el SKU es el número de guía y el
--     «nombre» es `FedEx Return …`): cambian al procesarse.
--   - Las bicis: ninguna bici real está sin model (las 22 sin él son esos
--     marcadores y 07-3715GN, cuyo nombre ya es `12` y nada lo recuerda). Un
--     nombre de bici entero en `model` es la basura de bug-018, y `model` es la
--     llave de agrupación del export de FedEx.
--
-- Cada relleno queda en sku_model_backfills (append-only), para poder deshacerlo.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.sku_model_backfills (
  id         bigserial PRIMARY KEY,
  sku        text NOT NULL,
  field      text NOT NULL,          -- 'model' | 'item_name' | 'category'
  old_value  text,
  new_value  text NOT NULL,
  source     text NOT NULL,          -- 'inventory.item_name' | 'as400_description' | 'manual'
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.sku_model_backfills IS
  'Huecos de model/nombre rellenados por 20260923202305. Append-only; lectura admin.';

ALTER TABLE public.sku_model_backfills ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sku_model_backfills_select_admin ON public.sku_model_backfills;
CREATE POLICY sku_model_backfills_select_admin ON public.sku_model_backfills
  FOR SELECT TO authenticated USING (public.is_admin());
REVOKE ALL ON public.sku_model_backfills FROM anon;

-- ── 3) primero 99-4807CL, que es el que se rompió ─────────────────────────
INSERT INTO sku_model_backfills (sku, field, old_value, new_value, source)
SELECT i.sku, 'item_name', i.item_name, m.as400_description, 'as400_description'
  FROM inventory i JOIN sku_metadata m ON m.sku = i.sku
 WHERE i.sku = '99-4807CL'
   AND m.as400_description = 'JRP FRAME RENEGADE S1 54 2024 CHARCOAL'
   AND i.item_name IS DISTINCT FROM m.as400_description;

UPDATE inventory i
   SET item_name = m.as400_description
  FROM sku_metadata m
 WHERE m.sku = i.sku
   AND i.sku = '99-4807CL'
   AND m.as400_description = 'JRP FRAME RENEGADE S1 54 2024 CHARCOAL';

INSERT INTO sku_model_backfills (sku, field, old_value, new_value, source)
SELECT sku, 'category', category, 'frame', 'manual'
  FROM sku_metadata
 WHERE sku = '99-4807CL' AND coalesce(lower(category), '') <> 'frame';

UPDATE sku_metadata SET category = 'frame'
 WHERE sku = '99-4807CL' AND coalesce(lower(category), '') <> 'frame';

-- ── 1) partes y cuadros sin model ─────────────────────────────────────────
WITH candidates AS (
  SELECT m.sku,
         coalesce(
           (SELECT nullif(btrim(i.item_name), '')
              FROM inventory i
             WHERE i.sku = m.sku
               AND nullif(btrim(i.item_name), '') IS NOT NULL
               AND i.item_name !~* 'fedex return'
               AND upper(btrim(i.item_name)) <> upper(m.sku)
             ORDER BY i.quantity DESC NULLS LAST, i.updated_at DESC NULLS LAST
             LIMIT 1),
           nullif(btrim(m.as400_description), '')
         ) AS name,
         CASE WHEN EXISTS (
                SELECT 1 FROM inventory i
                 WHERE i.sku = m.sku AND nullif(btrim(i.item_name), '') IS NOT NULL
                   AND i.item_name !~* 'fedex return' AND upper(btrim(i.item_name)) <> upper(m.sku))
              THEN 'inventory.item_name' ELSE 'as400_description' END AS source
    FROM sku_metadata m
   WHERE nullif(btrim(m.model), '') IS NULL
     AND NOT coalesce(m.is_bike, false)
     -- Un número de guía no es un SKU de catálogo.
     AND m.sku !~ '^[0-9]{10,}$'
),
filled AS (
  INSERT INTO sku_model_backfills (sku, field, old_value, new_value, source)
  SELECT c.sku, 'model', NULL, c.name, c.source
    FROM candidates c
   WHERE c.name IS NOT NULL
  RETURNING sku, new_value
)
UPDATE sku_metadata m
   SET model = f.new_value
  FROM filled f
 WHERE m.sku = f.sku
   AND nullif(btrim(m.model), '') IS NULL;

-- ── 2) nombres de inventario vacíos que el AS400 sí sabe ───────────────────
WITH emptied AS (
  INSERT INTO sku_model_backfills (sku, field, old_value, new_value, source)
  SELECT DISTINCT i.sku, 'item_name', NULL, m.as400_description, 'as400_description'
    FROM inventory i JOIN sku_metadata m ON m.sku = i.sku
   WHERE nullif(btrim(i.item_name), '') IS NULL
     AND nullif(btrim(m.as400_description), '') IS NOT NULL
  RETURNING sku, new_value
)
UPDATE inventory i
   SET item_name = e.new_value
  FROM emptied e
 WHERE i.sku = e.sku
   AND nullif(btrim(i.item_name), '') IS NULL;
