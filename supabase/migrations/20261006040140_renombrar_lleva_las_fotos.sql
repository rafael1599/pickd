-- ============================================================================
-- Renombrar desde la ficha lleva las fotos (Rafael, 6 oct 2026: «el renombrado
-- desde la ficha debe hacerse ahora»).
--
-- La ficha renombra una FILA de inventario (`inventory.service.updateItem`,
-- CASE 3: UPDATE inventory SET sku = nuevo) y escribe la ficha nueva sin foto:
-- la portada (`sku_metadata.image_url`) y las demás (`sku_photos`) se quedaban
-- en el SKU viejo. `rename_sku_everywhere` ya las lleva (20261006035159), pero
-- la ficha no la usa.
--
-- Un trigger en `inventory` cubre cualquier camino que cambie el SKU de una
-- fila, con una regla:
--   - el SKU viejo se queda sin filas → sus `sku_photos` se MUDAN al nuevo;
--   - le quedan filas en otro sitio   → se COPIAN (las dos siguen con fotos);
--   - la portada pasa al nuevo sólo si el nuevo no tiene una (nunca pisa).
-- Un camino que cambia las filas una a una (`rename_sku_everywhere`) copia con
-- las primeras y muda con la última sin repetir ninguna foto.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.carry_photos_on_sku_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.inventory WHERE sku = old.sku) THEN
    INSERT INTO public.sku_photos (sku, url, thumbnail_url, created_by, created_at)
    SELECT new.sku, p.url, p.thumbnail_url, p.created_by, p.created_at
      FROM public.sku_photos p
     WHERE p.sku = old.sku
       AND NOT EXISTS (SELECT 1 FROM public.sku_photos q WHERE q.sku = new.sku AND q.url = p.url);
  ELSE
    -- A copy made when an earlier row of the same SKU moved is already there:
    -- the original goes instead of moving on top of it.
    DELETE FROM public.sku_photos p
     WHERE p.sku = old.sku
       AND EXISTS (SELECT 1 FROM public.sku_photos q WHERE q.sku = new.sku AND q.url = p.url);
    UPDATE public.sku_photos SET sku = new.sku WHERE sku = old.sku;
  END IF;

  UPDATE public.sku_metadata m
     SET image_url = o.image_url
    FROM public.sku_metadata o
   WHERE m.sku = new.sku
     AND o.sku = old.sku
     AND m.image_url IS NULL
     AND o.image_url IS NOT NULL;

  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.carry_photos_on_sku_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tr_inventory_carry_photos ON public.inventory;
CREATE TRIGGER tr_inventory_carry_photos
  AFTER UPDATE OF sku ON public.inventory
  FOR EACH ROW
  WHEN (old.sku IS DISTINCT FROM new.sku)
  EXECUTE FUNCTION public.carry_photos_on_sku_change();

COMMIT;
