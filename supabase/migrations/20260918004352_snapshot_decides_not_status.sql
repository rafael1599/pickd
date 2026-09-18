-- ============================================================================
-- Lo que dice «esta orden ya salió del estante» es el snapshot, no el estado.
--
-- `process_picking_list` se negaba a procesar una orden **`reopened`** y ahí
-- acababa su defensa. Pero el estado lo cambia cualquiera: hasta hoy,
-- `markAsReady` arrastraba a las hermanas del grupo a `double_checking` sin
-- excluir `reopened` (arreglado en `768a018`), y con eso la orden llegaba a
-- completarse sin la marca — su `completed_snapshot` seguía ahí, intacto, y
-- nadie lo miraba. Resultado: **se descontaba todo por segunda vez**. Medido en
-- producción el 17 sep 2026: 7 órdenes, **35 unidades**, tres de ellas ese mismo
-- día (#881373 +1, #881488 +3, #881612 +1).
--
-- El arreglo del cliente cierra el camino conocido. Esta migración cierra la
-- clase entera: **el snapshot manda**. Una orden que lo conserva ya descontó lo
-- suyo, sea cual sea su estado, así que `process_picking_list` deja de descontar
-- a ciegas y delega en el camino de delta, que es el correcto por definición:
-- compara contra la foto de cuando se completó y aplica solo la diferencia.
--
-- **Por qué delegar y no reventar:** un `RAISE` protege el stock pero deja a
-- alguien en la estación de verificación con un error que no puede arreglar, y
-- media combinada sin completar. Delegar hace lo correcto y deja rastro (la nota
-- «Order re-completed after reopen #N»). Si el delta no puede correr, su propia
-- excepción sube igual.
--
-- **Por qué se parchea la definición viva en vez de reescribirla:** las dos
-- funciones son largas y sus cabeceras tienen detalles que no se ven al leerlas
-- (`p_user_role text DEFAULT 'staff'`, `p_user_id uuid DEFAULT NULL`,
-- `SET search_path TO 'public'` en una y ninguno en la otra). Retipearlas es
-- invitar a perder uno. Se parte de `pg_get_functiondef` y se sustituyen anclas
-- exactas; si un ancla no aparece, la migración **falla en vez de adivinar**.
--
-- La huella sigue siendo la prueba: `status='completed' and completed_snapshot
-- is not null` no debe crecer. Ver `docs/inventory-ledger-traps.md`.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. `recomplete_picking_list`: el snapshot es la condición, no `reopened`.
--
--    Una orden que perdió ese estado por el camino (un barrido de grupo, un
--    take-over) sigue necesitando el delta. Lo terminal sí se rechaza: una
--    completada o cancelada no se re-completa.
-- ---------------------------------------------------------------------------
DO $migration$
DECLARE
  v_def text;
  v_anchor text;
  v_replacement text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def
  FROM pg_proc WHERE proname = 'recomplete_picking_list';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'recomplete_picking_list no existe';
  END IF;

  v_anchor :=
E'  IF v_list.status != \'reopened\' THEN\n'
'    RAISE EXCEPTION \'Cannot recomplete: status is %, expected reopened\', v_list.status;\n'
'  END IF;';

  IF position(v_anchor IN v_def) = 0 THEN
    IF position('expected an open order with a snapshot' IN v_def) > 0 THEN
      RAISE NOTICE 'recomplete_picking_list ya estaba parcheada; no se toca';
      RETURN;
    END IF;
    RAISE EXCEPTION 'No se encontró la guarda de estado en recomplete_picking_list — revisar a mano';
  END IF;

  v_replacement :=
E'  -- Terminal: no hay nada que re-completar.\n'
'  IF v_list.status IN (\'completed\', \'cancelled\') THEN\n'
'    RAISE EXCEPTION \'Cannot recomplete: status is %, expected an open order with a snapshot\', v_list.status;\n'
'  END IF;';

  v_def := replace(v_def, v_anchor, v_replacement);

  -- El mensaje del snapshot ya no puede hablar de "reopened": se llega aquí
  -- desde cualquier estado abierto.
  v_def := replace(
    v_def,
    E'RAISE EXCEPTION \'No snapshot found for reopened order %\', p_list_id;',
    E'RAISE EXCEPTION \'No snapshot found for order % (status %)\', p_list_id, v_list.status;'
  );

  EXECUTE v_def;
END
$migration$;

-- ---------------------------------------------------------------------------
-- 2. `process_picking_list` mira el snapshot antes de descontar nada.
--
--    El bloque va ANTES de la negativa a `reopened`, que se conserva para el
--    caso imposible de una reabierta sin snapshot.
-- ---------------------------------------------------------------------------
DO $migration$
DECLARE
  v_def text;
  v_anchor text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def
  FROM pg_proc WHERE proname = 'process_picking_list';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'process_picking_list no existe';
  END IF;

  IF position('completed_snapshot' IN v_def) > 0 THEN
    RAISE NOTICE 'process_picking_list ya mira el snapshot; no se toca';
    RETURN;
  END IF;

  v_anchor := E'  IF v_list.status = \'reopened\' THEN';

  IF position(v_anchor IN v_def) = 0 THEN
    RAISE EXCEPTION 'No se encontró la guarda de reopened en process_picking_list — revisar a mano';
  END IF;

  v_def := replace(
    v_def,
    v_anchor,
E'  -- El snapshot manda, no el estado. Una orden que lo conserva ya descontó lo\n'
'  -- suyo una vez: aquí se aplica la DIFERENCIA contra esa foto, nunca un\n'
'  -- descuento nuevo. Sin esto, cualquier camino que le quite el estado\n'
'  -- \'\'reopened\'\' —un barrido de grupo, un take-over— la hacía descontar dos\n'
'  -- veces en silencio (7 órdenes, 35 unidades hasta el 17 sep 2026).\n'
'  IF v_list.completed_snapshot IS NOT NULL THEN\n'
'    PERFORM public.recomplete_picking_list(\n'
'      p_list_id, p_performed_by, p_user_id, p_pallets_qty, p_total_units, p_user_role\n'
'    );\n'
'    RETURN TRUE;\n'
'  END IF;\n'
'\n' || v_anchor
  );

  EXECUTE v_def;
END
$migration$;
