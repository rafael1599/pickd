-- Box dimensions re-measured on the floor, Aug 12-14 2026.
--
-- The new factories changed the carton sizes, so every value below replaces either
-- the trigger default (54 x 8 x 30) or the old junk column defaults (5 x 6), both of
-- which described a box nobody ever measured. Scope is the 16 models that shipped from
-- the new factories; Divide was done separately in an earlier pass.
--
-- Values are stored as the table declares them: length_in / width_in / height_in.
-- The floor sheet was written L x H x W, so the third number of each reading lands in
-- width_in, not height_in.
--
-- Six SKUs already carried plausible measurements entered by hand at some earlier point
-- (03-4607BL, 03-4611BK, 03-4612BK, 03-4619GN, 03-4632GY, 03-4814BK). The floor reading
-- wins for all six -- it is the most recent and was taken specifically to correct this.
-- 03-4632GY is the one worth remembering: the stored height was 35.5", the tape said 31".
--
-- Not included, deliberately:
--   03-4704GY / 03-4707GY  Renegade S3 54 and 61, returned to the factory, no stock left.
--   Locations              Seven SKUs sit somewhere other than the floor sheet says. Moving
--                          them with a plain UPDATE would skip inventory_logs and lose the
--                          movement, so relocation stays a UI action.

UPDATE sku_metadata AS m
SET length_in = v.len,
    height_in = v.hgt,
    width_in  = v.wid
FROM (VALUES
    -- Allegro A3 -- containers 3443N/3445N, Jul 15 + Aug 11
    ('03-4805RD', 53.75, 30.25, 8.00),
    ('03-4806BK', 53.75, 30.50, 8.00),
    ('03-4807RD', 54.00, 30.25, 8.25),
    ('03-4808BK', 54.00, 30.50, 8.00),
    ('03-4809RD', 54.75, 30.50, 8.25),
    ('03-4810BK', 54.75, 30.25, 8.00),
    ('03-4811RD', 54.50, 31.00, 8.00),
    ('03-4812BK', 54.75, 30.75, 8.00),
    ('03-4813RD', 55.25, 31.50, 8.00),
    ('03-4814BK', 55.25, 31.25, 8.00),

    -- Helix -- containers 7002N/7003N, Jul 2
    ('03-4634RD', 55.75, 30.00, 8.75),
    ('03-4635MN', 56.00, 30.00, 9.00),
    ('03-4637MN', 56.00, 30.00, 9.00),
    ('03-4638RD', 57.25, 30.25, 9.00),  -- re-measured; the 20.25" height was a typo for 30.25
    ('03-4639MN', 57.50, 30.00, 9.00),

    -- Komodo 29 -- container 4256N, Jul 29
    ('03-4582BL', 52.00, 31.50, 11.00),
    ('03-4583GY', 51.25, 31.25, 11.00),
    ('03-4585BL', 52.00, 31.50, 11.25),
    ('03-4586GY', 52.00, 31.50, 11.25),
    ('03-4588BL', 53.50, 32.50, 11.00),
    ('03-4589GY', 53.25, 32.50, 11.25),
    ('03-4591BL', 54.50, 32.50, 11.00),
    ('03-4592GY', 54.50, 31.50, 11.25),

    -- Faultline A1 V2 2026
    ('03-4614BK', 51.00, 31.50, 11.00),
    ('03-4615BK', 52.00, 31.50, 11.00),
    ('03-4616BK', 53.00, 31.50, 11.25),
    ('03-4617BK', 54.00, 32.50, 11.00),

    -- Faultline A2 V2 2026
    ('03-4618GN', 51.00, 31.75, 11.25),
    ('03-4619GN', 52.00, 31.50, 11.00),
    ('03-4620GN', 53.00, 32.00, 11.00),
    ('03-4621GN', 54.00, 32.50, 11.25),

    -- Highpoint V2 2026
    ('03-4627BR', 60.75, 31.00, 9.00),
    ('03-4628BR', 61.75, 31.00, 9.00),
    ('03-4630GY', 60.50, 31.00, 8.75),
    ('03-4631GY', 60.50, 31.00, 9.00),
    ('03-4632GY', 62.00, 31.00, 9.00),  -- stored height was 35.5"; the tape says 31"
    ('03-4633GY', 62.00, 31.00, 9.00),

    -- Defcon E1 2026
    ('03-4606BL', 55.00, 34.00, 12.00),
    ('03-4607BL', 55.75, 34.00, 12.25),
    ('03-4608BL', 57.00, 34.00, 12.00),  -- sheet read 54" height, impossible; its siblings are 34"
    ('03-4609BL', 57.50, 34.00, 12.50),  -- width corrected from an impossible 1.25"

    -- Defcon E2 2026
    ('03-4610BK', 55.00, 34.00, 12.00),
    ('03-4611BK', 55.75, 34.00, 12.25),
    ('03-4612BK', 57.00, 34.00, 12.50),
    ('03-4613BK', 58.00, 33.75, 12.25),

    -- Renegade
    ('03-4266BK', 56.00, 30.00, 8.00),
    ('03-4267GN', 56.00, 30.00, 8.00),
    ('03-4691GY', 55.00, 30.00, 8.00),
    ('03-4692GY', 56.00, 30.00, 8.00),
    ('03-4693GY', 57.25, 30.25, 8.00),
    ('03-4694GY', 58.00, 31.00, 8.00),
    ('03-4695GY', 59.50, 31.00, 8.00),

    -- DXT A3.  The 23" ships in two cartons depending on origin: Taiwan 59 x 33 x 9 and
    -- China 58 x 33 x 9.  Only one row exists per SKU, so Taiwan is stored, matching the
    -- call already made for the Divide 14" step-over.
    ('03-3868BL', 56.75, 31.50, 9.00),
    ('03-3870BL', 57.00, 31.50, 8.50),
    ('03-3872BL', 59.00, 33.00, 9.00)
) AS v(sku, len, hgt, wid)
WHERE m.sku = v.sku;

-- 03-4267GN carried both colourways in one string because nobody had resolved which it was.
-- Checked on the floor at ROW 6 (C): it is Mash.
UPDATE inventory
SET item_name = 'RENEGADE A1 LTD 48 2025 MASH'
WHERE sku = '03-4267GN'
  AND item_name = 'RENEGADE A1 LTD 48 2025 BLACK PEARL | RENEGADE A1 LTD 48 2025 MASH';
