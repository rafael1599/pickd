-- ============================================================================
-- Los dos sitios estaban cambiados de sitio en el recorrido.
--
-- Rafael, 18 sep 2026: "cancelled pallet debe ir en shipping area, despues de
-- row 43. return to stock antes de row 10". La migración `20260918031208` los
-- puso al revés — leí su frase de la víspera ("el order picking debe ser el que
-- esta antes de row 10") como si hablara del sitio nuevo, y hablaba de RETURN
-- TO STOCK.
--
-- Sólo se mueve el **recorrido**. La fuente no cambia y sigue siendo lo que
-- decidió el cambio de negocio: `CANCELLED PALLET` se coge antes que cualquier
-- estante (`pick_priority = 'first'`) y `RETURN TO STOCK` sólo si no queda otra
-- (`'last'`). Es justo la separación que esta columna existe para permitir: un
-- sitio puede recorrerse pronto y ser el último del que coger, o al revés.
--
--   CANCELLED PALLET  294 → 420   (área de envío, tras ROW 43 y antes de ROW 44)
--   RETURN TO STOCK   420 → 294   (antes de ROW 10)
-- ============================================================================

-- El intercambio en dos pasos: 294 y 420 están ocupados el uno por el otro, y
-- aunque `picking_order` no es único, dejarlos a medias sería un momento en el
-- que dos sitios distintos dicen lo mismo.
UPDATE public.locations
SET picking_order = -1
WHERE warehouse = 'LUDLOW' AND location = 'CANCELLED PALLET';

UPDATE public.locations
SET picking_order = 294,
    notes = 'Donde descansan bicis que nadie va a recoger salvo que sean la única opción. Se recorre antes de ROW 10; de aquí se coge lo último (Rafael, 18 sep 2026).'
WHERE warehouse = 'LUDLOW' AND location = 'RETURN TO STOCK';

UPDATE public.locations
SET picking_order = 420,
    notes = 'El pallet del área de envío donde esperan las unidades de una orden cancelada. Se recorre después de ROW 43 y antes de ROW 44, y se coge ANTES que cualquier otro sitio que tenga el SKU: esas bicis ya salieron del estante (Rafael, 17-18 sep 2026).'
WHERE warehouse = 'LUDLOW' AND location = 'CANCELLED PALLET';

-- Comprobación: si el intercambio no quedó como se dice arriba, la migración
-- falla en vez de dejar el recorrido a medias.
DO $$
DECLARE
  v_pallet integer;
  v_return integer;
BEGIN
  SELECT picking_order INTO v_pallet FROM public.locations
   WHERE warehouse = 'LUDLOW' AND location = 'CANCELLED PALLET';
  SELECT picking_order INTO v_return FROM public.locations
   WHERE warehouse = 'LUDLOW' AND location = 'RETURN TO STOCK';

  IF v_pallet IS DISTINCT FROM 420 OR v_return IS DISTINCT FROM 294 THEN
    RAISE EXCEPTION 'El intercambio no cuadró: CANCELLED PALLET=%, RETURN TO STOCK=%',
      v_pallet, v_return;
  END IF;
END $$;
