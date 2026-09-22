-- Siembra en sku_metadata.upc los 21 pares UPC->SKU que hoy viven hardcodeados
-- en KNOWN_UPC_CATALOG (src/features/recognition/liveSession/upcCatalogResolver.ts).
--
-- Backlog #137 punto 3 (docs/label-recognition/05-upc-el-cuello-de-botella.md):
-- esos pares eran la semilla de 0 ms de /live-check y vivían solo en el código
-- fuente. Pasarlos a la DB los hace visibles fuera de esa pantalla (el label
-- generator, cualquier búsqueda por UPC) sin quitar el fallback en memoria.
--
-- Verificado contra prod (22 sep 2026) antes de escribir: de los 21 SKUs, 11
-- ya tenían este mismo UPC guardado (aprendido por la app en el uso) y 10
-- estaban en NULL. Ninguno tenía un UPC DISTINTO -- no hay conflicto que
-- resolver a mano.
--
-- Mismo contrato que persistSkuUpcMapping(): solo rellena upc IS NULL, nunca
-- pisa un valor existente. Match por sku_key (columna generada, canónica) para
-- no depender de la grafía exacta.
UPDATE sku_metadata AS sm
SET upc = v.upc
FROM (VALUES
  ('034005MN', '845436088143'), -- CITIZEN 1 STEP-THRU Sugar Mint
  ('034000BL', '845436088099'), -- CITIZEN 1 23 Deep Blue
  ('064638BK', '845436089331'), -- EARTH CRUISER 3 Gloss Black
  ('034270BK', '845436092959'), -- RENEGADE A1 LTD Black Pearl
  ('033868BL', '845436086774'), -- DXT A3 Blue Smoke 15"
  ('033869BL', '845436086781'), -- DXT A3 Blue Smoke 17"
  ('033870BL', '845436086798'), -- DXT A3 Blue Smoke 19"
  ('033871BL', '845436086804'), -- DXT A3 Blue Smoke 21"
  ('094807CL', '845436091679'), -- RENEGADE S1 FRAMEKIT Charcoal
  ('034149BR', '845436091594'), -- RENEGADE S2 Copper Tone
  ('094796CL', '845436089485'), -- RENEGADE S1 FRAMEKIT Charcoal 56
  ('033845BL', '845436086545'), -- SEQUEL S2 Riptide
  ('033970BL', '845436087757'), -- CITIZEN 3 ST Navy Pearl
  ('033849BK', '845436086583'), -- SEQUEL S3
  ('034153BR', '845436091631'), -- RENEGADE S2
  ('073692BL', '845436082769'), -- LASER 1.6 Deep Blue
  ('033919GN', '845436092157'), -- CODA S1 FEMME Misty Green
  ('033855GY', '845436086644'), -- DXT A1 Monterey Grey
  ('033858BL', '845436086651'), -- DXT A1 Deep Blue
  ('034869MN', '845436098432'), -- HUDSON E1
  ('073743PK', '845438006710')  -- LASER 20
) AS v(sku_key, upc)
WHERE sm.sku_key = v.sku_key
  AND sm.upc IS NULL;
