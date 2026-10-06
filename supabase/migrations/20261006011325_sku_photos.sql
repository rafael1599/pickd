-- Varias fotos por SKU, vistas sólo en la ficha (Rafael, 5 oct 2026: «poder
-- tomar multiples fotos a un sku y verlas todas… solo en la ficha»).
--
-- La portada sigue siendo `sku_metadata.image_url` (photos/{sku}.webp): la
-- leen la tarjeta de Stock, Double Check, las etiquetas y el export de FedEx, y
-- ninguno cambia. Las demás viven aquí; los archivos van a R2 por el modo
-- gallery de `upload-photo` (photos/gallery/{id}.webp + thumbs/), el mismo de
-- las fotos de pallet, que no toca la base.
--
-- `sku` sin FK, como las demás tablas laterales que nombran un SKU en texto:
-- una FK con ON DELETE CASCADE borraría las filas cuando `rename_sku_everywhere`
-- quita la ficha vieja. Renombrar todavía no las lleva (ver docs/photo-bikes.md).
-- Una PH tiene su propio SKU (`-PH1`), así que sus fotos ya están aparte.

CREATE TABLE IF NOT EXISTS public.sku_photos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku           text NOT NULL,
  url           text NOT NULL,
  thumbnail_url text NOT NULL,
  created_by    uuid REFERENCES public.profiles(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sku_photos_sku ON public.sku_photos (sku, created_at);

ALTER TABLE public.sku_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read sku_photos" ON public.sku_photos
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert sku_photos" ON public.sku_photos
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated delete sku_photos" ON public.sku_photos
  FOR DELETE TO authenticated USING (true);

GRANT SELECT, INSERT, DELETE ON public.sku_photos TO authenticated;
GRANT ALL ON public.sku_photos TO service_role;
