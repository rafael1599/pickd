-- Cada foto que fue un frente de tarima, con lo que se vio y lo que se hizo con
-- ella (idea-245, F1; docs/prds/pallet-box-inference.md §6.2).
--
-- Double Check lee el frente (frontRead), decide de qué tarima es (casos A–D) y,
-- si la tarima es segura, guarda la foto como lo más nuevo que se sabe de esa
-- tarima. Esta fila es la evidencia para medir (F2): qué se propuso, en qué
-- tarima, qué cajas se trajeron de otra y cuáles no se vieron. Lo que contesta
-- el picker después (✓ / ✗, elegir la tarima) va a pallet_events como 'answer'.
--
-- Sólo SKU y posiciones: nunca texto leído (las fotos traen guías de FedEx).
-- Append-only. Escribe el propio usuario; lee admin. Sin FK, como pallet_events.

CREATE TABLE IF NOT EXISTS public.pallet_fronts (
  id               uuid PRIMARY KEY,                 -- lo genera el cliente: un reintento no duplica
  created_at       timestamptz NOT NULL DEFAULT now(),
  user_id          uuid NOT NULL DEFAULT auth.uid(),
  list_id          uuid,
  shipment_id      uuid,                             -- lo sella el trigger desde list_id
  photo_id         uuid NOT NULL,                    -- el de la copia pública y el original de la sombra
  taken_at         timestamptz NOT NULL,             -- la hora de la cámara: es la que ordena (§6.7)
  front_case       text NOT NULL CHECK (front_case IN ('A', 'B', 'C', 'D')),
  pallet_inferred  integer,                          -- null en C y D: pregunta el picker
  applied          boolean NOT NULL DEFAULT false,   -- se guardó en la tarima al leerla
  observed         jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{sku, x_in, y_in, upright, level, pos}]
  moved            jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{sku, from}] traídas de otra tarima
  missing          jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{sku, location}] estaban y no se ven
  not_in_order     integer NOT NULL DEFAULT 0,
  fit_rms_in       numeric
);

COMMENT ON TABLE public.pallet_fronts IS
  'Una fila por foto de pallet que fue frente (≥ 4 etiquetas ubicadas, idea-245): '
  'caso A–D, tarima inferida, lo observado (sólo SKU y posiciones), lo traído de '
  'otra tarima y lo que no se vio. Las respuestas del picker van a pallet_events. '
  'Append-only; escribe el propio usuario; lee admin.';

CREATE INDEX IF NOT EXISTS pallet_fronts_shipment_idx ON public.pallet_fronts (shipment_id, taken_at);
CREATE UNIQUE INDEX IF NOT EXISTS pallet_fronts_photo_idx ON public.pallet_fronts (photo_id);

CREATE OR REPLACE FUNCTION public.stamp_pallet_front()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.user_id := auth.uid();
  NEW.created_at := now();
  IF NEW.list_id IS NOT NULL THEN
    SELECT pl.shipment_id INTO NEW.shipment_id FROM public.picking_lists pl WHERE pl.id = NEW.list_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_pallet_fronts_stamp ON public.pallet_fronts;
CREATE TRIGGER tr_pallet_fronts_stamp
  BEFORE INSERT ON public.pallet_fronts
  FOR EACH ROW EXECUTE FUNCTION public.stamp_pallet_front();

ALTER TABLE public.pallet_fronts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pallet_fronts_insert_own ON public.pallet_fronts;
CREATE POLICY pallet_fronts_insert_own ON public.pallet_fronts
  FOR INSERT TO authenticated WITH CHECK (true);  -- user_id lo fuerza el trigger

DROP POLICY IF EXISTS pallet_fronts_select_admin ON public.pallet_fronts;
CREATE POLICY pallet_fronts_select_admin ON public.pallet_fronts
  FOR SELECT TO authenticated USING (public.is_admin());

REVOKE ALL ON public.pallet_fronts FROM anon;
