-- Historial de sesiones de /live-check (Rafael, 22 sep 2026: "agregar una tabla
-- de test para tener en historial en la cual se guarde el tipo de dispositivo
-- cada vez que se hace un test, y así sea más fácil tener acceso a esa
-- información relacionada a un commit específico").
--
-- Cada vez que se corre una sesión de escaneo en vivo y se genera la
-- telemetría R15 (botón "Copiar resultado" en LiveCheckScreen.tsx), se
-- guarda un registro: qué dispositivo la corrió y con qué build de la app,
-- para poder correlacionar un cambio de comportamiento con un commit
-- específico sin depender de que alguien haya pegado el JSON en un chat.
--
-- Append-only: sin política de UPDATE ni DELETE. RLS abierta a usuarios
-- autenticados (tabla operativa interna, mismo patrón que as400_captures /
-- shopping_list — no multi-tenant).
CREATE TABLE IF NOT EXISTS public.live_check_test_runs (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid REFERENCES auth.users(id),
  order_numbers      text[] NOT NULL DEFAULT '{}',
  group_id           text,
  boxes_confirmed    int NOT NULL DEFAULT 0,
  bikes_required     int NOT NULL DEFAULT 0,
  duration_seconds   int,
  -- El build corriendo en el dispositivo al momento del test: __BUILD_ID__
  -- (vite.config.ts) es "<commit corto>-<hora>"; app_commit ya viene separado
  -- para poder agrupar por commit sin parsear.
  app_build          text,
  app_commit         text,
  device_user_agent  text,
  device_label       text,
  device_os          text,
  device_is_mobile   boolean,
  -- El JSON completo TELEMETRIA_BARRIDO_LIVE_CHECK_R15, para no perder detalle
  -- que todavía no tiene su propia columna (cajas_detalle, tasas de lectura...).
  telemetry          jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS live_check_test_runs_created_at_idx
  ON public.live_check_test_runs (created_at DESC);

CREATE INDEX IF NOT EXISTS live_check_test_runs_app_commit_idx
  ON public.live_check_test_runs (app_commit);

ALTER TABLE public.live_check_test_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS live_check_test_runs_select ON public.live_check_test_runs;
CREATE POLICY live_check_test_runs_select
  ON public.live_check_test_runs FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS live_check_test_runs_insert ON public.live_check_test_runs;
CREATE POLICY live_check_test_runs_insert
  ON public.live_check_test_runs FOR INSERT TO authenticated WITH CHECK (true);

COMMENT ON TABLE public.live_check_test_runs IS
  'Historial append-only de sesiones de escaneo en /live-check: dispositivo usado y build de la app (app_commit), para correlacionar comportamiento con un commit específico. Se escribe al generar la telemetría R15 (handleCopyResult en LiveCheckScreen.tsx).';
