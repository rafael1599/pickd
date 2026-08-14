-- Last four cartons of the new-factory re-measure, taken on the floor 14 Aug 2026.
-- These close DXT A3 and Renegade A1 LTD: both runs already had most of their sizes
-- measured in 20260814120000, and these are the siblings that never logged an ADD and
-- were held back until someone put a tape on them.
--
-- 03-3871BL ships from two origins, Taiwan 57.5 x 32.5 x 8.5 and China 58.5 x 32.75 x 9.
-- Taiwan is stored, the same call already made for the Divide 14" step-over and the
-- DXT A3 23". sku_metadata has one row per SKU and no origin column, so the China figure
-- lives only in the spreadsheet.

UPDATE sku_metadata AS m
SET length_in = v.len,
    height_in = v.hgt,
    width_in  = v.wid
FROM (VALUES
    ('03-3869BL', 56.00,  31.25, 8.75),  -- DXT A3 17 Blue Smoke
    ('03-3871BL', 57.50,  32.50, 8.50),  -- DXT A3 21 Blue Smoke, Taiwan carton
    ('03-4268BK', 56.00,  30.00, 8.00),  -- Renegade A1 LTD 51 Black Pearl
    ('03-4276BK', 57.75,  31.50, 8.00)   -- Renegade A1 LTD 61 Black Pearl
) AS v(sku, len, hgt, wid)
WHERE m.sku = v.sku;
