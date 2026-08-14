-- Three Highpoint A1 corrections, following the box re-measure of 20260814120000.
--
-- 03-4371BL held a length of 54.85" while the other three sizes of the same 2025 Ink run
-- read 58.3, 59.1 and 60.62 -- a 19" frame cannot ship in a shorter carton than the 15".
-- Re-measured on the floor rather than interpolated, so this is a reading, not a guess.
--
-- 03-4626BR and 03-4629BR are the 15" and 21" of the same 2026 V2 Putty run whose 17" and
-- 19" were measured in the previous migration. Their stored width of 8.7" comes from an
-- older pass that used a different convention across the whole family; the current pass
-- reads 9" on every Highpoint carton. Only the width is corrected here -- their lengths
-- and heights are left as found, so 31.5"/31.9" still sits against the 31" measured on
-- the 17" and 19". That gap is unresolved and wants a tape on the two boxes.

UPDATE sku_metadata
SET length_in = 60, height_in = 32, width_in = 8.5
WHERE sku = '03-4371BL';

UPDATE sku_metadata
SET width_in = 9
WHERE sku IN ('03-4626BR', '03-4629BR');
