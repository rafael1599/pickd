-- Ready to DC deja huella: quién recogió la orden y cuándo la mandó a verificar.
--
-- Rafael, 29 sep 2026: «cada vez que alguien haga uso del botón send to dc, se
-- muestre esa orden en una sección separada del live board con el nombre de quien
-- la recogió; nadie puede completar si primero no se ha enviado a ready to dc».
--
-- El estado no sirve para eso: las órdenes del AS400 NACEN en
-- ready_to_double_check sin que nadie las haya recogido. Así que el envío es un
-- hecho aparte, con dos columnas. El board las lee para la sección «Ready to DC»
-- y Double Check para enseñar el deslizable de completar.
--
-- Volver al picker (needs_correction / active) borra la huella: lo que se
-- verifica tiene que ser lo que el picker volvió a mandar.

ALTER TABLE public.picking_lists
  ADD COLUMN IF NOT EXISTS sent_to_dc_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sent_to_dc_at timestamptz;

COMMENT ON COLUMN public.picking_lists.sent_to_dc_by IS
  'Quien pulsó Ready to DC (el picker). NULL = nadie la ha mandado a verificar; sin eso no se puede completar.';
COMMENT ON COLUMN public.picking_lists.sent_to_dc_at IS
  'Cuándo se pulsó Ready to DC. Se borra al volver a active / needs_correction.';

CREATE OR REPLACE FUNCTION public.clear_sent_to_dc_on_return()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status IN ('active', 'needs_correction')
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    NEW.sent_to_dc_by := NULL;
    NEW.sent_to_dc_at := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS tr_picking_lists_clear_sent_to_dc ON public.picking_lists;
CREATE TRIGGER tr_picking_lists_clear_sent_to_dc
  BEFORE UPDATE OF status ON public.picking_lists
  FOR EACH ROW EXECUTE FUNCTION public.clear_sent_to_dc_on_return();
