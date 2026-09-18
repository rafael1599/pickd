-- ============================================================================
-- Track A (F2 Sombra) · Sub-fase A1: Tabla label_scans
--
-- Tabla para almacenar los resultados del motor de reconocimiento de etiquetas
-- en sombra (Edge Function recognize-label):
--   · photo_key: referencia al objeto en el bucket privado R2 (no la foto en sí)
--   · taken_at: timestamp de captura en el dispositivo
--   · barcode_result: salida cruda del lector de códigos de barras (zxing-cpp)
--   · vlm_result: salida cruda del modelo de visión (Gemini Flash/Pro)
--   · arbitrated: fusión por campo (barra | leído | derivado | catálogo)
--   · conflict: true si hay etiquetas contradictorias o discrepancia irreconciliable
--   · reviewed_sku: SKU definitivo validado/ingresado por un humano en revisión
--   · created_at: fecha de inserción
--
-- RLS: Habilitado sin políticas para anon ni authenticated (solo service_role).
-- Realtime: Fuera de la publicación supabase_realtime.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.label_scans (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  photo_key       text NOT NULL,
  taken_at        timestamptz,
  barcode_result  jsonb,
  vlm_result      jsonb,
  arbitrated      jsonb,
  conflict        boolean NOT NULL DEFAULT false,
  reviewed_sku    text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.label_scans IS
  'Track A (F2 Sombra): Registros de escaneos de etiquetas procesados por recognize-label con barcode_result, vlm_result y arbitrated. Solo accesible por service_role.';

-- Índices de consulta operativa y auditoría
CREATE INDEX IF NOT EXISTS idx_label_scans_created_at
  ON public.label_scans (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_label_scans_photo_key
  ON public.label_scans (photo_key);

CREATE INDEX IF NOT EXISTS idx_label_scans_conflict
  ON public.label_scans (created_at DESC)
  WHERE conflict = true;

-- Seguridad: RLS estricto. Sin políticas de lectura/escritura para anon o authenticated.
-- service_role tiene BYPASSRLS y acceso total por defecto.
ALTER TABLE public.label_scans ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.label_scans FROM anon;
REVOKE ALL ON public.label_scans FROM authenticated;
GRANT ALL ON public.label_scans TO service_role;
