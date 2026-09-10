-- ============================================================================
-- Frames and frame kits are parts, not bikes.
--
-- Rafael, 10 Sep 2026: "los frames son partes, marcalos como tal". Twelve
-- catalog rows -- every one in a cage, 53 units -- were is_bike = true: the
-- 03- prefix made the insert trigger call four Portal C2 frames bikes, and the
-- 09- frame kits and 00-0000 were registered that way by hand. So they swelled
-- the bike totals, the ">= 5 bikes -> Regular" rule, the measuring queue and
-- the Double Check carton banner as if each were a bike in a box.
--
-- An explicit list, not a name pattern: "frame" in a name is how these were
-- found (the detector), and every row below was read before it went in -- the
-- same rule this project keeps for location-as-bike ("Detector, no regla").
-- is_bike is only derived on INSERT when NULL, so an explicit false stays.
--
-- Known consequences, on purpose:
--   - The FedEx Dimensions export reads is_bike = true, so the four measured
--     ones (03-3666BL, 09-4827CL/28CL/29CL) leave the next file, and Replace
--     removes their records from FSM.
--   - 18 completed orders carry is_bike = true stamped in their items; that is
--     what they were when they shipped and stays. No open order names a frame.
-- ============================================================================

UPDATE sku_metadata
SET is_bike = false
WHERE is_bike
  AND sku IN (
    '00-0000',    -- Faultline A1 Frame 29" MD/17 Sandstorm
    '03-3666BL',  -- Portal C2 frame 29" SM
    '03-3667BL',  -- Portal C2 frame
    '03-3668BL',  -- Portal C2 frame
    '03-3669BL',  -- Portal C2 frame 29" XL
    '09-4802BK',  -- Frame Renegade C1 56 2024 gloss black
    '09-4827CL',  -- Renegade S1 UDH framekit 54 Charcoal
    '09-4828CL',  -- Renegade S1 UDH framekit 56 Charcoal
    '09-4829CL',  -- Renegade S1 UDH framekit 58 Charcoal
    '09-4830CL',  -- Renegade S1 UDH framekit 700c x 61cm
    '09-4841BK',  -- Renegade C1 frame kit 700c x 54cm
    '09-4847BK'   -- Renegade S1 frame kit 700c x 54
  );
