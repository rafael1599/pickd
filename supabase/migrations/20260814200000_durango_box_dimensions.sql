-- Durango A1 and A2 cartons, measured on the floor 14 Aug 2026.
--
-- Durango was held out of the new-factory re-measure because inventory_logs showed no
-- receipt for any of its SKUs. That was an artefact of the window, not a fact about the
-- stock: the log begins 14 Feb 2026 and these SKUs were registered 19 Jan and 8 Feb, with
-- their inventory rows created on the 17th. The shipment landed just before logging
-- existed, so the arrival was never recorded. Confirmed on the floor as new-factory goods.
--
-- All fourteen Durango SKUs had been sitting on trigger defaults: the ten 03-37xx on
-- 54 x 8 x 30 and the four 01-04xx singles on 55 x 8.5 x 30.5, every one of them at the
-- 45 lb bike default. Not one had ever been measured, despite several of the rows being
-- written more than once -- someone saved the form without entering a dimension.
--
-- The six below are the SKUs that still hold stock, 282 units between them. Four sizes
-- (03-3724RD, 03-3727BK, 03-3729GY, 03-3730BL) are at zero and stay on defaults, since
-- there is no box on the floor to put a tape on.

UPDATE sku_metadata AS m
SET length_in = v.len,
    height_in = v.hgt,
    width_in  = v.wid
FROM (VALUES
    ('03-3726RD', 61.50, 31.75, 8.75),  -- Durango A1 21 Garnet Red,   ROW 29
    ('03-3731GY', 59.00, 31.00, 8.75),  -- Durango A2 17 Thunder Grey, ROW 1
    ('03-3732BL', 60.50, 31.00, 9.00),  -- Durango A2 19 Midnight Blue, ROW 1
    ('03-3733GY', 60.50, 31.00, 9.00),  -- Durango A2 19 Thunder Grey, ROW 9
    ('03-3734BL', 61.00, 31.00, 9.00),  -- Durango A2 21 Midnight Blue, ROW 8
    ('03-3735GY', 61.00, 31.00, 8.75)   -- Durango A2 21 Thunder Grey, ROW 42
) AS v(sku, len, hgt, wid)
WHERE m.sku = v.sku;
