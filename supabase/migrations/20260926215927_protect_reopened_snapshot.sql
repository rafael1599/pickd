-- ============================================================================
-- bug-036: una orden reabierta no puede perder `reopened` por un camino lateral
-- (26 sep 2026; análisis en label-bench/bugs/036/)
-- ============================================================================
--
-- `reopened` es lo único que le dice a la base que la orden YA descontó su stock
-- y que al cerrarla hay que re-completar por diferencia contra
-- `completed_snapshot` (recomplete_picking_list). Si la orden sale de ese
-- estado por otro camino, el siguiente completado va por process_picking_list
-- y la descuenta ENTERA otra vez.
--
-- El 17 sep se arregló markAsReady, pero seguían dos barridos de hermanas en
-- el cliente (releaseCheck, returnToPicker) y el Resume de waiting
-- (unmark_picking_list_waiting), que la dejaban en ready_to_double_check /
-- needs_correction con el snapshot intacto. Medido: 7 órdenes descontadas dos
-- veces (#879534, #880132, #881043, #881373, #881425, #881488, #881612); sólo
-- dos se repararon el 18 sep (bug-039), las otras cinco siguen con ~31
-- unidades de más en los logs (bug-041).
--
-- Dos cosas:
--   1. Una GUARDA en la base, para que ningún camino futuro lo repita: una fila
--      en `reopened` con snapshot sólo sale hacia `completed` si el snapshot se
--      vacía en la misma escritura (recomplete_picking_list, cancel_reopen, el
--      auto-cancel de 2 h), o hacia `cancelled`. Cualquier otro destino se
--      queda en `reopened` (con un WARNING en el log de Postgres): un barrido de
--      grupo no puede reventar por una hermana reabierta, pero tampoco la mueve.
--      Vaciar el snapshot dejándola abierta es un error.
--      Sólo mira filas QUE ESTÁN en `reopened`: una cancelada que se restaura
--      (restore_cancelled_order → active) no es asunto de la guarda, aunque
--      cancel_completed_order no le haya vaciado el snapshot.
--   2. El Resume de waiting devuelve una reabierta a `reopened`, como
--      mark_picking_list_waiting ya la conserva al entrar.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.protect_reopened_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.status <> 'reopened' OR OLD.completed_snapshot IS NULL THEN
    RETURN NEW;
  END IF;

  -- Re-completar o deshacer la reapertura: completed y snapshot vacío, juntos.
  IF NEW.status = 'completed' AND NEW.completed_snapshot IS NULL THEN
    RETURN NEW;
  END IF;

  -- Cancelar (cancel_completed_order devuelve el stock).
  IF NEW.status = 'cancelled' THEN
    RETURN NEW;
  END IF;

  -- Vaciar el snapshot con la orden todavía abierta borraría la única marca
  -- de que ya descontó: el siguiente completado la descontaría entera.
  IF NEW.completed_snapshot IS NULL THEN
    RAISE EXCEPTION 'Order % is reopened: its completed_snapshot can only be cleared by completing or cancelling it', OLD.order_number
      USING ERRCODE = '22023';
  END IF;

  IF NEW.status IS DISTINCT FROM 'reopened' THEN
    RAISE WARNING 'protect_reopened_snapshot: order % stays reopened (a write asked for %)',
      OLD.order_number, NEW.status;
    NEW.status := 'reopened';
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.protect_reopened_snapshot() IS
  'bug-036: una orden en reopened con completed_snapshot sólo sale a completed (vaciando el '
  'snapshot) o a cancelled; cualquier otro estado se queda en reopened.';

DROP TRIGGER IF EXISTS trg_protect_reopened_snapshot ON public.picking_lists;
CREATE TRIGGER trg_protect_reopened_snapshot
  BEFORE UPDATE OF status, completed_snapshot ON public.picking_lists
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_reopened_snapshot();

-- ── El Resume de waiting conserva `reopened` ────────────────────────────────
CREATE OR REPLACE FUNCTION public.unmark_picking_list_waiting(p_list_id uuid, p_action text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_id uuid := public.current_user_id();
  v_message text;
  v_updated int;
BEGIN
  IF p_action NOT IN ('resume', 'cancel') THEN
    RAISE EXCEPTION 'p_action must be ''resume'' or ''cancel'', got: %', p_action
      USING ERRCODE = '22023';
  END IF;

  v_message := CASE WHEN p_action = 'resume' THEN '[Resumed from waiting]' ELSE '[Cancelled from waiting]' END;

  UPDATE public.picking_lists
     SET is_waiting_inventory = FALSE,
         waiting_since        = NULL,
         waiting_reason       = NULL,
         -- Una reabierta vuelve a reopened (bug-036): mark_picking_list_waiting
         -- ya la conserva al entrar, y salir hacia ready_to_double_check le
         -- quitaba la marca de que ya descontó.
         status               = CASE
                                  WHEN p_action = 'cancel' THEN 'cancelled'
                                  WHEN status = 'reopened' THEN 'reopened'
                                  ELSE 'ready_to_double_check'
                                END,
         updated_at           = NOW()
   WHERE id = p_list_id
     AND is_waiting_inventory = TRUE;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RAISE EXCEPTION 'picking_list not found or not in waiting state: %', p_list_id
      USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.picking_list_notes (list_id, user_id, message)
  VALUES (p_list_id, v_caller_id, v_message);
END;
$function$;
