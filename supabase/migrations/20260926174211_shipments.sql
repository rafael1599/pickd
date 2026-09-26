-- ============================================================================
-- El envío como entidad: public.shipments y picking_lists.shipment_id
-- (26 sep 2026; docs/prds/shipments.md, backlog idea-230, bug-032, bug-045)
-- Fases 1 y 2: Esquema, trigger de alta, fotos atómicas y backfill por pl.id
-- ============================================================================
--
-- MOTIVACIÓN Y CIFRAS DE PRODUCCIÓN:
--
-- Hasta hoy, PickD sobrecargaba la tabla `picking_lists` convirtiendo a una orden
-- individual (la «ancla») en la portadora de los hechos físicos del envío:
--
--   1. En 57 combinadas 'general' analizadas (últimos 90 días), 11 sufrían
--      duplicación de tarimas porque el valor se guardaba en más de una hermana
--      y Ship sumaba ambas. Para evitarlo, la UI recurría a forzar pallets_qty = 0
--      en las órdenes hermanas (ShipScreen.tsx:2222, usePickingActions.ts:409).
--   2. 37 de esas 57 combinadas tenían fotos divergentes entre miembros porque el
--      cajón de picking sobreescribía las fotos de la ancla sobre las hermanas.
--   3. El índice UNIQUE en picking_lists.load_number causaba fallos 23505 (bug-032)
--      al combinarse órdenes, obligando a scripts de limpieza como clearNonAnchorLoadNumbers.
--   4. El 95.87 % de los grupos FedEx (209 de 218) mezclan clientes distintos (hasta 5);
--      un grupo FedEx es un lote de trabajo de picking, no un envío físico.
--   5. Existen 30 números de orden repetidos en prod (2.058 filas, 2.028 números).
--      Por ello, el modelo y el backfill se vinculan estrictamente por picking_lists.id
--      y NUNCA por order_number.
--
-- Esta migración implementa las Fases 1 y 2 (aditiva y no destructiva):
--   - Fase 1: Tabla public.shipments, columna picking_lists.shipment_id, índices,
--             RLS idéntica a picking_lists, publicación supabase_realtime,
--             trigger BEFORE INSERT de alta automática y funciones atómicas de fotos.
--   - Fase 2: Backfill completo en prod: 1 envío consolidado por grupo general/pickup
--             (con los hechos de la ancla más vieja por created_at, fotos unificadas
--             sin repetir y suma de pallets_qty) y 1 envío por cada orden restante
--             vinculado exactamente por su id primario.
-- ============================================================================

-- ── 1) Tabla public.shipments ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.shipments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  customer_id        uuid REFERENCES public.customers(id),
  ship_to_address_id uuid,
  transport_company  text,
  load_number        text,          -- null en FedEx
  pallets_qty        integer NOT NULL DEFAULT 0,
  total_weight_lbs   numeric,
  pallet_dims        jsonb NOT NULL DEFAULT '[]'::jsonb,  -- lo que dijo el piso, por tarima
  pallet_photos      jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_shipped         boolean NOT NULL DEFAULT false,
  shipped_at         timestamptz,                         -- hoy no existía; se aproxima con updated_at
  metadata           jsonb NOT NULL DEFAULT '{}'::jsonb   -- legacy_group_id, member_ids al migrar
);

COMMENT ON TABLE public.shipments IS
  'Entidad física del envío en PickD. Contiene los hechos de carga (tarimas, medidas, '
  'fotos, transportista, load #, dirección y despacho). Toda orden pertenece a un envío.';

-- Índice UNIQUE parcial: un envío = un load # (resuelve bug-032; FedEx queda en null)
CREATE UNIQUE INDEX IF NOT EXISTS shipments_load_number_key
  ON public.shipments (load_number)
  WHERE load_number IS NOT NULL;

-- Índices de consulta operativa
CREATE INDEX IF NOT EXISTS shipments_customer_id_idx ON public.shipments (customer_id);
CREATE INDEX IF NOT EXISTS shipments_is_shipped_idx ON public.shipments (is_shipped);
CREATE INDEX IF NOT EXISTS shipments_updated_at_idx ON public.shipments (updated_at);

-- Trigger de updated_at
CREATE TRIGGER trg_shipments_updated_at
  BEFORE UPDATE ON public.shipments
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ── 2) Columna shipment_id en picking_lists ─────────────────────────────────

ALTER TABLE public.picking_lists
  ADD COLUMN IF NOT EXISTS shipment_id uuid REFERENCES public.shipments(id);

CREATE INDEX IF NOT EXISTS picking_lists_shipment_id_idx
  ON public.picking_lists (shipment_id)
  WHERE shipment_id IS NOT NULL;

-- ── 3) Publicación Supabase Realtime ─────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'shipments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.shipments;
  END IF;
END $$;

-- ── 4) Row Level Security (RLS) ─────────────────────────────────────────────
-- Mismas políticas colaborativas vigentes en picking_lists (pg_policies):
-- Autenticados leen, crean y actualizan; nadie borra; anon denegado.

ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Collaborative Select" ON public.shipments;
CREATE POLICY "Collaborative Select" ON public.shipments
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Collaborative Insert" ON public.shipments;
CREATE POLICY "Collaborative Insert" ON public.shipments
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Collaborative Update" ON public.shipments;
CREATE POLICY "Collaborative Update" ON public.shipments
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Sin política de DELETE a propósito: un envío es historia y no se borra
-- (docs/prds/shipments.md §4 — uno sin órdenes vivas se deja de mostrar).

GRANT SELECT, INSERT, UPDATE ON TABLE public.shipments TO authenticated;
GRANT ALL ON TABLE public.shipments TO service_role;

-- ── 5) Funciones atómicas de fotos del envío ────────────────────────────────
-- Calcadas de append_pallet_photo / remove_pallet_photo (20260925170448).
-- Idempotentes y SECURITY INVOKER.

CREATE OR REPLACE FUNCTION public.append_shipment_photo(p_shipment_id uuid, p_url text)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  UPDATE shipments
     SET pallet_photos = CASE
           WHEN coalesce(pallet_photos, '[]'::jsonb) ? p_url THEN pallet_photos
           ELSE coalesce(pallet_photos, '[]'::jsonb) || jsonb_build_array(p_url)
         END
   WHERE id = p_shipment_id
  RETURNING pallet_photos;
$$;

CREATE OR REPLACE FUNCTION public.remove_shipment_photo(p_shipment_id uuid, p_url text)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  UPDATE shipments
     SET pallet_photos = coalesce(pallet_photos, '[]'::jsonb) - p_url
   WHERE id = p_shipment_id
  RETURNING pallet_photos;
$$;

REVOKE ALL ON FUNCTION public.append_shipment_photo(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remove_shipment_photo(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.append_shipment_photo(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_shipment_photo(uuid, text) TO authenticated;

-- ── 6) Trigger BEFORE INSERT de alta automática en picking_lists ───────────
-- Si NEW.shipment_id es NULL, crea un envío en public.shipments y le asigna el id.
-- En FedEx (shipping_type='fedex' o transport_company FEDEX), load_number es NULL.
-- Orden alfabético: 'trg_ensure_order_shipment' corre DESPUÉS de
-- 'a_stamp_item_sku_metadata' y 'auto_group_fedex_orders_trigger'.

CREATE OR REPLACE FUNCTION public.ensure_order_shipment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_shipment_id uuid;
  v_is_fedex boolean;
  v_load_number text;
BEGIN
  -- Si ya se proporcionó shipment_id explícito, no crear otro
  IF NEW.shipment_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Determinar si es FedEx para forzar load_number en NULL
  v_is_fedex := (NEW.shipping_type = 'fedex')
                OR (UPPER(TRIM(COALESCE(NEW.transport_company, ''))) = 'FEDEX');

  IF v_is_fedex THEN
    v_load_number := NULL;
  ELSE
    v_load_number := NEW.load_number;
  END IF;

  INSERT INTO public.shipments (
    customer_id,
    ship_to_address_id,
    transport_company,
    load_number,
    pallets_qty,
    total_weight_lbs,
    pallet_dims,
    pallet_photos,
    is_shipped,
    shipped_at
  ) VALUES (
    NEW.customer_id,
    NEW.ship_to_address_id,
    NEW.transport_company,
    v_load_number,
    COALESCE(NEW.pallets_qty, 0),
    NEW.total_weight_lbs,
    COALESCE(NEW.pallet_dims, '[]'::jsonb),
    COALESCE(NEW.pallet_photos, '[]'::jsonb),
    COALESCE(NEW.is_shipped, false),
    CASE WHEN NEW.is_shipped IS TRUE THEN COALESCE(NEW.updated_at, now()) ELSE NULL END
  )
  RETURNING id INTO v_shipment_id;

  NEW.shipment_id := v_shipment_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ensure_order_shipment ON public.picking_lists;
CREATE TRIGGER trg_ensure_order_shipment
  BEFORE INSERT ON public.picking_lists
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_order_shipment();

-- ── 7) Fase 2: Backfill de datos históricos ─────────────────────────────────
-- A) Envíos combinados para grupos 'general' y 'pickup'.
--    Hechos de la ancla (la más vieja por created_at): cliente, dirección,
--    carrier, load_number, pallet_dims, total_weight_lbs.
--    pallets_qty = suma de todos los miembros.
--    pallet_photos = unión en orden sin repetir.
--    is_shipped = true si todas las órdenes del grupo fueron enviadas.
--    shipped_at = MAX(updated_at) como aproximación si is_shipped.

WITH deliberate_groups AS (
  SELECT DISTINCT og.id AS group_id, og.group_type
  FROM public.order_groups og
  JOIN public.picking_lists pl ON pl.group_id = og.id
  WHERE og.group_type IN ('general', 'pickup')
),
group_members_ranked AS (
  SELECT 
    pl.id,
    pl.group_id,
    pl.order_number,
    pl.created_at,
    pl.updated_at,
    pl.customer_id,
    pl.ship_to_address_id,
    pl.transport_company,
    pl.load_number,
    pl.pallets_qty,
    pl.total_weight_lbs,
    pl.pallet_dims,
    pl.pallet_photos,
    pl.is_shipped,
    ROW_NUMBER() OVER (
      PARTITION BY pl.group_id 
      ORDER BY pl.created_at ASC, pl.id ASC
    ) as rk
  FROM public.picking_lists pl
  JOIN deliberate_groups dg ON dg.group_id = pl.group_id
),
photos_unnested AS (
  SELECT 
    gmr.group_id,
    elem,
    ROW_NUMBER() OVER (
      PARTITION BY gmr.group_id 
      ORDER BY gmr.created_at ASC, gmr.id ASC, ord ASC
    ) as overall_ord
  FROM group_members_ranked gmr
  CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(gmr.pallet_photos, '[]'::jsonb)) WITH ORDINALITY AS t(elem, ord)
),
photos_deduped AS (
  SELECT 
    group_id,
    jsonb_agg(elem ORDER BY first_seen) as pallet_photos
  FROM (
    SELECT group_id, elem, MIN(overall_ord) as first_seen
    FROM photos_unnested
    GROUP BY group_id, elem
  ) sub
  GROUP BY group_id
),
aggregated_groups AS (
  SELECT 
    gmr.group_id,
    (array_agg(gmr.customer_id ORDER BY gmr.rk))[1] as customer_id,
    (array_agg(gmr.ship_to_address_id ORDER BY gmr.rk))[1] as ship_to_address_id,
    (array_agg(gmr.transport_company ORDER BY gmr.rk))[1] as transport_company,
    (array_agg(gmr.load_number ORDER BY gmr.rk))[1] as load_number,
    -- La primera no vacía por antigüedad: hoy siempre es la ancla (0 de 61
    -- combinadas tienen medidas en una hermana), pero DCV abierto en una
    -- hermana escribiría allí.
    COALESCE(
      (array_agg(gmr.pallet_dims ORDER BY gmr.rk)
         FILTER (WHERE jsonb_array_length(COALESCE(gmr.pallet_dims, '[]'::jsonb)) > 0))[1],
      '[]'::jsonb
    ) as pallet_dims,
    SUM(COALESCE(gmr.pallets_qty, 0))::integer as pallets_qty,
    (array_agg(gmr.total_weight_lbs ORDER BY gmr.rk))[1] as total_weight_lbs,
    COALESCE(pd.pallet_photos, '[]'::jsonb) as pallet_photos,
    BOOL_AND(COALESCE(gmr.is_shipped, false)) as is_shipped,
    CASE 
      WHEN BOOL_AND(COALESCE(gmr.is_shipped, false)) THEN MAX(gmr.updated_at)
      ELSE NULL 
    END as shipped_at,
    MIN(gmr.created_at) as created_at,
    MAX(gmr.updated_at) as updated_at,
    jsonb_build_object(
      'legacy_group_id', gmr.group_id,
      'member_ids', array_agg(gmr.id ORDER BY gmr.created_at ASC, gmr.id ASC)
    ) as metadata
  FROM group_members_ranked gmr
  LEFT JOIN photos_deduped pd ON pd.group_id = gmr.group_id
  GROUP BY gmr.group_id, pd.pallet_photos
)
INSERT INTO public.shipments (
  customer_id,
  ship_to_address_id,
  transport_company,
  load_number,
  pallets_qty,
  total_weight_lbs,
  pallet_dims,
  pallet_photos,
  is_shipped,
  shipped_at,
  created_at,
  updated_at,
  metadata
)
SELECT 
  customer_id,
  ship_to_address_id,
  transport_company,
  load_number,
  pallets_qty,
  total_weight_lbs,
  pallet_dims,
  pallet_photos,
  is_shipped,
  shipped_at,
  created_at,
  updated_at,
  metadata
FROM aggregated_groups;

-- B) Vincular los miembros de grupos combinados a su envío
UPDATE public.picking_lists pl
SET shipment_id = s.id
FROM public.shipments s
WHERE pl.group_id = (s.metadata->>'legacy_group_id')::uuid
  AND pl.shipment_id IS NULL;

-- C) Envíos individuales para todas las órdenes restantes (sueltas y lotes FedEx).
--    Se une estrictamente por pl.id para no colisionar con los 30 order_numbers repetidos.
WITH individual_orders AS (
  SELECT 
    pl.id as order_id,
    pl.customer_id,
    pl.ship_to_address_id,
    pl.transport_company,
    CASE 
      WHEN pl.shipping_type = 'fedex' OR UPPER(TRIM(COALESCE(pl.transport_company, ''))) = 'FEDEX' THEN NULL
      ELSE pl.load_number
    END as load_number,
    COALESCE(pl.pallets_qty, 0) as pallets_qty,
    pl.total_weight_lbs,
    COALESCE(pl.pallet_dims, '[]'::jsonb) as pallet_dims,
    COALESCE(pl.pallet_photos, '[]'::jsonb) as pallet_photos,
    COALESCE(pl.is_shipped, false) as is_shipped,
    CASE 
      WHEN COALESCE(pl.is_shipped, false) IS TRUE THEN pl.updated_at 
      ELSE NULL 
    END as shipped_at,
    pl.created_at,
    pl.updated_at,
    jsonb_build_object(
      'legacy_order_id', pl.id,
      'legacy_group_id', pl.group_id
    ) as metadata
  FROM public.picking_lists pl
  WHERE pl.shipment_id IS NULL
  ORDER BY pl.created_at ASC, pl.id ASC
),
inserted_individual AS (
  INSERT INTO public.shipments (
    customer_id,
    ship_to_address_id,
    transport_company,
    load_number,
    pallets_qty,
    total_weight_lbs,
    pallet_dims,
    pallet_photos,
    is_shipped,
    shipped_at,
    created_at,
    updated_at,
    metadata
  )
  SELECT 
    customer_id,
    ship_to_address_id,
    transport_company,
    load_number,
    pallets_qty,
    total_weight_lbs,
    pallet_dims,
    pallet_photos,
    is_shipped,
    shipped_at,
    created_at,
    updated_at,
    metadata
  FROM individual_orders
  RETURNING id, (metadata->>'legacy_order_id')::uuid as target_order_id
)
UPDATE public.picking_lists pl
SET shipment_id = ins.id
FROM inserted_individual ins
WHERE pl.id = ins.target_order_id;
