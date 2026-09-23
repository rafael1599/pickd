-- ============================================================================
-- Una talla, una grafía: la pasada sobre lo ya guardado (idea-224)
--
-- 20260923182401 puso canonical_size() y el trigger que la aplica a todo write
-- nuevo. Esto reescribe las filas que ya estaban: 684 en prod al 23 sep 2026,
-- sólo bicis y cuadros (a una parte no se le toca la talla, salvo quitarle un
-- espacio sobrante: 'Adult ' -> 'Adult').
--
-- Revisado por grupos antes de aplicar (Gemini 3.1 Pro vía agy + comprobación
-- con cifras): 87 × 17 -> 17", 80 × 19 -> 19", 34 × 54 -> 54cm..., 9 ruedas
-- 700 -> 700×…; todo lo que pasa a cm es de ruta; ninguna clave del export de
-- FedEx cambia (renderSizeForExport ya leía igual las dos grafías). Sin
-- exclusiones.
--
-- Idempotente: canonical_size lo es, y el WHERE salta lo ya canónico.
-- ============================================================================

UPDATE public.sku_metadata
   SET size = public.canonical_size(size, is_bike, category)
 WHERE size IS NOT NULL
   AND size IS DISTINCT FROM public.canonical_size(size, is_bike, category);
