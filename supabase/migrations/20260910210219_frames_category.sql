-- ============================================================================
-- Frames carry category = 'frame', so the FedEx export can keep the measured
-- ones.
--
-- Rafael, 10 Sep 2026: "sí, incluye los cuadros medidos en el export". Since
-- 20260910155112 the twelve frames and frame kits are parts (is_bike = false),
-- and the Dimensions export reads is_bike = true -- so the four measured ones
-- (03-3666BL, 09-4827CL/28CL/29CL) were about to leave the next file, and
-- Replace would have deleted their records from FSM.
--
-- "A measured part" is not the rule: 67 parts are dimensions_verified, almost
-- all on the 55 x 30.5 x 8.5 bike default that the registration form used to
-- stamp as verified (fixed 25 Aug). Putting those in FSM would declare a
-- headset spacer as a bike box. So the export needs to know what a frame is,
-- and `category` -- the product category (hybrid, urban, mountain, ...) --
-- is where that fact already lives. The same explicit list as the migration
-- that made them parts; a frame registered from now on gets it by hand.
-- ============================================================================

UPDATE sku_metadata
SET category = 'frame'
WHERE category IS NULL
  AND NOT is_bike
  AND sku IN (
    '00-0000', '03-3666BL', '03-3667BL', '03-3668BL', '03-3669BL',
    '09-4802BK', '09-4827CL', '09-4828CL', '09-4829CL', '09-4830CL',
    '09-4841BK', '09-4847BK'
  );
