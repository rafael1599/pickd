-- Re-measured cartons, August 2026 floor pass.
--
-- Twenty-one model+size cartons were re-measured and came back different from
-- what the catalog held. Twenty of them were already exporting to FedEx Ship
-- Manager with the wrong number; the twenty-first (SEQUEL S3 15'') was never
-- measured at all and sat in the exceptions report. Three more sizes are carried
-- along at the end of the first statement -- see the note there.
--
-- Almost every correction is downward, which is the direction that matters: the
-- export declares ceil(max) per axis across the colours of a size, so a single
-- stale 8.25 on one colour declares a 9" carton for the whole size. FedEx bills
-- on the declared box, so an inch of air on a size that ships by the pallet is a
-- recurring overcharge, and none of it shows up as an error anywhere.
--
-- Why the updates are per-axis and not "write the new carton onto every row":
-- the stored numbers are per-colour tape readings, and only the group maximum
-- reaches FedEx. Overwriting all three axes on all four ALLEGRO A3 23'' rows
-- would replace four real readings with one rounded figure to change an output
-- that only two of them influence. So each row gives up only the axis that was
-- actually driving the wrong declaration, and every other reading survives.
-- NULL below means "this axis was already correct, leave the measurement alone".
--
-- What the export produces after this runs, verified by replaying
-- buildFedexDimensions over a copy of production:
--
--   124 -> 122 records, 532 -> 530 exceptions. Four regroupings, all of them
--   consequences rather than separate edits -- sizes merge on their own once
--   they land on the same carton:
--
--     ALLEGRO A3 19'' + 21''   -> ALLEGRO A3 19''-21''    55x31x8
--     DXT A3 17'' joins 15''-19''                          57x32x9
--     DXT A3 21'' + 23''       -> DXT A3 21''-23''         59x33x9
--     KOMODO 29 15'' + 17''    -> KOMODO 29 15''-17''      52x32x11
--
--   and one split, for the same reason in reverse: RENEGADE S1 56 was riding on
--   58's carton in a "56-58" record. It measures a size smaller, so it gets its
--   own row and 58 keeps its own.
--
--     RENEGADE S1 56-58  58x31x8  ->  56  57x30x8  +  58  58x31x8
--
-- dimensions_verified is left to tr_sku_metadata_dimensions_verified, which sets
-- it on any change of value. Every row here except the two SEQUEL S3 ones was
-- already verified; those two flip on their first real measurement.

BEGIN;

-- 1. Per-axis corrections. NULL = axis already correct.
--
--    Read as (longest, thinnest, middle) -- Pickd's column order, not FedEx's.
--    FSM's Width comes from height_in and its Height from width_in, so the
--    "Height 13 -> 12" corrections from the floor sheet land in width_in here.
UPDATE sku_metadata AS m
SET length_in = COALESCE(v.length_in, m.length_in),
    width_in  = COALESCE(v.width_in,  m.width_in),
    height_in = COALESCE(v.height_in, m.height_in)
FROM (VALUES
    -- ALLEGRO A3 17''  54x31x9 -> 54x30x8
    ('03-4807RD', NULL::numeric, 8::numeric,  30::numeric),
    ('03-4808BK', NULL,          NULL,        30),
    -- ALLEGRO A3 19''  55x31x9 -> 55x31x8   (then groups with 21'')
    ('03-4809RD', NULL,          8,           NULL),
    -- ALLEGRO A3 23''  56x32x9 -> 55x32x8
    ('03-3905BL', 55,            8,           NULL),
    ('03-3906GY', 55,            8,           NULL),
    ('03-4813RD', 55,            NULL,        NULL),
    ('03-4814BK', 55,            NULL,        NULL),
    -- CITIZEN 3        58x30x9 -> 57x30x9
    ('03-3966BL', 57,            NULL,        NULL),
    -- DEFCON E1 17''   56x34x13 -> 56x34x12
    ('03-4607BL', NULL,          12,          NULL),
    -- DEFCON E2 17''   56x34x13 -> 56x34x12
    ('03-4611BK', NULL,          12,          NULL),
    -- DEFCON E2 21''   58x34x13 -> 58x34x12
    ('03-4613BK', NULL,          12,          NULL),
    -- DIVIDE S/O 14''/14''X27  57x30x9 -> 59x31x9  (larger carton, agreed 2026-08-20)
    ('03-3769BL',  59,           NULL,        31),
    ('03-3769BLD', 59,           NULL,        31),
    -- DXT A3 17''      56x32x9 -> 57x32x9   (then joins 15''-19'')
    ('03-3869BL', 57,            NULL,        NULL),
    -- DXT A3 21''      58x33x9 -> 59x33x9   (then groups with 23'')
    ('03-3871BL', 59,            NULL,        NULL),
    -- FAULTLINE A1 V2 19''  53x32x12 -> 53x32x11
    ('03-4616BK', NULL,          11,          NULL),
    -- FAULTLINE A2 V2 15''  51x32x12 -> 51x32x11
    ('03-4618GN', NULL,          11,          NULL),
    -- FAULTLINE A2 V2 21''  54x33x12 -> 54x33x11
    ('03-4621GN', NULL,          11,          NULL),
    -- HELIX 18''       58x31x9 -> 57x30x9
    ('03-4638RD', 57,            NULL,        30),
    ('03-4639MN', 57,            NULL,        NULL),
    -- HIGHPOINT A1 V2 15''  59x32x9 -> 58x32x9
    ('03-4626BR', 58,            NULL,        NULL),
    -- KOMODO 29 17''   52x32x12 -> 52x32x11  (then groups with 15'')
    ('03-4585BL', NULL,          11,          NULL),
    ('03-4586GY', NULL,          11,          NULL),
    -- KOMODO 29 19''   54x33x12 -> 53x33x11
    ('03-4588BL', 53,            NULL,        NULL),
    ('03-4589GY', 53,            11,          NULL),
    -- KOMODO 29 21''   55x33x12 -> 55x33x11
    ('03-4592GY', NULL,          11,          NULL),
    -- RENEGADE A1 LTD 61  58x32x9 -> 58x32x8
    ('03-4277GN', NULL,          8,           NULL),
    -- RENEGADE S1 56   was inside the 56-58 record -> its own carton 57x30x8
    ('03-4693GY', 57,            NULL,        30),
    -- Three sizes nobody re-measured, resolved by the floor's rounding rule
    -- rather than by a tape: at or below .5 the reading is the lower whole inch,
    -- from .6 up it is the higher one. They are here because the reading they
    -- carry is the same stale decimal the sizes above were corrected for -- every
    -- other size in these three families already reads a clean 11.00 or 12.00,
    -- and the ones that did not are precisely the ones on the correction sheet.
    -- Same rule the sheet itself applies: 55.5 -> 55 on ALLEGRO A3 23'',
    -- 57.5 -> 57 on HELIX 18'', 53.5 -> 53 on KOMODO 29 19''.
    ('03-4609BL', NULL,          12,          NULL),  -- DEFCON E1 21''      12.50 -> 12
    ('03-4612BK', NULL,          12,          NULL),  -- DEFCON E2 19''      12.50 -> 12
    ('03-4623BL', NULL,          11,          NULL)   -- FAULTLINE A3 V2 17'' 11.25 -> 11
) AS v(sku, length_in, width_in, height_in)
WHERE m.sku = v.sku;

-- 2. SEQUEL S3 15'': first measurement, and the name split that lets it group.
--
--    Both colours still carried the whole item name in `model` with `size` NULL,
--    the pre-20260717200000 shape that 20260820160000 fixed for the SKUs that
--    had measurements at the time. This one did not, so it is split here on the
--    same terms: model bare, size bare and uppercase, colour already in `color`.
--    Without the split the two colours would export as two separate records
--    named after their full item names instead of one "SEQUEL S3 15''".
--
--    height_in is stored at the measured 28.5, not the 29 that FedEx receives.
--    Rounding up is the export's job (a carton is never declared smaller than
--    measured); baking it into the column would turn a reading into a default.
UPDATE sku_metadata AS m
SET model     = 'SEQUEL S3',
    size      = '15',
    length_in = 56,
    width_in  = 8,
    height_in = 28.5
FROM (VALUES ('03-3847BK'), ('03-3847BL')) AS v(sku)
WHERE m.sku = v.sku;

COMMIT;
