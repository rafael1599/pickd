-- El pallet como bulto: cuánto mide, para declararlo en Audit Source.
--
-- Una carga regular se cotiza por bultos — cuántos pallets, cuánto pesan y, en
-- LTL, cuánto miden. PickD nunca tuvo la medida. La toma el operador en Double
-- Check con la cinta en la mano y la lee la estación en Ship.
--
-- Es un array por ORDINAL de pallet, no una tabla: el pallet no es una entidad
-- en PickD, se calcula (`calculatePallets`, 8/10/12 por relleno codicioso) y lo
-- único que se persistía era su número (`pallets_qty`). Una tabla con PK sobre
-- un ordinal calculado sólo disfrazaría eso. Llegará el día que se persista el
-- reparto; hoy no existe.
--
-- Forma de cada entrada:
--   { "pallet": 1,            -- ordinal dentro del carrito, 1-based
--     "length_in": 55, "width_in": 43, "height_in": 80,   -- null = nadie lo tecleó
--     "units": 12,            -- unidades al medir: la huella de vigencia
--     "measured_by": "<uuid>", "measured_at": "<timestamptz>" }
--
-- `null` en un eje significa «nadie midió», nunca cero — un cero guardado es una
-- medida, y una medida de cero llega al portal del carrier. De dónde salió la
-- cifra NO se guarda: se deriva de qué ejes están en null (ver
-- `src/utils/palletDims.ts`), porque una bandera junto a los valores que la
-- determinan se desincroniza (bug-020).
--
-- Escribe la fila que Double Check tiene abierta, que en una combinada es el
-- ancla — la misma regla que ya sigue el override de `pallets_qty`.
alter table picking_lists
  add column if not exists pallet_dims jsonb not null default '[]'::jsonb;

comment on column picking_lists.pallet_dims is
  'Medidas por ordinal de pallet, tecleadas en Double Check y declaradas en Ship. '
  'Eje en null = nadie lo midió (se estima); `units` es la huella de vigencia. '
  'Ver docs/prds/ship-pallet-dimensions.md y src/utils/palletDims.ts.';
