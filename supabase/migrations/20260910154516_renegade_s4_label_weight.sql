-- ============================================================================
-- Renegade S4: the carton label's weight instead of the 45 lb default.
--
-- Rafael, 10 Sep 2026: "arregla el peso". The five Renegade S4 SKUs in the
-- catalog (four Copper Tone from container 7004N, the Blue Smoke in ROW 37)
-- carried the trigger's 45 lb, which is what Ship totals for Audit Source.
-- The photo on 03-4710BL (photos/03-4710BL.webp) is the carton label:
-- N.W. 12.00 KG, G.W. 17.00 KG. Gross is what ships, and 17 kg lands on
-- 37.5 lb -- the same tenth kgToLbs stores when somebody types 17 kg on the
-- Measure screen.
--
-- The label is the 54's, and the flag says so:
--   - 54 (03-4710BL, and 03-4710BR, its colour twin -- "las cajas de los
--     modelos que solo cambian por color pesan lo mismo"): a reading of that
--     carton. The trigger marks weight_verified, as for any changed weight.
--   - 48 / 51 / 61: other frames ("la talla si importa y cambia el tamaño de
--     la caja"); weighed models in the catalog move 0-5 lb between sizes.
--     37.5 is the estimate it is -- nearer than 45 for what Ship adds up --
--     so it is written, but weight_verified stays false and a scale still
--     gets asked. set_dimensions_verified is off for that one statement only,
--     inside this transaction, so no other session ever sees it disabled.
-- Guarded on the default: a row somebody has weighed since is left alone.
-- ============================================================================

UPDATE sku_metadata
SET weight_lbs = 37.5
WHERE sku IN ('03-4710BL', '03-4710BR')
  AND weight_lbs = 45
  AND NOT coalesce(weight_verified, false);

ALTER TABLE sku_metadata DISABLE TRIGGER tr_sku_metadata_dimensions_verified;

UPDATE sku_metadata
SET weight_lbs = 37.5
WHERE sku IN ('03-4708BR', '03-4709BR', '03-4713BR')
  AND weight_lbs = 45
  AND NOT coalesce(weight_verified, false);

ALTER TABLE sku_metadata ENABLE TRIGGER tr_sku_metadata_dimensions_verified;
