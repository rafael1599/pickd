-- La etiqueta de cada caja, sacada de las fotos de Double Check, para el 3D de Ship.
--
-- Rafael, 29 sep 2026: «la misma etiqueta que se extrae de las fotos se le puede
-- poner en su lugar a cada bicicleta». La sombra del lector (`dcv_shadow_runs`)
-- guarda, por foto de pallet, cada etiqueta leída con su recuadro en la foto y el
-- SKU resuelto contra la orden. La foto misma ya es pública (la versión de
-- 1200 px en R2, `photos/gallery/<photo_id>.webp`, que enseña la tarjeta de
-- Ship), así que con el recuadro basta para recortarla en el teléfono.
--
-- La tabla sólo la lee un admin (trae el motor, el dispositivo, los tiempos); la
-- estación de Ship no lo es. Esta función devuelve lo justo —SKU, foto,
-- recuadro, tamaño de la foto— y **una fila por SKU**: la lectura de más
-- confianza. Nada del texto leído: ése puede traer guías de FedEx.

CREATE OR REPLACE FUNCTION public.order_label_reads(p_list_ids uuid[])
 RETURNS TABLE (
   sku text,
   photo_id uuid,
   bbox jsonb,
   photo_width integer,
   photo_height integer,
   confidence numeric
 )
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT DISTINCT ON (b->>'resolved_sku')
    b->>'resolved_sku' AS sku,
    r.photo_id,
    b->'bbox' AS bbox,
    r.photo_width,
    r.photo_height,
    (b->>'confidence')::numeric AS confidence
  FROM dcv_shadow_runs r
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(r.boxes, '[]'::jsonb)) b
  WHERE (r.list_id = ANY (p_list_ids) OR r.group_members && p_list_ids)
    AND r.status = 'ok'
    AND r.photo_id IS NOT NULL
    AND b->>'resolved_sku' IS NOT NULL
    AND jsonb_typeof(b->'bbox') = 'object'
    AND auth.uid() IS NOT NULL
  ORDER BY b->>'resolved_sku', (b->>'confidence')::numeric DESC NULLS LAST, r.created_at DESC;
$function$;

REVOKE ALL ON FUNCTION public.order_label_reads(uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.order_label_reads(uuid[]) TO authenticated;
