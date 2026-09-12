-- Un SKU que AS400 conoce y PickD no, se registra igual — en UNKNOWN.
--
-- Rafael, 11 sep 2026: «hay que preguntar incluso por sku que aun no existen en
-- pickd y registrarlos en pickd con ubicación unknown, para que el usuario
-- cuando lo encuentre solo mueva su ubicación a la real».
--
-- Hoy un SKU que el papel del AS400 nombra y el catálogo no tiene sale `UNREG`
-- en Double Check y **alguien lo registra a mano, a las 4 de la tarde, con la
-- orden abierta**: nombre, tipo, modelo, talla, color. Son 109 SKUs distintos
-- en los papeles de los últimos meses, y cada uno volverá a aparecer. Si la
-- fila ya existe con el nombre real del AS400, al operario le queda **un gesto
-- en el piso**: mover la ubicación y contar.
--
-- Tres decisiones, y las tres son sobre qué NO se escribe:
--
-- 1. **Cantidad 0, siempre.** Ni la del AS400 ni la de ninguna hoja. Es la
--    forma de placeholder que `register_new_sku` ya usa para dar de alta una
--    bici que todavía no llegó (qty 0, `is_active` true), y significa lo único
--    que sabemos: el SKU existe, las unidades no están contadas. Escribir un
--    número que nadie contó es inventar stock.
-- 2. **`UNKNOWN` no es `UNASSIGNED`.** UNASSIGNED quiere decir «llegó y no se
--    ha guardado» y vive en la ruta normal (`picking_order` 996). Esto otro
--    quiere decir «el catálogo lo conoce, el piso no lo ha encontrado»: va en
--    la banda de último recurso (≥ 9000, `utils/pickingOrder.ts`) para que ni
--    con stock encima mande a nadie allí, y `counts_as_storage = false` porque
--    no es espacio del edificio. Filtrar por ella **es** la lista de cajas que
--    buscar.
-- 3. **El peso del AS400 no se escribe.** No cabe: `set_is_bike_on_insert`
--    sella `weight_verified` en cuanto el INSERT trae peso, y
--    `set_dimensions_verified` lo sella también en cualquier UPDATE que cambie
--    el número («cambió un valor → verificado», 1 sep 2026) y además es
--    monótono: no se puede bajar después. O sea que no hay forma de guardar el
--    peso del AS400 sin afirmar que alguien lo puso en una báscula, y no lo
--    hizo: dice 36 donde PickD pesó 33,6 (docs/as400-screen-map.md §2.12).
--    La bandera tiene un dueño y es la báscula. El número del AS400 ya está
--    guardado con su nombre dentro de `as400_snapshot`, que es donde puede
--    decir de quién es; ascenderlo a peso de envío es una decisión aparte y con
--    los datos ya recogidos para tomarla.
--
-- Y `is_bike` sí viene del AS400 cuando se preguntó: su `B-Bike/P-Part` es la
-- respuesta autoritativa, mientras el trigger la adivina por prefijo. Un SKU de
-- departamento 01/02/03/06/07 que en realidad es una parte nacería con 45 lb y
-- caja de bici, y esa caja acaba en el export a FedEx.

-- ── 1. La ubicación ──────────────────────────────────────────────────────────
INSERT INTO public.locations (warehouse, location, zone, is_active, counts_as_storage, picking_order, notes)
VALUES ('LUDLOW', 'UNKNOWN', 'UNASSIGNED', true, false, 9999,
        'El catálogo conoce el SKU; el piso no lo ha encontrado. Al encontrarlo, mover a la fila real.')
ON CONFLICT (warehouse, location) DO NOTHING;

-- ── 2. El alta ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.register_sku_from_as400(
  p_sku               text,
  p_item_name         text,
  p_is_bike           boolean DEFAULT NULL,
  p_location          text    DEFAULT 'UNKNOWN',
  p_warehouse         text    DEFAULT 'LUDLOW',
  p_as400_description text    DEFAULT NULL,
  p_as400_snapshot    jsonb   DEFAULT NULL,
  p_internal_note     text    DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sku      text := public.canonical_sku(p_sku);
  v_name     text := NULLIF(trim(COALESCE(NULLIF(trim(p_item_name), ''), p_as400_description)), '');
  v_location text := UPPER(trim(COALESCE(NULLIF(trim(p_location), ''), 'UNKNOWN')));
  v_location_id uuid;
  v_existed  boolean;
BEGIN
  -- La forma es el filtro, igual que en el watchdog (R6): esto da de alta
  -- números de stock del AS400, no números de tracking ni seriales.
  IF v_sku !~ '^[0-9]{2}-[0-9]{4}[A-Z]{0,3}$' THEN
    RAISE EXCEPTION '% is not an AS400 stock number', p_sku USING ERRCODE = '22023';
  END IF;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'A name is required to register %', v_sku USING ERRCODE = '22023';
  END IF;

  SELECT true INTO v_existed FROM public.sku_metadata WHERE sku = v_sku;

  IF v_existed THEN
    -- Ya está en el catálogo: esto NO le toca la ubicación ni le crea
    -- inventario — una fila de metadata puede estar huérfana a propósito
    -- (`v_sku_metadata_orphans`). Solo se rellenan los huecos del AS400, con
    -- el mismo pacto del enriquecimiento: llenar un hueco sí, pisar no.
    UPDATE public.sku_metadata SET
      as400_description = COALESCE(NULLIF(trim(as400_description), ''), NULLIF(trim(p_as400_description), '')),
      as400_snapshot    = COALESCE(as400_snapshot, p_as400_snapshot),
      as400_read_at     = CASE
                            WHEN as400_read_at IS NOT NULL THEN as400_read_at
                            WHEN NULLIF(trim(p_as400_description), '') IS NOT NULL THEN now()
                            ELSE NULL
                          END
    WHERE sku = v_sku;
    RETURN jsonb_build_object('sku', v_sku, 'action', 'already_catalogued');
  END IF;

  -- Metadata primero: `inventory.sku` la referencia. Van en la misma
  -- transacción, que es lo que el formulario no puede hacer desde el navegador
  -- (de ahí su orden inverso y las 96 huérfanas que dejó).
  INSERT INTO public.sku_metadata (sku, is_bike, as400_description, as400_read_at, as400_snapshot)
  VALUES (
    v_sku,
    p_is_bike,                                            -- NULL ⇒ lo adivina el trigger por prefijo
    NULLIF(trim(p_as400_description), ''),
    CASE WHEN NULLIF(trim(p_as400_description), '') IS NOT NULL THEN now() END,
    p_as400_snapshot
  );

  v_location_id := public.resolve_location(p_warehouse, v_location, 'admin');

  INSERT INTO public.inventory (sku, warehouse, location, location_id, quantity, is_active, item_name, internal_note)
  VALUES (v_sku, p_warehouse, v_location, v_location_id, 0, true, v_name, NULLIF(trim(p_internal_note), ''))
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object(
    'sku', v_sku,
    'action', 'registered',
    'item_name', v_name,
    'location', v_location,
    'is_bike', (SELECT is_bike FROM public.sku_metadata WHERE sku = v_sku)
  );
END;
$function$;

COMMENT ON FUNCTION public.register_sku_from_as400(text, text, boolean, text, text, text, jsonb, text) IS
  'Da de alta un SKU que AS400 conoce y PickD no: metadata + una fila de inventario en qty 0 sobre UNKNOWN (o la ubicación real si se sabe). Nunca escribe cantidad y nunca toca weight_lbs (el peso del AS400 no es una báscula y cualquier write lo sellaría como tal). Rafael, 11 sep 2026.';

REVOKE ALL ON FUNCTION public.register_sku_from_as400(text, text, boolean, text, text, text, jsonb, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.register_sku_from_as400(text, text, boolean, text, text, text, jsonb, text) TO service_role, authenticated;

-- ── 3. La cola: lo que el papel nombró y el catálogo no tiene ────────────────
CREATE OR REPLACE VIEW public.v_as400_skus_unregistered AS
WITH seen AS (
  -- `item_name` lo trae solo 72 de los 109; `description` es lo que el watchdog
  -- transcribió del papel y está en los 109. Cortada a 30 caracteres en la
  -- página de ítems, pero es un nombre — y basta para dar de alta la fila si
  -- AS400 no llegara a contestar.
  SELECT UPPER(trim(i->>'sku')) AS sku,
         COALESCE(NULLIF(trim(i->>'item_name'), ''), NULLIF(trim(i->>'description'), '')) AS item_name,
         pl.created_at AS at
  FROM public.picking_lists pl, jsonb_array_elements(pl.items) i
  UNION ALL
  SELECT UPPER(trim(i->>'sku')),
         COALESCE(NULLIF(trim(i->>'item_name'), ''), NULLIF(trim(i->>'description'), '')),
         c.captured_at
  FROM public.as400_captures c, jsonb_array_elements(c.items) i
), agg AS (
  SELECT sku,
         MAX(at) AS last_seen,
         COUNT(*)::int AS times_seen,
         (ARRAY_AGG(item_name ORDER BY at DESC) FILTER (WHERE item_name IS NOT NULL))[1] AS last_name
  FROM seen
  -- La misma forma que el watchdog puede teclear en Stock Inquiry (R6).
  WHERE sku ~ '^[0-9]{2}-[0-9]{4}[A-Z]{0,3}$'
  GROUP BY sku
)
SELECT
  a.sku,
  a.last_name,
  a.last_seen,
  a.times_seen,
  -- Qué parece ser, porque no todo lo que el AS400 imprime en una orden es una
  -- caja en un estante, y darlo de alta a ciegas mandaría a alguien a buscar el
  -- impuesto sobre las ventas. Se CLASIFICA, no se descarta: la fila sigue
  -- aquí y una sola query la enseña. El watchdog da de alta 'merchandise'.
  CASE
    -- Hermano de variante: la tercera letra del papel es un sufijo de acabado,
    -- no otra bici (Rafael, 26 ago 2026 — «la caja dice BL»). `03-3768BLT` es
    -- `03-3768BL`, y registrarlo sería partir en dos lo que idea-154 unió.
    WHEN a.sku ~ '^[0-9]{2}-[0-9]{4}[A-Z]{3}$'
         AND EXISTS (SELECT 1 FROM public.sku_metadata m2 WHERE m2.sku = left(a.sku, length(a.sku) - 1))
      THEN 'variant_sibling'
    -- Scratch & Dent: una unidad concreta con su propio número, vendida una vez
    -- y nunca repuesta. Darla de alta pide buscar una bici que salió en marzo.
    WHEN a.last_name ILIKE 'S/D %' THEN 'scratch_dent'
    -- Ni caja ni estante: línea de facturación, cargo o cajón de sastre.
    WHEN a.last_name ~* '(BILLING|\mFEE\M|CHARGE|\mMISC\M)' THEN 'not_stock'
    ELSE 'merchandise'
  END AS looks_like
FROM agg a
WHERE NOT EXISTS (SELECT 1 FROM public.sku_metadata m WHERE m.sku = a.sku);

COMMENT ON VIEW public.v_as400_skus_unregistered IS
  'SKUs que AS400 imprimio en un papel (ordenes y capturas) y el catalogo de PickD no tiene. Es la cola de descubrimiento del watchdog: preguntar por ellos y darlos de alta en UNKNOWN. `looks_like` separa lo que es mercancia de los hermanos de variante, el S&D vendido y las lineas de facturacion; el watchdog solo registra merchandise.';
