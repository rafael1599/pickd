-- ============================================================================
-- Dos preguntas distintas, dos columnas: cuándo paso por un sitio, y de dónde
-- sale la unidad.
--
-- Cambio de negocio (Rafael, 17 sep 2026): las unidades de una orden cancelada
-- dejan de esperar en `RETURN TO STOCK` y pasan a un sitio propio del área de
-- envío, **`CANCELLED PALLET`**. Y los dos sitios pasan a significar lo
-- contrario el uno del otro:
--
--   · `CANCELLED PALLET` — el pallet junto a la puerta. Lo que cae ahí se coge
--     **antes que de cualquier otro sitio** que tenga el SKU: esas bicis ya
--     salieron del estante y le deben un viaje a alguien.
--   · `RETURN TO STOCK` — pasa a ser donde **descansan** bicis que nadie va a
--     recoger salvo que sean la única opción que queda.
--
-- Hasta hoy `picking_order` contestaba las dos preguntas a la vez: de 0 a 999
-- decía el recorrido, y de 9000 en adelante decía «no cojas de aquí salvo que no
-- haya otra». Mientras las dos respuestas coincidían —lo enterrado está al final
-- del paseo— un solo número bastaba y funcionaba. Deja de bastar ahora, porque
-- `CANCELLED PALLET` se recorre **antes de ROW 10** (294; ROW 10 es 295) y a la
-- vez es **la primera fuente**. Un número no puede decir las dos cosas.
--
-- Así que la fuente sale a su propia columna, `pick_priority`, y `picking_order`
-- se queda sólo con el recorrido. No se toca ningún `picking_order` existente:
-- la ruta que camina el picker hoy sigue siendo exactamente la misma.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. La columna nueva: de dónde sale la unidad cuando el SKU está en varios
--    sitios. Tres valores, tres precedencias duras — no es un puntaje que se
--    mezcle con la cantidad, es un orden de grupos.
-- ---------------------------------------------------------------------------
ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS pick_priority text NOT NULL DEFAULT 'normal';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'locations_pick_priority_check'
  ) THEN
    ALTER TABLE public.locations
      ADD CONSTRAINT locations_pick_priority_check
      CHECK (pick_priority IN ('first', 'normal', 'last'));
  END IF;
END $$;

COMMENT ON COLUMN public.locations.pick_priority IS
  'De dónde sale la unidad cuando el SKU está en varios sitios: first (se vacía antes que cualquier otro), normal, last (sólo si no queda otra). Es una pregunta distinta de picking_order, que dice cuándo se pasa por ahí en el recorrido.';

-- ---------------------------------------------------------------------------
-- 2. El sitio nuevo. 294 lo pone justo antes de ROW 10 (295) en el recorrido,
--    que es donde Rafael quiere que el picker pase por él. No es almacenamiento:
--    su capacidad no es espacio del edificio, igual que MAS o INCOMING.
-- ---------------------------------------------------------------------------
INSERT INTO public.locations (
  warehouse, location, zone, picking_order, max_capacity,
  counts_as_storage, is_shipping_area, is_active, pick_priority, notes
)
VALUES (
  'LUDLOW', 'CANCELLED PALLET', 'UNASSIGNED', 294, NULL,
  false, true, true, 'first',
  'El pallet del área de envío donde esperan las unidades de una orden cancelada. Se recorre antes de ROW 10 y se coge ANTES que cualquier otro sitio que tenga el SKU: esas bicis ya salieron del estante (Rafael, 17 sep 2026).'
)
ON CONFLICT (warehouse, location) DO UPDATE SET
  picking_order     = EXCLUDED.picking_order,
  counts_as_storage = EXCLUDED.counts_as_storage,
  is_shipping_area  = EXCLUDED.is_shipping_area,
  pick_priority     = EXCLUDED.pick_priority,
  is_active         = true;

-- ---------------------------------------------------------------------------
-- 3. Lo que ya significaba «de aquí lo último» pasa a decirlo en la columna que
--    le corresponde. Su `picking_order` no se toca: ahí sigue diciendo dónde
--    está en el paseo, que es lo único que debía decir.
--
--    Son las 22 de la banda ≥9000 (pallets enterrados, containers, UNKNOWN,
--    ROW X EP) más RETURN TO STOCK, que estrena significado.
-- ---------------------------------------------------------------------------
UPDATE public.locations SET pick_priority = 'last'
WHERE picking_order >= 9000;

UPDATE public.locations SET pick_priority = 'last'
WHERE location = 'RETURN TO STOCK';

COMMENT ON COLUMN public.locations.picking_order IS
  'Cuándo se pasa por esta ubicación en el recorrido del picker. No dice de dónde sale la unidad: eso es pick_priority.';

-- ---------------------------------------------------------------------------
-- 4. Lo que hay hoy en RETURN TO STOCK llegó por el significado viejo — son
--    unidades de cancelaciones, físicamente en el pallet de la puerta. Se mudan
--    al sitio nuevo; si se quedaran, pasarían de «cógelas primero» a «no las
--    cojas» sin que nadie moviera una bici.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_row RECORD;
BEGIN
  FOR v_row IN
    SELECT sku, warehouse, quantity FROM inventory
    WHERE location = 'RETURN TO STOCK' AND quantity > 0
  LOOP
    PERFORM public.adjust_inventory_quantity(
      p_sku          := v_row.sku,
      p_warehouse    := v_row.warehouse,
      p_location     := 'RETURN TO STOCK',
      p_delta        := -v_row.quantity,
      p_performed_by := 'system: cancelled-pallet-move',
      p_user_id      := NULL,
      p_merge_note   := NULL
    );
    PERFORM public.adjust_inventory_quantity(
      p_sku          := v_row.sku,
      p_warehouse    := v_row.warehouse,
      p_location     := 'CANCELLED PALLET',
      p_delta        := v_row.quantity,
      p_performed_by := 'system: cancelled-pallet-move',
      p_user_id      := NULL,
      p_merge_note   := NULL
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Cancelar deja las unidades en el sitio nuevo.
--
--    Mismo parche por anclas que el resto: se parte de la definición viva para
--    no perder por el camino ninguna de sus cabeceras.
-- ---------------------------------------------------------------------------
DO $migration$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def
  FROM pg_proc WHERE proname = 'cancel_completed_order';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'cancel_completed_order no existe';
  END IF;

  IF position('''RETURN TO STOCK''' IN v_def) = 0 THEN
    RAISE NOTICE 'cancel_completed_order ya no nombra RETURN TO STOCK; no se toca';
    RETURN;
  END IF;

  -- Todas las apariciones, no sólo la entrecomillada: en esta función el nombre
  -- aparece como destino (`p_location`, el payload de vuelta) y en dos
  -- comentarios que explican ese destino. Si los comentarios se quedan con el
  -- nombre viejo, el próximo que la lea creerá que las unidades siguen yendo
  -- allí — y este archivo existe precisamente porque ya no.
  v_def := replace(v_def, 'RETURN TO STOCK', 'CANCELLED PALLET');
  EXECUTE v_def;
END
$migration$;
