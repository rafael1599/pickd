-- ============================================================================
-- Fix bug-017: auto_cancel_stale_orders no debe tocar inventario
--
-- ## El bug
-- La rama 'verification' (24h timeout) de auto_cancel_stale_orders llamaba
-- adjust_inventory_quantity con delta POSITIVO para "restorar" el inventario
-- de la orden auto-cancelada. La premisa era que esas órdenes ya habían
-- deducido inventario al pasar a verification. ESA PREMISA ES FALSA.
--
-- ## La realidad (verificada en process_picking_list)
-- La deducción real solo ocurre en process_picking_list() al transicionar a
-- 'completed' (supabase/migrations/20260307221638_remote_schema.sql:639-643).
-- Durante 'active', 'ready_to_double_check', 'double_checking' y
-- 'needs_correction', el inventario está INTACTO. Las "reservas" son
-- conceptuales — se calculan en el cliente iterando órdenes activas
-- (src/features/picking/hooks/usePickingActions.ts:187-213). No hay columna
-- en DB que represente reserva.
--
-- ## El daño
-- Cada vez que el cron auto-cancelaba una orden vencida en verification,
-- añadía unidades fantasma (delta +qty) a inventory. Una sola corrida el
-- 2026-04-09 19:49 UTC sobre la lista b992279c-1727-4d87-afdb-3a645d35af72
-- (combo de órdenes 879070/879068/878975/879069) generó 13 ADDs:
--   - 8 SKUs → rows nuevos con location = NULL (huérfanos visibles)
--   - 5 SKUs → rows existentes inflados +1 cada uno (los más peligrosos
--     porque se mezclaron con inventario legítimo: 03-3674BL ROW 20,
--     03-4241GY ROW 15, 03-4248GY ROW 25, 03-4270BK ROW 5, 03-4627BR ROW 27)
--
-- ## Este fix
-- 1. Reescribe auto_cancel_stale_orders rama verification para que SOLO
--    actualice el status — sin tocar inventario. Esto matchea exactamente lo
--    que hace la cancelación manual (usePickingActions.ts:512-518).
-- 2. Borra los 8 rows huérfanos creados por el bug (no son inventario real,
--    son artefactos del bug).
--
-- Las 5 inflaciones sobre rows legítimos NO se corrigen automáticamente
-- aquí — requieren verificación física en piso por warehouse staff antes
-- de aplicar la corrección. El reporte de SKUs a verificar está en la
-- conversación de Claude que generó esta migración.
-- ============================================================================

-- ─── 1. Reescribir auto_cancel_stale_orders ──────────────────────────────────
-- Verification branch ya no toca inventory. Building y reopened branches
-- siguen igual (esas estaban correctas).

CREATE OR REPLACE FUNCTION public.auto_cancel_stale_orders()
RETURNS TABLE(id uuid, order_number text, status text)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_expired_verification RECORD;
  v_stale_reopen RECORD;
BEGIN
  -- 1. 'building' orders inactive > 15 mins
  -- No inventory to release (never deducted at this stage).
  RETURN QUERY
  WITH cancelled_building AS (
    UPDATE picking_lists pl
    SET status = 'cancelled', updated_at = NOW()
    FROM user_presence up
    WHERE pl.user_id = up.user_id
      AND pl.status = 'building'
      AND pl.last_activity_at < NOW() - INTERVAL '15 minutes'
      AND (up.last_seen_at IS NULL OR up.last_seen_at < NOW() - INTERVAL '2 minutes')
    RETURNING pl.id, pl.order_number, 'cancelled_building'::text as status
  )
  SELECT * FROM cancelled_building;

  -- 2. 'ready_to_double_check' / 'double_checking' orders > 24 hours
  -- IMPORTANT: these orders never deducted inventory. The deduction only
  -- happens in process_picking_list() at the transition to 'completed'.
  -- Until then, items are only conceptually "reserved" (computed client-side
  -- by iterating active picking_lists). Therefore, auto-cancelling these
  -- orders must NOT touch inventory — same as manual cancel does.
  FOR v_expired_verification IN
    SELECT * FROM picking_lists
    WHERE picking_lists.status IN ('ready_to_double_check', 'double_checking')
    AND updated_at < NOW() - INTERVAL '24 hours'
    FOR UPDATE
  LOOP
    UPDATE picking_lists
    SET status = 'cancelled',
        updated_at = NOW(),
        notes = COALESCE(notes, '') || ' [System: Auto-cancelled due to 24h verification timeout]'
    WHERE picking_lists.id = v_expired_verification.id;

    id := v_expired_verification.id;
    order_number := v_expired_verification.order_number;
    status := 'cancelled_verification_timeout';
    RETURN NEXT;
  END LOOP;

  -- 3. Stuck 'reopened' orders > 2 hours
  -- No inventory adjustment needed — restore items from completed_snapshot
  -- and return to 'completed'.
  FOR v_stale_reopen IN
    SELECT * FROM picking_lists
    WHERE picking_lists.status = 'reopened'
    AND reopened_at < NOW() - INTERVAL '2 hours'
    FOR UPDATE
  LOOP
    UPDATE picking_lists SET
      items = COALESCE(completed_snapshot, items),
      status = 'completed',
      completed_snapshot = NULL,
      reopened_by = NULL,
      reopened_at = NULL,
      updated_at = NOW(),
      notes = COALESCE(notes, '') || ' [System: Auto-closed reopen after 2h timeout]'
    WHERE picking_lists.id = v_stale_reopen.id;

    id := v_stale_reopen.id;
    order_number := v_stale_reopen.order_number;
    status := 'cancelled_reopen_timeout';
    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$$;

COMMENT ON FUNCTION public.auto_cancel_stale_orders() IS
  'Auto-cancels stale picking lists. Verification branch (24h timeout) does NOT touch inventory because items are only reserved conceptually until process_picking_list() runs at completion. See bug-017 history.';

-- ─── 2. Borrar los 8 rows huérfanos del bug del 2026-04-09 19:49 UTC ─────────
-- Estos rows fueron creados por la versión vieja de auto_cancel_stale_orders
-- al tratar de "restorar" inventario que nunca se dedujo. Como tienen
-- location = NULL y item_name = 'Auto-cancel verification timeout', son
-- claramente artefactos identificables del bug. No representan inventario
-- físico real.
--
-- Verificado: hoy hay exactamente 8 rows con esta firma, ids 902170-902177.
-- Si esta migración corre dos veces, el segundo run no encuentra nada y es no-op.

DELETE FROM public.inventory
WHERE location IS NULL
  AND item_name = 'Auto-cancel verification timeout'
  AND created_at = '2026-04-09 19:49:00.031123+00';
