-- ============================================================================
-- Migración: Sin auto-cancel ni reversión de órdenes por tiempo
-- Fecha: 8 de octubre de 2026
-- Decisión: Rafael (8 oct 2026)
--
-- «Necesitamos desaparecer este tipo de comportamiento y dejar documentado o
-- poniendo un guard… que cuando se intente hacer algo similar de nuevo nos pare
-- y advierta sobre la decisión de hoy.»
--
-- Contexto medido en prod el 8 oct 2026:
-- - cron.job 1 ('*/1 * * * *', 'SELECT auto_cancel_stale_orders()') corría cada minuto.
-- - La función viva tenía tres ramas:
--   1. 'building': estado que ya no existe en la máquina de estados.
--   2. 24 h en 'ready_to_double_check' / 'double_checking': cancelaba y sumaba a
--      inventario unidades nunca descontadas (46 unidades fantasma en 7 corridas,
--      9 abr – 16 jul; ya se había arreglado el 10 abr en 20260410120000 y una
--      migración posterior la resucitó desde una copia vieja).
--   3. 2 h en 'reopened': revertía la reapertura aunque hubiera trabajo (2 veces,
--      16 abr y 17 sep #881618).
--
-- Lo abandonado se resuelve a mano:
-- «Continue Editing» / «Take Over & Edit» para 'reopened'; cancelar es decisión de
-- una persona.
--
-- Esta migración:
-- 1. Desagenda de pg_cron el job que llama a auto_cancel_stale_orders por su comando.
-- 2. Redefine auto_cancel_stale_orders() con la misma firma y tipo de retorno,
--    SECURITY DEFINER y search_path, pero cuerpo vacío (retorna 0 filas). No se
--    elimina la función para mantener compatibilidad aditiva con la edge function
--    auto-cancel-orders.
-- ============================================================================

-- 1. Desagendar job de pg_cron por su comando (idempotente y a prueba de entornos sin pg_cron)
DO $cron_cleanup$
DECLARE
  v_jobid bigint;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'cron' AND table_name = 'job'
  ) AND EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'cron' AND p.proname = 'unschedule'
  ) THEN
    FOR v_jobid IN
      EXECUTE 'SELECT jobid FROM cron.job WHERE command ILIKE ''%auto_cancel_stale_orders%'''
    LOOP
      EXECUTE 'SELECT cron.unschedule($1)' USING v_jobid;
    END LOOP;
  END IF;
END;
$cron_cleanup$;

-- 2. Redefinir auto_cancel_stale_orders con cuerpo vacío (aditivo, 0 filas retornadas)
CREATE OR REPLACE FUNCTION public.auto_cancel_stale_orders()
 RETURNS TABLE(id uuid, order_number text, status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Decisión de Rafael (8 oct 2026): PickD deja de cancelar o revertir órdenes por reloj.
  -- Lo abandonado lo resuelve una persona a mano.
  -- Esta función se mantiene vacía para compatibilidad con la edge function auto-cancel-orders.
  RETURN;
END;
$function$;

COMMENT ON FUNCTION public.auto_cancel_stale_orders() IS
  'Desactivada por decisión de Rafael el 8 de octubre de 2026: PickD no cancela ni revierte órdenes por reloj. Lo abandonado lo resuelve una persona a mano (Continue Editing / Take Over & Edit); la función no hace mutaciones y retorna 0 filas por compatibilidad.';
