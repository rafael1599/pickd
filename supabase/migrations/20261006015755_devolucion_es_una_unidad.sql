-- ============================================================================
-- Una devolución de FedEx es una unidad especial, como una S/D o una PH
-- (idea-250, fase 1). Rafael, 5 oct 2026: «no creo que sea necesario dejar las
-- tablas como historial, solo pasar la data a las tablas de item».
--
-- Cada devolución ya era un ítem: una ficha con el tracking como SKU y su fila
-- en FDX / FDX 1 / FDX RETURNS (62 de 62). Lo que sólo vivía en
-- fedex_returns / fedex_return_items pasa a la ficha:
--
--   1. `unit_kind = 'return'`. El SKU sigue siendo el tracking: se encuentra al
--      buscar sin columna nueva y nunca se renombra (renombrar no lleva
--      sku_photos).
--   2. `base_sku` = el modelo cuando alguien lo identificó (06-4438BK ×3,
--      12-8352KW). Rafael: siguen como devolución enlazada, no pasan a stock.
--   3. `rma` (el «WC#: 8221») e `is_misship`, columnas nuevas.
--   4. La foto de la etiqueta pasa a sku_photos (photos/returns/{tracking}).
--   5. Las notas pasan a internal_note de su fila.
--   6. 792269901320 y 792259770172: devoluciones de abril, anteriores al
--      módulo, sin fila en fedex_returns (Rafael: «son fdx returns»).
--
-- Puente: la pantalla FedEx Returns sigue dando de alta en sus tablas hasta que
-- el alta pase a la ficha (fase 2, que borra las tablas). Un trigger copia cada
-- devolución nueva o editada a la ficha, así que desde hoy la ficha manda para
-- leer. Una unidad que alguien pasó a S/D o PH no vuelve a 'return'.
--
-- Aditiva: un valor más en el CHECK, dos columnas, una función y dos triggers.
-- ============================================================================

BEGIN;

ALTER TABLE public.sku_metadata
  DROP CONSTRAINT IF EXISTS sku_metadata_unit_kind_check;
ALTER TABLE public.sku_metadata
  ADD CONSTRAINT sku_metadata_unit_kind_check
  CHECK (unit_kind IN ('new', 'sd', 'photo', 'return'));

COMMENT ON COLUMN public.sku_metadata.unit_kind IS
  'Qué es la unidad: new (de catálogo), sd (scratch & dent), photo (photo/demo/prototipo) o return (devolución de FedEx; su SKU es el tracking). is_scratch_dent es espejo de sd (a_unit_kind_sync). idea-248, idea-250.';

ALTER TABLE public.sku_metadata
  ADD COLUMN IF NOT EXISTS rma text,
  ADD COLUMN IF NOT EXISTS is_misship boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.sku_metadata.rma IS
  'RMA de una devolución (unit_kind = return), tal cual la escribe el cliente: «WC#: 8221». idea-250.';
COMMENT ON COLUMN public.sku_metadata.is_misship IS
  'Devolución por envío equivocado (unit_kind = return). idea-250.';

-- ─── Copia una devolución a su ficha ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_return_unit(p_return_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  r public.fedex_returns%ROWTYPE;
  v_base text;
BEGIN
  SELECT * INTO r FROM public.fedex_returns WHERE id = p_return_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT i.sku INTO v_base
    FROM public.fedex_return_items i
   WHERE i.return_id = r.id AND i.sku <> r.tracking_number
   ORDER BY i.created_at DESC
   LIMIT 1;

  UPDATE public.sku_metadata m
     SET unit_kind  = CASE WHEN m.unit_kind = 'new' THEN 'return' ELSE m.unit_kind END,
         base_sku   = COALESCE(v_base, m.base_sku),
         rma        = r.rma,
         is_misship = r.is_misship
   WHERE m.sku = r.tracking_number;

  IF r.label_photo_url IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.sku_metadata WHERE sku = r.tracking_number)
     AND NOT EXISTS (SELECT 1 FROM public.sku_photos
                      WHERE sku = r.tracking_number AND url = r.label_photo_url) THEN
    INSERT INTO public.sku_photos (sku, url, thumbnail_url, created_by, created_at)
    VALUES (
      r.tracking_number,
      r.label_photo_url,
      replace(r.label_photo_url, '/photos/returns/', '/photos/returns/thumbs/'),
      r.received_by,
      COALESCE(r.received_at, r.created_at, now())
    );
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_return_unit(uuid) FROM PUBLIC, anon, authenticated;

-- La ficha del placeholder nace después del sobre (useAddFedExReturn: sobre →
-- register_new_sku → ítem), así que el alta se copia al llegar el ítem.
CREATE OR REPLACE FUNCTION public.tr_sync_return_unit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  -- Dos ramas: plpgsql resuelve new.return_id aunque el CASE no lo elija.
  IF tg_table_name = 'fedex_returns' THEN
    PERFORM public.sync_return_unit(new.id);
  ELSE
    PERFORM public.sync_return_unit(new.return_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tr_fedex_returns_sync_unit ON public.fedex_returns;
CREATE TRIGGER tr_fedex_returns_sync_unit
  AFTER UPDATE OF rma, is_misship, label_photo_url ON public.fedex_returns
  FOR EACH ROW EXECUTE FUNCTION public.tr_sync_return_unit();

DROP TRIGGER IF EXISTS tr_fedex_return_items_sync_unit ON public.fedex_return_items;
CREATE TRIGGER tr_fedex_return_items_sync_unit
  AFTER INSERT OR UPDATE OF sku ON public.fedex_return_items
  FOR EACH ROW EXECUTE FUNCTION public.tr_sync_return_unit();

-- ─── Traspaso ────────────────────────────────────────────────────────────────
SELECT public.sync_return_unit(id) FROM public.fedex_returns;

UPDATE public.sku_metadata
   SET unit_kind = 'return'
 WHERE sku IN ('792269901320', '792259770172') AND unit_kind = 'new';

UPDATE public.inventory i
   SET internal_note = r.notes
  FROM public.fedex_returns r
 WHERE i.sku = r.tracking_number
   AND i.is_active
   AND r.notes IS NOT NULL
   AND nullif(btrim(i.internal_note), '') IS NULL;

COMMIT;
