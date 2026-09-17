-- De quién copió su medida una caja que nadie midió.
--
-- Una gemela de color es una medición (Rafael, 9 sep 2026: «las cajas de los
-- modelos que solo cambian por color pesan lo mismo y miden lo mismo»), y la app
-- ya deja copiarla con un toque — con una etiqueta que dice de quién la copia.
-- Al hacerlo en bloque ese rastro se perdería, y `dimensions_verified` pasa a
-- afirmar que alguien midió: sin esta tabla, quedaría dicho sin quién lo dijo.
--
-- Append-only, como `sku_canonical_renames` y `sublocation_relabels`: nadie la
-- edita ni la borra, y se lee para contestar «¿esta medida de dónde salió?».
CREATE TABLE IF NOT EXISTS public.sku_measurement_copies (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sku         text NOT NULL,
  -- Las gemelas de las que salió. Varias cuando el modelo+talla tenía más de una
  -- medida y se promediaron.
  from_skus   text[] NOT NULL,
  model       text,
  size        text,
  length_in   numeric,
  width_in    numeric,
  height_in   numeric,
  weight_lbs  numeric,
  copied_by   text NOT NULL,
  note        text,
  copied_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sku_measurement_copies_sku_idx ON public.sku_measurement_copies (sku);

ALTER TABLE public.sku_measurement_copies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read measurement copies" ON public.sku_measurement_copies;
CREATE POLICY "admins read measurement copies"
  ON public.sku_measurement_copies FOR SELECT
  USING (public.is_admin());
