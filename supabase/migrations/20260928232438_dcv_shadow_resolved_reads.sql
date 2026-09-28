-- idea-238, paso 1: la sombra compara lo que Double Check usaría, no la lectura cruda.
--
-- Desde el 28 sep 2026 cada caja de dcv_shadow_runs.boxes puede traer
-- `resolved_sku` (+ `resolved_how`): la lectura resuelta contra las líneas del
-- grupo por `resolveAgainstOrder` (src/features/picking/utils), que corta la
-- letra de color perdida (`06-4588B`), elige el candidato de la orden en un
-- CONFLICTO y corrige un carácter — y **nunca** convierte en SKU de la orden una
-- lectura que es otra bici real del catálogo.
--
-- La vista pasa a contar la lectura resuelta (con la cruda de respaldo) y
-- añade al final `raw_read_qty`: lo que leyó el motor tal cual, para seguir
-- midiendo el motor sin la ayuda de la orden. Aditivo: las columnas de antes
-- siguen en su sitio.

CREATE OR REPLACE VIEW public.v_dcv_shadow_vs_group
WITH (security_invoker = true) AS
WITH ok_runs AS (
  SELECT * FROM public.dcv_shadow_runs WHERE status = 'ok'
),
read AS (
  SELECT r.id AS run_id,
         public.dcv_sku_key(coalesce(b->>'resolved_sku', b->>'sku')) AS sku_key,
         count(*)::numeric AS qty
    FROM ok_runs r, jsonb_array_elements(r.boxes) b
   WHERE public.dcv_sku_key(coalesce(b->>'resolved_sku', b->>'sku')) IS NOT NULL
   GROUP BY 1, 2
),
raw AS (
  SELECT r.id AS run_id, public.dcv_sku_key(b->>'sku') AS sku_key, count(*)::numeric AS qty
    FROM ok_runs r, jsonb_array_elements(r.boxes) b
   WHERE public.dcv_sku_key(b->>'sku') IS NOT NULL
   GROUP BY 1, 2
),
expected AS (
  SELECT r.id AS run_id, public.dcv_sku_key(l->>'sku') AS sku_key,
         sum(coalesce((l->>'qty')::numeric, 0)) AS qty
    FROM ok_runs r, jsonb_array_elements(r.group_lines) l
   WHERE public.dcv_sku_key(l->>'sku') IS NOT NULL
   GROUP BY 1, 2
),
joined AS (
  SELECT coalesce(rd.run_id, ex.run_id)   AS run_id,
         coalesce(rd.sku_key, ex.sku_key) AS sku_key,
         coalesce(rd.qty, 0)              AS read_qty,
         coalesce(ex.qty, 0)              AS expected_qty
    FROM read rd
    FULL JOIN expected ex ON ex.run_id = rd.run_id AND ex.sku_key = rd.sku_key
)
SELECT
  r.id                  AS run_id,
  r.created_at,
  r.list_id,
  r.group_id,
  r.photo_id,
  r.sampled,
  r.engine_config_hash,
  j.sku_key,
  j.read_qty,
  j.expected_qty,
  least(j.read_qty, j.expected_qty)                    AS covered,
  greatest(j.expected_qty - j.read_qty, 0)             AS missing,
  greatest(j.read_qty - j.expected_qty, 0)             AS extra,
  EXISTS (SELECT 1 FROM public.sku_metadata m WHERE m.sku_key = j.sku_key) AS in_catalog,
  CASE
    WHEN j.read_qty > j.expected_qty AND EXISTS (SELECT 1 FROM public.sku_metadata m WHERE m.sku_key = j.sku_key)
      THEN 'extra_known'
    WHEN j.read_qty > j.expected_qty THEN 'extra_unknown'
    WHEN j.read_qty = 0 THEN 'missing'
    ELSE 'covered'
  END                                                  AS verdict,
  coalesce(rw.qty, 0)                                  AS raw_read_qty
FROM joined j
JOIN ok_runs r ON r.id = j.run_id
LEFT JOIN raw rw ON rw.run_id = j.run_id AND rw.sku_key = j.sku_key;

COMMENT ON VIEW public.v_dcv_shadow_vs_group IS
  'Motor contra el grupo, por corrida ok y sku_key, en cantidades, con la lectura '
  'resuelta contra la orden (resolved_sku, idea-238); raw_read_qty = lo que leyó el '
  'motor tal cual. extra_known = candidato a verde falso. «missing» NO es recall: '
  'la foto casi nunca muestra todas las cajas; el recall sale de la muestra adjudicada.';

REVOKE ALL ON public.v_dcv_shadow_vs_group FROM anon;
