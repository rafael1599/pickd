-- La lectura de cada foto de pallet, hasta que termine (F0 de idea-247,
-- docs/prds/pick-pallet-by-pallet.md; Rafael, 6 oct 2026: «el posprocesamiento
-- de la foto … debe continuar en el background aunque el usuario ya no esté en
-- la misma orden o usando la app hasta que se termine, la alerta si es que la
-- hay también se debe ver en ship y mostrar en rojo la imagen en la que se
-- detectó»).
--
-- Hasta hoy la lectura vivía sólo en el teléfono que sacó la foto: si quien
-- verificaba pasaba a otra orden, Double Check tiraba el resultado (de 18 fotos
-- con ≥ 4 etiquetas desde el 1 oct, 3 quedaron como frente); si cerraba la app,
-- la foto no se leía nunca. Y lo que se leía (`dcv_shadow_runs`,
-- `pallet_fronts`) sólo lo ve un admin, así que Ship no podía avisar.
--
-- Una fila por foto, desde que se toma:
--   reading  → la está leyendo alguien (`claimed_by`), desde `claimed_at`
--   pending  → nadie la tiene: cualquier PickD abierta la toma
--              (`claim_photo_read`) y baja el original con su reclamo
--   done     → `alerts` (lo que no es de la orden, lo que parece un error de
--              recogida) y `front` (el frente, si lo es) quedan para todos
--   failed   → tres intentos sin terminar
-- Una lectura `reading` que no termina en 3 min vuelve a estar disponible.
--
-- Sólo SKUs y posiciones: ningún texto leído de la foto (las etiquetas de FedEx
-- llevan nombres y direcciones; eso se queda en el bucket privado).

CREATE TABLE IF NOT EXISTS public.photo_reads (
  photo_id      uuid PRIMARY KEY,                  -- el mismo de la copia pública y del original
  list_id       uuid NOT NULL,
  shipment_id   uuid,                              -- lo sella el trigger
  group_id      uuid,
  created_by    uuid NOT NULL DEFAULT auth.uid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  taken_at      timestamptz NOT NULL,              -- la hora de la cámara
  pallet_hint   integer,                           -- la tarima cuyo botón abrió la cámara
  shot          integer,                           -- 1.ª, 2.ª… foto de esa vez que se abrió
  group_members jsonb NOT NULL DEFAULT '[]'::jsonb,
  lines         jsonb NOT NULL DEFAULT '[]'::jsonb, -- las líneas del grupo al tomarla
  snapshot      jsonb NOT NULL DEFAULT '[]'::jsonb, -- cada caja en su tarima al tomarla
  photo_key     text,                              -- el original privado, cuando ya subió
  status        text NOT NULL DEFAULT 'reading'
                CHECK (status IN ('pending', 'reading', 'done', 'failed')),
  claimed_by    uuid,
  claimed_at    timestamptz,
  attempts      integer NOT NULL DEFAULT 1,
  done_at       timestamptz,
  error         text,
  alerts        jsonb NOT NULL DEFAULT '[]'::jsonb,
  front         jsonb,
  applied_at    timestamptz,                       -- el frente ya se guardó en su tarima
  applied_by    uuid
);

COMMENT ON TABLE public.photo_reads IS
  'Lectura de cada foto de pallet hasta que termine (idea-247 F0): reading/pending/'
  'done/failed; cualquier PickD abierta toma las pendientes (claim_photo_read). '
  'alerts y front los ve todo el personal (Double Check y Ship). Sólo SKUs, nunca '
  'texto de la foto.';

CREATE INDEX IF NOT EXISTS photo_reads_shipment_idx ON public.photo_reads (shipment_id);
CREATE INDEX IF NOT EXISTS photo_reads_list_idx ON public.photo_reads (list_id);
CREATE INDEX IF NOT EXISTS photo_reads_open_idx ON public.photo_reads (created_at)
  WHERE status IN ('pending', 'reading');

-- Al insertar: el envío y el grupo de la orden, y quien la tomó la está leyendo.
CREATE OR REPLACE FUNCTION public.stamp_photo_read()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.created_by := auth.uid();
  NEW.created_at := now();
  NEW.status := 'reading';
  NEW.claimed_by := auth.uid();
  NEW.claimed_at := now();
  NEW.attempts := 1;
  NEW.done_at := NULL;
  NEW.alerts := '[]'::jsonb;
  NEW.front := NULL;
  NEW.applied_at := NULL;
  NEW.applied_by := NULL;
  SELECT pl.shipment_id, pl.group_id
    INTO NEW.shipment_id, NEW.group_id
    FROM public.picking_lists pl
   WHERE pl.id = NEW.list_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_photo_reads_stamp ON public.photo_reads;
CREATE TRIGGER tr_photo_reads_stamp
  BEFORE INSERT ON public.photo_reads
  FOR EACH ROW EXECUTE FUNCTION public.stamp_photo_read();

ALTER TABLE public.photo_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS photo_reads_insert_own ON public.photo_reads;
CREATE POLICY photo_reads_insert_own ON public.photo_reads
  FOR INSERT TO authenticated WITH CHECK (true);  -- el trigger fuerza quién y el estado

DROP POLICY IF EXISTS photo_reads_select_staff ON public.photo_reads;
CREATE POLICY photo_reads_select_staff ON public.photo_reads
  FOR SELECT TO authenticated USING (true);

-- Sin UPDATE ni DELETE directos: todo cambio pasa por las funciones de abajo.

/** El original ya subió: quien la tomó o quien la lee deja la llave. */
CREATE OR REPLACE FUNCTION public.set_photo_read_key(p_photo_id uuid, p_key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_key !~ '^full/\d{4}/\d{2}/[0-9a-f-]{36}\.jpg$' THEN
    RAISE EXCEPTION 'invalid key';
  END IF;
  UPDATE public.photo_reads
     SET photo_key = COALESCE(photo_key, p_key)
   WHERE photo_id = p_photo_id
     AND (created_by = auth.uid() OR claimed_by = auth.uid());
END;
$$;

/**
 * La lectura pendiente más vieja, para quien llama. `p_mine_only`: sólo las
 * fotos que tomó él (un teléfono retoma las suyas; la PC de Ship toma
 * cualquiera). Una `reading` sin terminar en `p_stale_seconds` cuenta como
 * libre. Atómica: dos PickD nunca toman la misma.
 */
CREATE OR REPLACE FUNCTION public.claim_photo_read(
  p_mine_only boolean DEFAULT false,
  p_stale_seconds integer DEFAULT 180
)
RETURNS SETOF public.photo_reads
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;
  SELECT photo_id INTO v_id
    FROM public.photo_reads
   WHERE photo_key IS NOT NULL
     AND attempts < 3
     AND created_at > now() - interval '7 days'
     AND (status = 'pending'
          OR (status = 'reading' AND claimed_at < now() - make_interval(secs => p_stale_seconds)))
     AND (NOT p_mine_only OR created_by = auth.uid())
   ORDER BY created_at
   LIMIT 1
   FOR UPDATE SKIP LOCKED;
  IF v_id IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
  UPDATE public.photo_reads
     SET status = 'reading',
         claimed_by = auth.uid(),
         claimed_at = now(),
         attempts = attempts + 1
   WHERE photo_id = v_id
  RETURNING *;
END;
$$;

/** Quien la lee la suelta sin terminar (cola llena, sin motor): otra PickD la toma. */
CREATE OR REPLACE FUNCTION public.release_photo_read(p_photo_id uuid, p_error text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.photo_reads
     SET status = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'pending' END,
         error = COALESCE(left(p_error, 2000), error)
   WHERE photo_id = p_photo_id
     AND claimed_by = auth.uid()
     AND status = 'reading';
END;
$$;

/** Terminada: lo que vio, para todos. Sólo quien la tiene. */
CREATE OR REPLACE FUNCTION public.finish_photo_read(
  p_photo_id uuid,
  p_alerts jsonb,
  p_front jsonb,
  p_error text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.photo_reads
     SET status = 'done',
         done_at = now(),
         alerts = COALESCE(p_alerts, '[]'::jsonb),
         front = p_front,
         error = left(p_error, 2000)
   WHERE photo_id = p_photo_id
     AND claimed_by = auth.uid()
     AND status = 'reading';
END;
$$;

/** El frente ya se guardó en su tarima (lo hizo Double Check al abrir la orden). */
CREATE OR REPLACE FUNCTION public.mark_photo_read_applied(p_photo_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;
  UPDATE public.photo_reads
     SET applied_at = now(),
         applied_by = auth.uid()
   WHERE photo_id = p_photo_id
     AND applied_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.set_photo_read_key(uuid, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.claim_photo_read(boolean, integer) FROM public, anon;
REVOKE ALL ON FUNCTION public.release_photo_read(uuid, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.finish_photo_read(uuid, jsonb, jsonb, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.mark_photo_read_applied(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_photo_read_key(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_photo_read(boolean, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_photo_read(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finish_photo_read(uuid, jsonb, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_photo_read_applied(uuid) TO authenticated;

-- Double Check y Ship se enteran al instante de una lectura que termina.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'photo_reads'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.photo_reads;
  END IF;
END;
$$;
