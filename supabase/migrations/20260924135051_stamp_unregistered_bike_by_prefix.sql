-- ============================================================================
-- El sello de la orden no llama parte a una bici que el catálogo no conoce
--
-- Problema (orden 881701, 24 sep 2026):
--   stamp_item_sku_metadata sellaba is_bike = COALESCE(sm.is_bike, false). Un
--   SKU sin fila en sku_metadata —el scratch-and-dent 01-0531, S/D HARLDINE C4 17
--   GREY— quedaba sellado como parte, y Ship lo sacaba del pallet: 8 cajas
--   calculadas contra las 9 que la cinta midió (55×42×76).
--
-- Regla: sin fila, la misma que la base aplica al crearla y que ya usa
-- classify_fedex: LEFT(sku, 2) IN ('01','02','03','06','07'). En TS vive en
-- isBikeSku (src/utils/bikeDetection.ts); si cambia una, cambiar la otra.
--
-- Las órdenes abiertas se vuelven a sellar al final (re-escribir items dispara
-- el trigger; el orden de los items no cambia).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.stamp_item_sku_metadata()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- jsonb_typeof before jsonb_array_length: the column is plain jsonb with no
  -- CHECK forcing an array, and jsonb_array_length() raises on a scalar. A
  -- trigger whose only job is to enrich must never be the thing that rejects a
  -- write, so anything that isn't a populated array passes through untouched.
  IF NEW.items IS NULL
     OR jsonb_typeof(NEW.items) <> 'array'
     OR jsonb_array_length(NEW.items) = 0 THEN
    RETURN NEW;
  END IF;

  -- WITH ORDINALITY + ORDER BY: item order is load-bearing. compensate_picking_list_changes
  -- diffs OLD.items vs NEW.items positionally to decide inventory restores, so a reordered
  -- array would read as "every item was replaced" and fire spurious adjustments.
  --
  -- sku_not_found is a top-level item field (the client and the watchdog have
  -- always written it there); is_bike / weight_lbs stay under sku_metadata.
  SELECT COALESCE(jsonb_agg(
           item || jsonb_build_object(
             'sku_not_found', (sm.sku IS NULL),
             'sku_metadata',
             COALESCE(item->'sku_metadata', '{}'::jsonb)
               || jsonb_build_object(
                    'is_bike',    COALESCE(sm.is_bike,
                                           LEFT(item->>'sku', 2) IN ('01','02','03','06','07')),
                    'weight_lbs', sm.weight_lbs
                  )
           )
           ORDER BY ord
         ), '[]'::jsonb)
    INTO NEW.items
    FROM jsonb_array_elements(NEW.items) WITH ORDINALITY AS t(item, ord)
    LEFT JOIN sku_metadata sm ON sm.sku = item->>'sku';

  RETURN NEW;
END;
$function$;

-- Re-sellar sólo las órdenes no despachadas que llevan una bici sin ficha
-- sellada como parte. Las despachadas y las canceladas son historia: no se tocan.
UPDATE public.picking_lists pl
   SET items = pl.items
 WHERE COALESCE(pl.is_shipped, false) = false
   AND pl.status IS DISTINCT FROM 'cancelled'
   AND jsonb_typeof(pl.items) = 'array'
   AND EXISTS (
     SELECT 1
       FROM jsonb_array_elements(pl.items) AS t(item)
      WHERE (item->>'sku_not_found')::boolean IS TRUE
        AND LEFT(item->>'sku', 2) IN ('01','02','03','06','07')
        AND (item->'sku_metadata'->>'is_bike')::boolean IS NOT TRUE
   );
