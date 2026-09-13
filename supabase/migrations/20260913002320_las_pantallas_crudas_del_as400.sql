-- Las pantallas del AS400, tal cual, para poder mirarlas.
--
-- Rafael, 12 sep 2026: «si nos enfocamos en un análisis de las pantallas
-- primero, podemos definir el modo más rápido… una persona que sabe usar el
-- sistema saca un SKU cada cinco o seis segundos incluyendo copiar, porque se
-- mantiene en la misma página».
--
-- Tiene razón y es la crítica correcta: llevo toda la noche ajustando esperas y
-- SUPONIENDO en qué pantalla queda el terminal, sin un modelo de las pantallas.
-- Tres intentos de acelerar, tres revertidos, los tres por lo mismo. El watchdog
-- lee estas pantallas dos mil veces y las tira todas; guardar una muestra
-- convierte «creo que después del envío el buscador queda vacío» en algo que se
-- mira.
--
-- Append-only y acotada por el propio watchdog (unas pocas por clase y por
-- proceso). No es un log: es el material de un análisis que se hace una vez.

CREATE TABLE IF NOT EXISTS public.as400_screens (
  id          bigserial PRIMARY KEY,
  sku         text,
  -- Qué creíamos que era al leerla: `detail`, `blank`, `notes`, `mismatch`…
  -- Guardarlo junto al texto es lo que permite comprobar si la clasificación
  -- acierta, que es justo lo que fallaba.
  classified  text,
  -- Qué se acababa de teclear, para saber qué produjo esta pantalla.
  after       text,
  raw         text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.as400_screens IS
  'Muestra de pantallas crudas del AS400 con lo que el watchdog creyo que eran. Material para mapear la navegacion y definir la ruta mas corta (Rafael, 12 sep 2026). No es un log: se llena una vez, se analiza y se puede vaciar.';

ALTER TABLE public.as400_screens ENABLE ROW LEVEL SECURITY;

-- Solo el watchdog escribe (service_role ignora RLS) y solo un admin mira.
DROP POLICY IF EXISTS as400_screens_admin_read ON public.as400_screens;
CREATE POLICY as400_screens_admin_read ON public.as400_screens
  FOR SELECT USING (public.is_admin());
