-- La etiqueta de cada caja para el 3D de Ship, ahora con sus 4 esquinas.
--
-- Rafael, 30 sep 2026: la etiqueta que el 3D recortaba del recuadro recto de la
-- foto salía inclinada, con esquinas de cartón y a veces de lado. El motor ya
-- localiza cada etiqueta como cuadrilátero y la endereza (pieza 1); la sombra
-- guarda desde hoy esas esquinas (`boxes[].corners`, en píxeles de la original,
-- en el orden en que se lee derecha). Con ellas el 3D endereza la etiqueta con
-- una homografía sobre la foto pública de 1200 px.
--
-- Mismo contrato que `20260930022628` más `corners` (NULL en las lecturas
-- anteriores, que siguen sirviendo con el recuadro). Cambiar el tipo de retorno
-- obliga a borrar y crear; un cliente viejo ignora la columna nueva.

DROP FUNCTION IF EXISTS public.order_label_reads(uuid[]);

CREATE FUNCTION public.order_label_reads(p_list_ids uuid[])
 RETURNS TABLE (
   sku text,
   photo_id uuid,
   bbox jsonb,
   corners jsonb,
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
    CASE WHEN jsonb_typeof(b->'corners') = 'array' THEN b->'corners' END AS corners,
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
  -- a igual SKU, primero la lectura con esquinas: es la que se endereza bien
  ORDER BY b->>'resolved_sku', (jsonb_typeof(b->'corners') = 'array') DESC,
           (b->>'confidence')::numeric DESC NULLS LAST, r.created_at DESC;
$function$;

REVOKE ALL ON FUNCTION public.order_label_reads(uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.order_label_reads(uuid[]) TO authenticated;
