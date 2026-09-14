-- Un contenedor nuevo también nace fuera de la ruta.
--
-- `20260914202651` sacó del recorrido los dieciocho contenedores que existían,
-- pero era un UPDATE de una vez. `resolve_location` crea la ubicación al vuelo
-- la primera vez que alguien registra una carga, y ya sabía que un contenedor
-- no es espacio de almacén (`counts_as_storage = false`) — lo que no ponía es
-- el `picking_order`, así que el siguiente nacía en NULL, que `pickingOrder.ts`
-- trata como «sin ranking, o sea normal».
--
-- Se vio en el acto: `6436N` se registró hoy con 32 líneas y 284 unidades, y su
-- ubicación apareció dentro de la ruta media hora después de haberla sacado
-- para todos los demás.
--
-- **Las jaulas no entran.** Comparten el `counts_as_storage = false` porque su
-- capacidad no es espacio de almacén, pero de una jaula SÍ se recoge: las S&D
-- viven ahí y salen de ahí (`01-0475` en CAGE 8). Sacarlas del recorrido
-- mandaría al picker al último lugar del almacén a por una bici que está donde
-- dice que está.
CREATE OR REPLACE FUNCTION public.resolve_location(p_warehouse text, p_location_name text, p_user_role text DEFAULT 'staff'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_location_id UUID;
  v_resolved_name TEXT;
BEGIN
  IF p_location_name IS NULL OR TRIM(p_location_name) = '' THEN RETURN NULL; END IF;

  -- UPPERCASE Normalization + TRIM
  v_resolved_name := UPPER(TRIM(p_location_name));

  -- A bare number is a row: '12' -> 'ROW 12'.
  IF v_resolved_name ~ '^[0-9]+$' THEN
    v_resolved_name := 'ROW ' || v_resolved_name;
  END IF;

  SELECT id INTO v_location_id FROM locations
  WHERE warehouse = p_warehouse AND UPPER(location) = v_resolved_name;

  IF v_location_id IS NOT NULL THEN RETURN v_location_id; END IF;

  -- Create on the fly (UPPERCASE). A container name ('7004N') is staging and a
  -- cage is locked-away stock, neither is floor space for bikes: same rules as
  -- 20260731160000, so their 550 never counts.
  --
  -- And a container is born out of the picking route (9997, the last-resort
  -- band): its stock exists and is counted, but it is a load nobody has
  -- unloaded yet. A cage keeps its NULL -- people do pick from cages.
  INSERT INTO locations (warehouse, location, zone, is_active, counts_as_storage, picking_order)
  VALUES (p_warehouse, v_resolved_name, 'UNASSIGNED', true,
          NOT (v_resolved_name ~ '^[0-9]{4}N$' OR v_resolved_name LIKE 'CAGE%'),
          CASE WHEN v_resolved_name ~ '^[0-9]{4}N$' THEN 9997 END)
  RETURNING id INTO v_location_id;

  RETURN v_location_id;
END;
$function$;

-- El que nació hoy, mientras la función aún no lo sabía.
UPDATE public.locations
   SET picking_order = 9997
 WHERE location ~ '^[0-9]{4}N$'
   AND (picking_order IS NULL OR picking_order < 9000);
