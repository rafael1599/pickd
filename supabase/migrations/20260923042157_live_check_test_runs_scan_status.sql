-- live_check_test_runs (20260923002234) guardaba un registro por cada click en
-- "Copiar resultado" — así que copiar el mismo resultado dos veces duplicaba
-- la fila. Rafael, 23 sep 2026: guardar una sola vez por sesión, al primero
-- que ocurra entre "copio el resultado" o "salgo de la pantalla", y que
-- diga si se llegó a escanear la orden completa o solo una parte.
--
-- El guard de una sola escritura por sesión vive en el cliente
-- (testRunSavedRef en LiveCheckScreen.tsx); estas columnas son el estado que
-- faltaba para contestar "¿esta prueba terminó la orden o quedó a medias?"
-- sin tener que parsear `telemetry`.
ALTER TABLE public.live_check_test_runs
  ADD COLUMN IF NOT EXISTS fully_scanned boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS progress_percent smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS save_trigger text;

COMMENT ON COLUMN public.live_check_test_runs.fully_scanned IS
  'true si al guardar la sesión ya tenía todas las bicis y partes requeridas verificadas (sessionState.stats.isGroupFullyVerified). false = se salió con la orden a medias.';
COMMENT ON COLUMN public.live_check_test_runs.progress_percent IS
  'sessionState.stats.progressPercent al momento de guardar (0-100).';
COMMENT ON COLUMN public.live_check_test_runs.save_trigger IS
  'Qué disparó este registro: "copy_result" (botón Copiar resultado) o "exit" (se salió de /live-check sin haber copiado). Solo el primero de los dos por sesión escribe fila.';
