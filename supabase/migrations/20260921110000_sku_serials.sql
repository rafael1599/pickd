-- ============================================================================
-- sku_serials · Fase 1: registro de seriales por unidad física
--
-- Hasta hoy el serial de una caja no tenía dónde vivir. `sku_metadata` lleva
-- UNA fila por SKU y su columna `serial_number` se agregó para Scratch & Dent
-- (20260417100000_extend_sku_metadata_for_sd.sql), donde la unidad es única
-- por definición. Guardar ahí el serial de una bici cualquiera hace que la
-- siguiente caja del mismo modelo lo reemplace, y deja al catálogo afirmando
-- un serial que pertenece a un solo cartón.
--
-- Esta tabla es la pieza que faltaba: UNA FILA POR CAJA FÍSICA. Se va
-- llenando sola a medida que se escanean etiquetas — no hace falta un
-- operativo de carga. La cobertura crece con el uso.
--
-- SOBRE LA UNICIDAD, que todavía no está medida:
-- Rafael confirmó que el QR no siempre es único, y la unicidad del serial es
-- justamente la pregunta abierta de R15. Por eso la restricción es
-- (sku, serial) y NO (serial) a secas: volver a escanear la misma caja es
-- idempotente, pero dos SKU distintos que compartan un serial ENTRAN los dos
-- en vez de fallarle en la cara al operario. Esa colisión es un dato, no un
-- error: la vista `sku_serial_collisions` la expone, y con eso la propia
-- tabla mide en producción la respuesta que R15 necesita.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.sku_serials (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  sku           text        NOT NULL,
  serial        text        NOT NULL,
  warehouse     text,
  -- Cómo llegó: 'label_scan' (foto de la etiqueta), 'live_check', 'manual'.
  source        text        NOT NULL DEFAULT 'label_scan',
  -- Lo que se leyó junto al serial, tal cual: sirve para auditar una lectura
  -- dudosa sin volver a la caja. No reemplaza a ninguna columna de arriba.
  observed      jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  seen_count    integer     NOT NULL DEFAULT 1,
  created_by    uuid,

  CONSTRAINT sku_serials_serial_len CHECK (char_length(serial) BETWEEN 3 AND 100),
  CONSTRAINT sku_serials_sku_len    CHECK (char_length(sku) BETWEEN 1 AND 100)
);

-- Re-escanear la misma caja actualiza la fila, no crea otra.
CREATE UNIQUE INDEX IF NOT EXISTS sku_serials_sku_serial_key
  ON public.sku_serials (sku, serial);

CREATE INDEX IF NOT EXISTS sku_serials_serial_idx
  ON public.sku_serials (serial);

CREATE INDEX IF NOT EXISTS sku_serials_sku_idx
  ON public.sku_serials (sku);

CREATE INDEX IF NOT EXISTS sku_serials_last_seen_idx
  ON public.sku_serials (last_seen_at DESC);

COMMENT ON TABLE public.sku_serials IS
  'Fase 1 de seriales: una fila por caja física observada. Se llena a medida que se escanean etiquetas. NO reemplaza sku_metadata.serial_number, que sigue siendo el serial de la unidad única de Scratch & Dent.';

-- ─── Cobertura: cuántos seriales conocemos de cada SKU ──────────────────────
-- Responde "¿cuánto llevamos completado?" sin recorrer la tabla a mano.
CREATE OR REPLACE VIEW public.sku_serial_coverage AS
  SELECT sku,
         count(*)            AS serials_known,
         min(first_seen_at)  AS first_seen_at,
         max(last_seen_at)   AS last_seen_at
  FROM public.sku_serials
  GROUP BY sku;

COMMENT ON VIEW public.sku_serial_coverage IS
  'Cuántos seriales distintos se han registrado por SKU. La cobertura contra el stock se calcula en la app, que es donde vive la cantidad.';

-- ─── Colisiones: el mismo serial en más de un SKU ───────────────────────────
-- Es la medición que R15 necesita para decidir si un serial sirve como
-- identidad de caja en la verificación en vivo. Vacía = serial único hasta hoy.
CREATE OR REPLACE VIEW public.sku_serial_collisions AS
  SELECT serial,
         count(DISTINCT sku)          AS sku_count,
         array_agg(DISTINCT sku)      AS skus,
         max(last_seen_at)            AS last_seen_at
  FROM public.sku_serials
  GROUP BY serial
  HAVING count(DISTINCT sku) > 1;

COMMENT ON VIEW public.sku_serial_collisions IS
  'Seriales vistos en más de un SKU. Mide en producción si el serial sirve como identidad única de caja (pregunta abierta de R15).';

-- ─── Seguridad ──────────────────────────────────────────────────────────────
-- Los operarios del piso escanean y consultan; nadie borra. Una lectura
-- equivocada se corrige por UPDATE, dejando seen_count y las fechas a la
-- vista, en vez de desaparecer sin rastro.
ALTER TABLE public.sku_serials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sku_serials_select_authenticated" ON public.sku_serials;
CREATE POLICY "sku_serials_select_authenticated"
  ON public.sku_serials FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "sku_serials_insert_authenticated" ON public.sku_serials;
CREATE POLICY "sku_serials_insert_authenticated"
  ON public.sku_serials FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "sku_serials_update_authenticated" ON public.sku_serials;
CREATE POLICY "sku_serials_update_authenticated"
  ON public.sku_serials FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Sin política de DELETE: no se borra desde la app.

COMMIT;
