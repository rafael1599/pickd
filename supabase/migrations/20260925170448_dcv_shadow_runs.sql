-- ============================================================================
-- La sombra del lector en Double Check, y la foto del pallet sin carreras
-- (25 sep 2026, docs/label-recognition/09-plan-de-evaluacion.md etapa 8, E4)
-- ============================================================================
--
-- Cuatro piezas, todas aditivas:
--
--   1. append_pallet_photo / remove_pallet_photo — añadir o quitar una URL de
--      picking_lists.pallet_photos en UNA sentencia. DCV leía el arreglo,
--      le añadía la foto y lo reescribía; con dos personas fotografiando la
--      misma orden (el modo vista fotografía desde ec612bb) la segunda
--      escritura borraba la primera foto.
--   2. app_flags — interruptores que se cambian en la base, no en el build.
--      Nace con `dcv_shadow` APAGADO.
--   3. dcv_shadow_runs — una fila por foto que la sombra intentó leer, con
--      cualquier desenlace. Existe antes de encender el flag (doc 08 §6: el
--      instrumento de medición va primero).
--   4. Tres vistas de seguimiento, sólo admin (security_invoker sobre la RLS
--      de la tabla).
-- ============================================================================

-- ── 1) La foto del pallet, atómica ─────────────────────────────────────────
-- SECURITY INVOKER a propósito: picking_lists ya deja escribir a cualquier
-- autenticado (políticas «Collaborative *») y DCV escribía pallet_photos con
-- un UPDATE directo; la función hace lo mismo, con los mismos triggers, sólo
-- que sin leer antes. Idempotente: una URL que ya está no se repite (un
-- reintento de red no duplica la foto).
CREATE OR REPLACE FUNCTION public.append_pallet_photo(p_list_id uuid, p_url text)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  UPDATE picking_lists
     SET pallet_photos = CASE
           WHEN coalesce(pallet_photos, '[]'::jsonb) ? p_url THEN pallet_photos
           ELSE coalesce(pallet_photos, '[]'::jsonb) || jsonb_build_array(p_url)
         END
   WHERE id = p_list_id
  RETURNING pallet_photos;
$$;

-- Borrar tenía la misma carrera (filtrar la copia local y reescribir).
-- `jsonb - text` quita todo elemento string igual a la URL.
CREATE OR REPLACE FUNCTION public.remove_pallet_photo(p_list_id uuid, p_url text)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  UPDATE picking_lists
     SET pallet_photos = coalesce(pallet_photos, '[]'::jsonb) - p_url
   WHERE id = p_list_id
  RETURNING pallet_photos;
$$;

REVOKE ALL ON FUNCTION public.append_pallet_photo(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remove_pallet_photo(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.append_pallet_photo(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_pallet_photo(uuid, text) TO authenticated;

-- ── 2) app_flags ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.app_flags (
  key         text PRIMARY KEY,
  enabled     boolean NOT NULL DEFAULT false,
  config      jsonb NOT NULL DEFAULT '{}'::jsonb,
  note        text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.app_flags IS
  'Interruptores remotos: el cliente los lee al abrir la pantalla que los usa. '
  'Apagar uno no requiere redeploy. Leer: cualquier autenticado; escribir: admin.';

ALTER TABLE public.app_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_flags_select ON public.app_flags;
CREATE POLICY app_flags_select ON public.app_flags
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS app_flags_write_admin ON public.app_flags;
CREATE POLICY app_flags_write_admin ON public.app_flags
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

REVOKE ALL ON public.app_flags FROM anon;

-- sample_rate: probabilidad, por FOTO, de que la corrida entre en la muestra
-- que se adjudica (E4); la elegida sube además el original a sample/, que no
-- expira. timeout_ms: tope por foto antes de matar el Worker. queue_max: fotos
-- en espera antes de anotar `dropped`. upload_r2000: subir también la copia
-- de 2000 px (r2000/, 180 días). only_users: si la lista existe, sólo esos
-- auth.uid() corren la sombra; vacía es NADIE (encenderla en un dispositivo
-- primero = poner su usuario y enabled = true). Quitar la llave = todos.
INSERT INTO public.app_flags (key, enabled, config, note)
VALUES (
  'dcv_shadow',
  false,
  '{"sample_rate": 0.25, "timeout_ms": 60000, "queue_max": 3, "upload_r2000": true, "only_users": []}'::jsonb,
  'Sombra del lector en Double Check (09-plan-de-evaluacion.md, etapa 8)'
)
ON CONFLICT (key) DO NOTHING;

-- ── 3) dcv_shadow_runs ─────────────────────────────────────────────────────
-- Sin FK a propósito: order_groups se BORRA al cancelar un grupo y
-- picking_lists.group_id es ON DELETE SET NULL; una FK perdería el grupo justo
-- en las órdenes canceladas. group_members guarda quién formaba el grupo.
CREATE TABLE IF NOT EXISTS public.dcv_shadow_runs (
  id                  uuid PRIMARY KEY,          -- lo genera el cliente: idempotencia
  created_at          timestamptz NOT NULL DEFAULT now(),
  user_id             uuid NOT NULL DEFAULT auth.uid(),

  -- La orden, tal como estaba en el instante de la foto
  list_id             uuid,
  group_id            uuid,
  group_members       uuid[] NOT NULL DEFAULT '{}',
  group_lines         jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{list_id, sku, qty}]

  -- La foto. photo_id es el mismo que la copia pública de 1200 px.
  photo_id            uuid NOT NULL,
  photo_key           text,                       -- full/AAAA/MM/<photo_id>.jpg
  photo_width         integer,
  photo_height        integer,
  photo_bytes         integer,
  upload_status       text NOT NULL DEFAULT 'skipped'
                        CHECK (upload_status IN ('ok', 'error', 'skipped')),
  sample_rate         numeric,                    -- el vigente al decidir
  sampled             boolean NOT NULL DEFAULT false,

  -- Quién y con qué
  device              jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {label, ua, memory_gb, cores}
  app_commit          text,
  engine_config_hash  text,
  engine_config       jsonb,

  -- Qué pasó
  status              text NOT NULL
                        CHECK (status IN ('ok', 'error', 'timeout', 'unsupported', 'dropped')),
  error               text,
  timing_ms           jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {queue, barcodes, ocr, segmentation, total, upload}
  boxes               jsonb NOT NULL DEFAULT '[]'::jsonb   -- [{sku, source, confidence, bbox:{x,y,w,h} en px de la foto original}]
);

COMMENT ON TABLE public.dcv_shadow_runs IS
  'Una fila por foto de pallet que la sombra de Double Check intentó leer, con '
  'cualquier desenlace (dropped/unsupported/timeout/error cuentan). El picker no '
  've nada de esto. bbox en píxeles de la foto original. Sin FK: el grupo se '
  'borra al cancelar. Escribe el propio usuario; lee admin; fuera de realtime.';

CREATE INDEX IF NOT EXISTS dcv_shadow_runs_created_at_idx ON public.dcv_shadow_runs (created_at);
CREATE INDEX IF NOT EXISTS dcv_shadow_runs_list_id_idx ON public.dcv_shadow_runs (list_id);

ALTER TABLE public.dcv_shadow_runs ENABLE ROW LEVEL SECURITY;

-- Append-only: ninguna política de UPDATE ni DELETE.
DROP POLICY IF EXISTS dcv_shadow_runs_insert_own ON public.dcv_shadow_runs;
CREATE POLICY dcv_shadow_runs_insert_own ON public.dcv_shadow_runs
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS dcv_shadow_runs_select_admin ON public.dcv_shadow_runs;
CREATE POLICY dcv_shadow_runs_select_admin ON public.dcv_shadow_runs
  FOR SELECT TO authenticated USING (public.is_admin());

REVOKE ALL ON public.dcv_shadow_runs FROM anon;

-- ── 4) Seguimiento ─────────────────────────────────────────────────────────
-- Intervalo de Wilson al 95 % (09-plan §2).
CREATE OR REPLACE FUNCTION public.wilson_bounds(k bigint, n bigint)
RETURNS TABLE (lo numeric, hi numeric)
LANGUAGE sql IMMUTABLE
AS $$
  SELECT
    CASE WHEN n = 0 THEN NULL ELSE round(((p + z*z/(2*n) - z*sqrt(p*(1-p)/n + z*z/(4*n*n))) / (1 + z*z/n))::numeric, 4) END,
    CASE WHEN n = 0 THEN NULL ELSE round(((p + z*z/(2*n) + z*sqrt(p*(1-p)/n + z*z/(4*n*n))) / (1 + z*z/n))::numeric, 4) END
  FROM (SELECT CASE WHEN n = 0 THEN 0 ELSE k::float8 / n END AS p, 1.959964::float8 AS z) s;
$$;

-- La llave de comparación: la del catálogo (sku_key), sobre la grafía
-- canónica, para que el `01-288` que lee el OCR case con `01-0288` (doc 08 §2.1).
CREATE OR REPLACE FUNCTION public.dcv_sku_key(p_sku text)
RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT nullif(regexp_replace(upper(public.canonical_sku(p_sku)), '[^A-Z0-9]', '', 'g'), '');
$$;

-- Cobertura: fotos `ok` sobre TODAS las fotos tomadas — dropped, unsupported,
-- timeout y error cuentan como no leídas (E4).
CREATE OR REPLACE VIEW public.v_dcv_shadow_daily
WITH (security_invoker = true) AS
SELECT
  (r.created_at AT TIME ZONE 'America/New_York')::date AS day,
  count(*)                                          AS photos,
  count(*) FILTER (WHERE r.status = 'ok')           AS ok,
  count(*) FILTER (WHERE r.status = 'error')        AS error,
  count(*) FILTER (WHERE r.status = 'timeout')      AS timeout,
  count(*) FILTER (WHERE r.status = 'unsupported')  AS unsupported,
  count(*) FILTER (WHERE r.status = 'dropped')      AS dropped,
  round(count(*) FILTER (WHERE r.status = 'ok')::numeric / count(*), 4) AS coverage,
  (public.wilson_bounds(count(*) FILTER (WHERE r.status = 'ok'), count(*))).lo AS coverage_lo,
  (public.wilson_bounds(count(*) FILTER (WHERE r.status = 'ok'), count(*))).hi AS coverage_hi,
  count(*) FILTER (WHERE r.upload_status = 'ok')    AS uploaded,
  count(*) FILTER (WHERE r.sampled)                 AS sampled,
  percentile_cont(0.5)  WITHIN GROUP (ORDER BY (r.timing_ms->>'total')::numeric)
    FILTER (WHERE r.status = 'ok')                  AS total_ms_p50,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY (r.timing_ms->>'total')::numeric)
    FILTER (WHERE r.status = 'ok')                  AS total_ms_p95
FROM public.dcv_shadow_runs r
GROUP BY 1;

CREATE OR REPLACE VIEW public.v_dcv_shadow_by_device
WITH (security_invoker = true) AS
SELECT
  coalesce(r.device->>'label', 'unknown')           AS device,
  count(*)                                          AS photos,
  count(*) FILTER (WHERE r.status = 'ok')           AS ok,
  round(count(*) FILTER (WHERE r.status = 'ok')::numeric / count(*), 4) AS coverage,
  percentile_cont(0.5)  WITHIN GROUP (ORDER BY (r.timing_ms->>'total')::numeric)
    FILTER (WHERE r.status = 'ok')                  AS total_ms_p50,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY (r.timing_ms->>'total')::numeric)
    FILTER (WHERE r.status = 'ok')                  AS total_ms_p95,
  percentile_cont(0.5)  WITHIN GROUP (ORDER BY r.photo_width::numeric * r.photo_height)
                                                    AS pixels_p50,
  min(r.created_at)                                 AS first_seen,
  max(r.created_at)                                 AS last_seen
FROM public.dcv_shadow_runs r
GROUP BY 1;

-- Por corrida `ok` y por sku_key: cuántas cajas leyó el motor contra cuántas
-- pide el grupo en ese instante. Se comparan CANTIDADES: 6 leídas de un SKU
-- que el grupo pide 4 son 2 de más, y contar de más es verde falso (E4).
--
-- «missing» NO es recall: una foto casi nunca muestra todas las cajas del
-- pallet. El recall sale de la muestra adjudicada (sampled), nunca de aquí.
--
--   verdict = 'covered'      leídas ≤ pedidas, todas casan
--             'extra_known'  sobran y el SKU existe en el catálogo → candidato a verde falso
--             'extra_unknown' sobran y el SKU no existe → UNIDENTIFIED, no alarma (doc 08 §2.3)
--             'missing'      el grupo lo pide y el motor no leyó ninguna
CREATE OR REPLACE VIEW public.v_dcv_shadow_vs_group
WITH (security_invoker = true) AS
WITH ok_runs AS (
  SELECT * FROM public.dcv_shadow_runs WHERE status = 'ok'
),
read AS (
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
  END                                                  AS verdict
FROM joined j
JOIN ok_runs r ON r.id = j.run_id;

COMMENT ON VIEW public.v_dcv_shadow_vs_group IS
  'Motor contra el grupo, por corrida ok y sku_key, en cantidades. extra_known = '
  'candidato a verde falso. «missing» NO es recall: la foto casi nunca muestra '
  'todas las cajas; el recall sale de la muestra adjudicada (sampled).';

REVOKE ALL ON public.v_dcv_shadow_daily, public.v_dcv_shadow_by_device, public.v_dcv_shadow_vs_group FROM anon;
