-- La línea de tiempo de cada envío: cada marca del picker y cada edición de una
-- tarima, con su hora y quién (idea-245, F0; docs/prds/pallet-box-inference.md
-- §6.2 y §6.7).
--
-- Hasta hoy ninguna lo tenía: `verified_item_keys` es un conjunto sin hora, se
-- fusiona entre teléfonos (pierde el orden) y Ready to DC lo vacía; y
-- `pallet_dims[].items` / `bikes` / `split` no dicen cuándo ni quién. El orden
-- de las marcas del picker es el orden de carga (Rafael, 3 oct 2026: «se marca
-- cuando se recoge y sube sobre la tarima… ese orden manda»), así que hay que
-- guardarlo desde el primer día aunque F0 todavía no lo lea para nada.
--
-- Append-only. Escribe el propio usuario; lee admin; fuera de realtime.
-- Sin FK a propósito, como dcv_shadow_runs: un grupo se borra al cancelar.

CREATE TABLE IF NOT EXISTS public.pallet_events (
  id           uuid PRIMARY KEY,                       -- lo genera el cliente: un reintento no duplica
  at           timestamptz NOT NULL DEFAULT now(),     -- hora del servidor
  client_at    timestamptz,                            -- hora del teléfono al tocar (el orden si el insert tarda)
  user_id      uuid NOT NULL DEFAULT auth.uid(),
  device       text,                                   -- id estable del navegador, no el UA

  list_id      uuid,
  shipment_id  uuid,                                   -- lo sella el trigger desde list_id
  group_id     uuid,                                   -- ídem

  kind         text NOT NULL CHECK (kind IN ('check', 'uncheck', 'edit', 'answer', 'front', 'front_removed')),
  -- pick = antes de Ready to DC (el picker: orden de carga); check = después
  -- (quien verifica marca para guiarse; no mueve ninguna caja).
  phase        text CHECK (phase IN ('pick', 'check')),

  sku          text,
  location     text,
  cart_pallet  integer,                                -- el número que lleva la llave del carrito (el plan)
  pallet       integer,                                -- la tarima a la que se refiere una edición
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,     -- lo que guardó la edición; {bulk:true} en Select all / Clear
  taken_at     timestamptz                             -- sólo frentes (F1): la hora de la cámara
);

COMMENT ON TABLE public.pallet_events IS
  'Línea de tiempo por envío (idea-245): marcas del picker (phase pick = orden de '
  'carga) y de quien verifica (phase check), ediciones de tarima (items, bikes, '
  'split) y, desde F1, frentes. Append-only; shipment_id y group_id los sella el '
  'trigger desde list_id. Escribe el propio usuario; lee admin.';

CREATE INDEX IF NOT EXISTS pallet_events_shipment_at_idx ON public.pallet_events (shipment_id, at);
CREATE INDEX IF NOT EXISTS pallet_events_list_at_idx ON public.pallet_events (list_id, at);

-- El envío y el grupo se leen de la orden en el instante del evento: el cliente
-- sólo sabe su lista, y un carrito combinado mezcla líneas de varias.
CREATE OR REPLACE FUNCTION public.stamp_pallet_event()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.user_id := auth.uid();
  NEW.at := now();
  IF NEW.list_id IS NOT NULL THEN
    SELECT pl.shipment_id, pl.group_id
      INTO NEW.shipment_id, NEW.group_id
      FROM public.picking_lists pl
     WHERE pl.id = NEW.list_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_pallet_events_stamp ON public.pallet_events;
CREATE TRIGGER tr_pallet_events_stamp
  BEFORE INSERT ON public.pallet_events
  FOR EACH ROW EXECUTE FUNCTION public.stamp_pallet_event();

ALTER TABLE public.pallet_events ENABLE ROW LEVEL SECURITY;

-- Append-only: ninguna política de UPDATE ni DELETE.
DROP POLICY IF EXISTS pallet_events_insert_own ON public.pallet_events;
CREATE POLICY pallet_events_insert_own ON public.pallet_events
  FOR INSERT TO authenticated WITH CHECK (true);  -- user_id lo fuerza el trigger

DROP POLICY IF EXISTS pallet_events_select_admin ON public.pallet_events;
CREATE POLICY pallet_events_select_admin ON public.pallet_events
  FOR SELECT TO authenticated USING (public.is_admin());

REVOKE ALL ON public.pallet_events FROM anon;
