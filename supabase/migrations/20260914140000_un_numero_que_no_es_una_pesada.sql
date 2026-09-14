-- Un peso que no sale de la báscula no es una pesada, venga de donde venga.
--
-- El escape que abrió `apply_as400_weight` estaba escrito con el nombre de su
-- único usuario: «sella `weight_verified` salvo que la fuente sea 'as400'». Hoy
-- hizo falta un segundo caso —el peso de una bici devuelta estimado a partir de
-- sus dos parientes más cercanos con pesada real (Rafael, 14 sep 2026)— y la
-- única forma de escribirlo sin mentir era declararse 'as400', que es otra
-- mentira.
--
-- La pregunta que el trigger quiere hacer no es «¿vienes del AS400?» sino
-- «¿alguien puso esto en una báscula?». Se sella cuando NADIE declara una
-- fuente; cualquier fuente declarada significa «este número es una estimación».
-- `apply_as400_weight` sigue funcionando sin tocarla.
CREATE OR REPLACE FUNCTION public.set_dimensions_verified()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.length_in IS DISTINCT FROM OLD.length_in
     OR NEW.width_in  IS DISTINCT FROM OLD.width_in
     OR NEW.height_in IS DISTINCT FROM OLD.height_in
     OR (COALESCE(NEW.dimensions_verified, false) AND NOT COALESCE(OLD.dimensions_verified, false))
  THEN
    NEW.dimensions_verified := true;
    NEW.dimensions_measured_at := now();
  ELSE
    NEW.dimensions_verified := COALESCE(OLD.dimensions_verified, false);
    NEW.dimensions_measured_at := OLD.dimensions_measured_at;
  END IF;

  IF (
       (NEW.weight_lbs IS DISTINCT FROM OLD.weight_lbs
        -- Cualquier fuente declarada = «no es una pesada». Antes decía
        -- `<> 'as400'`, que obligaba a mentir sobre el origen para no sellar.
        AND COALESCE(current_setting('pickd.weight_source', true), '') = '')
       OR (COALESCE(NEW.weight_verified, false) AND NOT COALESCE(OLD.weight_verified, false))
     )
  THEN
    NEW.weight_verified := true;
  ELSE
    NEW.weight_verified := COALESCE(OLD.weight_verified, false);
  END IF;

  RETURN NEW;
END;
$function$;
