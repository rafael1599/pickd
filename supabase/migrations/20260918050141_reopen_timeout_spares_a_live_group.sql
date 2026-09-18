-- ============================================================================
-- El reloj de las reabiertas no cierra una que está esperando a su hermana.
--
-- `auto_cancel_stale_orders` corre cada minuto y devuelve a `completed` toda
-- orden que lleve más de 2 horas en `reopened`. Ese reloj existe para la
-- reabierta **abandonada** — el navegador que se cerró, la sesión que se
-- perdió — y hace bien en existir.
--
-- Pero el flujo Add-On **obliga** a que la orden fuente esté `reopened` mientras
-- se verifica la otra mitad: `complete_addon_group` rechaza cualquier fuente que
-- no lo esté. Así que una combinación cuya verificación pase de dos horas —una
-- orden grande, un turno partido, un almuerzo— se deshace sola, sin que nadie se
-- entere hasta que falta una orden en el pallet. El 17 sep #881373 estuvo a
-- media hora de que le pasara: se reabrió a las 16:00 y el grupo se completó a
-- las 16:31.
--
-- La condición que se añade es la que describe el caso: **el grupo todavía tiene
-- un miembro vivo**. No es "alguien lo tiene en las manos" (`group_is_held`),
-- que es más estrecho y dejaría morir la combinación en cuanto el verificador
-- soltara la tarjeta un rato; es "esta reapertura todavía tiene para quién
-- esperar".
--
-- Y no se queda colgada para siempre si de verdad la abandonan: la hermana
-- abierta la caza la rama de las 24 h (`ready_to_double_check` /
-- `double_checking` sin tocar), y en cuanto esa se cancela el grupo deja de
-- tener miembro vivo y la siguiente pasada del reloj cierra la reapertura. Se
-- cura sola, sólo que por el otro extremo.
--
-- Se parchea la definición viva por anclas exactas: la función es larga, tiene
-- tres ramas que no se tocan y una cabecera con tipo de retorno compuesto.
-- ============================================================================

DO $migration$
DECLARE
  v_def text;
  v_anchor text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def
  FROM pg_proc WHERE proname = 'auto_cancel_stale_orders';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'auto_cancel_stale_orders no existe';
  END IF;

  IF position('todavía tiene un miembro vivo' IN v_def) > 0 THEN
    RAISE NOTICE 'auto_cancel_stale_orders ya perdona los grupos vivos; no se toca';
    RETURN;
  END IF;

  v_anchor := E'    AND reopened_at < NOW() - INTERVAL \'2 hours\'';

  IF position(v_anchor IN v_def) = 0 THEN
    RAISE EXCEPTION 'No se encontró el reloj de las 2 h en auto_cancel_stale_orders — revisar a mano';
  END IF;

  v_def := replace(
    v_def,
    v_anchor,
    v_anchor || E'\n'
'    -- …salvo que su grupo todavía tiene un miembro vivo: entonces esta\n'
'    -- reapertura no está abandonada, está esperando a que terminen de\n'
'    -- verificar la otra mitad, que es lo que el flujo Add-On exige.\n'
'    AND NOT EXISTS (\n'
'      SELECT 1 FROM picking_lists sibling\n'
'      WHERE sibling.group_id = picking_lists.group_id\n'
'        AND picking_lists.group_id IS NOT NULL\n'
'        AND sibling.id <> picking_lists.id\n'
'        AND sibling.status NOT IN (''completed'', ''cancelled'')\n'
'    )'
  );

  EXECUTE v_def;
END
$migration$;
