-- Girar una foto a mano desde el visor (Rafael, 6 oct 2026: «quiero poder
-- girar la imagen manualmente con un botón en todos los lados donde se usa el
-- visor de imagen»; y «¿por qué no se puede guardar así en el R2 sin tabla?»).
--
-- El cliente gira la foto y la vuelve a subir a **la misma llave** de R2
-- (`upload-photo`), así que queda derecha en todas partes a la vez: visor,
-- miniaturas, Ship, PDF. Pero R2 no manda Cache-Control y PickD guarda la caché
-- 7 días: con la misma URL, quien ya la vio seguiría viéndola torcida (01-0357,
-- 1 oct 2026). La URL lleva entonces una versión nueva (`?v=`), y esta función
-- la pone en cada sitio donde se guardó la anterior.
--
-- Sólo cambia la versión: la URL nueva tiene que ser la misma foto (mismo
-- dominio y misma llave) que la vieja, o no hace nada. Así nadie la usa para
-- cambiar una foto por otra.

CREATE OR REPLACE FUNCTION public.replace_photo_url(p_old text, p_new text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base text := split_part(p_old, '?', 1);
  v_thumb_base text;
  v_version text := substring(p_new from '\?(.*)$');
  v_n integer := 0;
  v_rows integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN 0;
  END IF;
  IF split_part(p_new, '?', 1) <> v_base
     OR v_base !~ '^https://[^/]+/photos/(gallery/[0-9a-f-]{36}|[^/]+)\.webp$' THEN
    RAISE EXCEPTION 'not the same photo';
  END IF;
  v_thumb_base := regexp_replace(v_base, '/photos/(gallery/)?([^/]+\.webp)$', '/photos/\1thumbs/\2');

  -- Fotos de pallet: un arreglo jsonb de URLs, en la orden y en el envío.
  UPDATE public.picking_lists
     SET pallet_photos = (
       SELECT jsonb_agg(CASE WHEN split_part(e #>> '{}', '?', 1) = v_base THEN to_jsonb(p_new) ELSE e END ORDER BY o)
         FROM jsonb_array_elements(pallet_photos) WITH ORDINALITY AS t(e, o))
   WHERE jsonb_typeof(pallet_photos) = 'array'
     AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(pallet_photos) u WHERE split_part(u, '?', 1) = v_base);
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_n := v_n + v_rows;

  UPDATE public.shipments
     SET pallet_photos = (
       SELECT jsonb_agg(CASE WHEN split_part(e #>> '{}', '?', 1) = v_base THEN to_jsonb(p_new) ELSE e END ORDER BY o)
         FROM jsonb_array_elements(pallet_photos) WITH ORDINALITY AS t(e, o))
   WHERE jsonb_typeof(pallet_photos) = 'array'
     AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(pallet_photos) u WHERE split_part(u, '?', 1) = v_base);
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_n := v_n + v_rows;

  UPDATE public.sku_metadata SET image_url = p_new
   WHERE split_part(image_url, '?', 1) = v_base;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_n := v_n + v_rows;

  UPDATE public.sku_photos
     SET url = p_new,
         thumbnail_url = CASE WHEN thumbnail_url IS NULL THEN NULL
                              ELSE v_thumb_base || COALESCE('?' || v_version, '') END
   WHERE split_part(url, '?', 1) = v_base;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_n := v_n + v_rows;

  UPDATE public.gallery_photos
     SET url = p_new,
         thumbnail_url = CASE WHEN thumbnail_url IS NULL THEN NULL
                              ELSE v_thumb_base || COALESCE('?' || v_version, '') END
   WHERE split_part(url, '?', 1) = v_base;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_n := v_n + v_rows;

  UPDATE public.asset_tags SET label_photo_url = p_new
   WHERE split_part(label_photo_url, '?', 1) = v_base;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_n := v_n + v_rows;

  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_photo_url(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.replace_photo_url(text, text) TO authenticated;
