-- Model and size for every bike SKU that carries a real box measurement.
--
-- The export to FedEx Ship Manager groups sizes of one model that share a carton
-- into a single record. That grouping needs model and size as separate values,
-- and the catalog never had them: `model` and `size` were added for Scratch &
-- Dent (20260417100000) and only wired into registration on 2026-07-17
-- (20260717200000_register_new_sku_structured_fields). Everything registered
-- before that kept the whole item name in `model` -- "DXT A3 19 BLUE",
-- "DURANGO A2 21 2025 THUNDER GREY" -- with `size` left NULL.
--
-- Consequence, measured before this ran: of the 172 bike SKUs with real
-- measurements only 64 had a usable size, so grouping produced 159 records of
-- which 149 were singletons. Nothing merged, because no two rows shared a model
-- string. With this backfill the same input produces 125 records, 16 of them
-- covering more than one size.
--
-- Where each split came from:
--   64  already had a clean size in the catalog
--   71  from karine-box-sizes.csv, the floor sheet behind 20260814120000
--   60  derived from the item name, reviewed row by row on 2026-08-20
--   (23 SKUs appear in both of the first two)
--
-- Scope is deliberately the measured SKUs only. The 531 bike SKUs still sitting
-- on trigger defaults are untouched: they are excluded from the export anyway,
-- and splitting a name is only worth doing where the number behind it is real.
--
-- Sizes are stored bare and uppercase -- 17, L16, 27.5X14, 51. The '' inch marks
-- and the inches-versus-centimetres call belong to the export renderer, because
-- the same column has to hold a 17" frame and a 51 cm road size.

BEGIN;

-- 1. The split itself.
UPDATE sku_metadata AS m
SET model = v.model,
    size  = v.size
FROM (VALUES
    ('01-0513', 'EXPLORER A2', '19'),
    ('03-2540WH', 'EXPLORER S/O', '18'),
    ('03-3058CL', 'EXPLORER A2', '15'),
    ('03-3060CL', 'EXPLORER A2', '17'),
    ('03-3062CL', 'EXPLORER A2', '19'),
    ('03-3382BK', 'DXT A2', '15'),
    ('03-3502BL', 'HUDSON', '19'),
    ('03-3516BL', 'EXPLORER A2', '15'),
    ('03-3604BL', 'HUDSON E2', '27.5X19'),
    ('03-3606BL', 'HUDSON E2 S/T', '27.5X14'),
    ('03-3607GY', 'HUDSON E2 S/T', '27.5X14'),
    ('03-3726RD', 'DURANGO A1', '21'),
    ('03-3731GY', 'DURANGO A2', '17'),
    ('03-3732BL', 'DURANGO A2', '19'),
    ('03-3733GY', 'DURANGO A2', '19'),
    ('03-3734BL', 'DURANGO A2', '21'),
    ('03-3735GY', 'DURANGO A2', '21'),
    ('03-3738BK', 'TRAIL X A1', '15'),
    ('03-3746GY', 'TRAIL X A2', '13'),
    ('03-3769BL', 'DIVIDE S/O', '14'),
    ('03-3769BLD', 'DIVIDE S/O', '14X27'),
    ('03-3781BL', 'VENTURA A1', '51'),
    ('03-3789BL', 'VENTURA A1', 'L54'),
    ('03-3810GN', 'RENEGADE C1', '58'),
    ('03-3828GY', 'RENEGADE S3', '58'),
    ('03-3854GY', 'DXT A1', '19'),
    ('03-3861BK', 'DXT A2', '17'),
    ('03-3868BL', 'DXT A3', '15'),
    ('03-3869BL', 'DXT A3', '17'),
    ('03-3870BL', 'DXT A3', '19'),
    ('03-3871BL', 'DXT A3', '21'),
    ('03-3872BL', 'DXT A3', '23'),
    ('03-3873BL', 'DXT A3 S/O', '14'),
    ('03-3882BK', 'ALLEGRO A1 W', '700CX16'),
    ('03-3885BK', 'ALLEGRO A2', '15'),
    ('03-3895BL', 'ALLEGRO A2', 'L16'),
    ('03-3905BL', 'ALLEGRO A3', '23'),
    ('03-3906GY', 'ALLEGRO A3', '23'),
    ('03-3908GY', 'ALLEGRO A3 S/O', '14'),
    ('03-3927BK', 'CODA S2', '21'),
    ('03-3934MN', 'CODA S2', 'L16'),
    ('03-3966BL', 'CITIZEN 3', NULL),
    ('03-3993PD', 'CITIZEN 1', '15'),
    ('03-3995PD', 'CITIZEN 1', '17'),
    ('03-3997PD', 'CITIZEN 1', '19'),
    ('03-3999PD', 'CITIZEN 1', '21'),
    ('03-4046MN', 'HUDSON S/T', '14'),
    ('03-4059PD', 'EXPLORER A1 S/T', '27.5X14'),
    ('03-4075BL', 'EXPLORER A2 S/T', '16'),
    ('03-4207BR', 'RENEGADE C3 GRX', '61'),
    ('03-4209GY', 'RENEGADE C4 APEX AXS', '51'),
    ('03-4211GY', 'RENEGADE C4 APEX AXS', '56'),
    ('03-4213GY', 'RENEGADE C4 APEX AXS', '61'),
    ('03-4227BL', 'RENEGADE C1 RED AXS', '51'),
    ('03-4230BL', 'RENEGADE C1 RED AXS', '58'),
    ('03-4231BL', 'RENEGADE C1 RED AXS', '61'),
    ('03-4251BK', 'VENTURA A2', '51'),
    ('03-4257BL', 'VENTURA A2', 'L48'),
    ('03-4259BL', 'VENTURA A2', 'L54'),
    ('03-4266BK', 'RENEGADE A1 LTD', '48'),
    ('03-4267GN', 'RENEGADE A1 LTD', '48'),
    ('03-4268BK', 'RENEGADE A1 LTD', '51'),
    ('03-4270BK', 'RENEGADE A1 LTD', '54'),
    ('03-4272BK', 'RENEGADE A1 LTD', '56'),
    ('03-4276BK', 'RENEGADE A1 LTD', '61'),
    ('03-4277GN', 'RENEGADE A1 LTD', '61'),
    ('03-4369BL', 'HIGHPOINT A1', '15'),
    ('03-4370BL', 'HIGHPOINT A1', '17'),
    ('03-4371BL', 'HIGHPOINT A1', '19'),
    ('03-4372BL', 'HIGHPOINT A1', '21'),
    ('03-4448BK', 'RENEGADE C1 RED AXS 13S', '56'),
    ('03-4450BK', 'RENEGADE C1 RED AXS 13S', '61'),
    ('03-4456BL', 'RENEGADE C2 GRX', '61'),
    ('03-4457GN', 'RENEGADE C3 APEX EAGLE AXS', '48'),
    ('03-4458GN', 'RENEGADE C3 APEX EAGLE AXS', '51'),
    ('03-4460GN', 'RENEGADE C3 APEX EAGLE AXS', '56'),
    ('03-4461GN', 'RENEGADE C3 APEX EAGLE AXS', '58'),
    ('03-4462GN', 'RENEGADE C3 APEX EAGLE AXS', '61'),
    ('03-4466BR', 'RENEGADE C4 GRX', '56'),
    ('03-4467BR', 'RENEGADE C4 GRX', '58'),
    ('03-4468BR', 'RENEGADE C4 GRX', '61'),
    ('03-4512GY', 'DXT A2', '17'),
    ('03-4515GY', 'DXT A2', '23'),
    ('03-4536BL', 'ALLEGRO A2', '15'),
    ('03-4545MN', 'ALLEGRO A2', 'L14'),
    ('03-4582BL', 'KOMODO 29', '15'),
    ('03-4583GY', 'KOMODO 29', '15'),
    ('03-4585BL', 'KOMODO 29', '17'),
    ('03-4586GY', 'KOMODO 29', '17'),
    ('03-4588BL', 'KOMODO 29', '19'),
    ('03-4589GY', 'KOMODO 29', '19'),
    ('03-4591BL', 'KOMODO 29', '21'),
    ('03-4592GY', 'KOMODO 29', '21'),
    ('03-4606BL', 'DEFCON E1', '15'),
    ('03-4607BL', 'DEFCON E1', '17'),
    ('03-4608BL', 'DEFCON E1', '19'),
    ('03-4609BL', 'DEFCON E1', '21'),
    ('03-4610BK', 'DEFCON E2', '15'),
    ('03-4611BK', 'DEFCON E2', '17'),
    ('03-4612BK', 'DEFCON E2', '19'),
    ('03-4613BK', 'DEFCON E2', '21'),
    ('03-4614BK', 'FAULTLINE A1 V2', '15'),
    ('03-4615BK', 'FAULTLINE A1 V2', '17'),
    ('03-4616BK', 'FAULTLINE A1 V2', '19'),
    ('03-4617BK', 'FAULTLINE A1 V2', '21'),
    ('03-4618GN', 'FAULTLINE A2 V2', '15'),
    ('03-4619GN', 'FAULTLINE A2 V2', '17'),
    ('03-4620GN', 'FAULTLINE A2 V2', '19'),
    ('03-4621GN', 'FAULTLINE A2 V2', '21'),
    ('03-4623BL', 'FAULTLINE A3 V2', '17'),
    ('03-4626BR', 'HIGHPOINT A1 V2', '15'),
    ('03-4627BR', 'HIGHPOINT A1 V2', '17'),
    ('03-4628BR', 'HIGHPOINT A1 V2', '19'),
    ('03-4629BR', 'HIGHPOINT A1 V2', '21'),
    ('03-4630GY', 'HIGHPOINT A2 V2', '15'),
    ('03-4631GY', 'HIGHPOINT A2 V2', '17'),
    ('03-4632GY', 'HIGHPOINT A2 V2', '19'),
    ('03-4633GY', 'HIGHPOINT A2 V2', '21'),
    ('03-4634RD', 'HELIX', '14'),
    ('03-4635MN', 'HELIX', '14'),
    ('03-4637MN', 'HELIX', '16'),
    ('03-4638RD', 'HELIX', '18'),
    ('03-4639MN', 'HELIX', '18'),
    ('03-4664BR', 'DIVIDE', '15'),
    ('03-4664YL', 'DIVIDE', '15'),
    ('03-4665GN', 'DIVIDE', '15'),
    ('03-4691GY', 'RENEGADE S1', '51'),
    ('03-4692GY', 'RENEGADE S1', '54'),
    ('03-4693GY', 'RENEGADE S1', '56'),
    ('03-4694GY', 'RENEGADE S1', '58'),
    ('03-4695GY', 'RENEGADE S1', '61'),
    ('03-4805RD', 'ALLEGRO A3', '15'),
    ('03-4806BK', 'ALLEGRO A3', '15'),
    ('03-4807RD', 'ALLEGRO A3', '17'),
    ('03-4808BK', 'ALLEGRO A3', '17'),
    ('03-4809RD', 'ALLEGRO A3', '19'),
    ('03-4810BK', 'ALLEGRO A3', '19'),
    ('03-4811RD', 'ALLEGRO A3', '21'),
    ('03-4812BK', 'ALLEGRO A3', '21'),
    ('03-4813RD', 'ALLEGRO A3', '23'),
    ('03-4814BK', 'ALLEGRO A3', '23'),
    ('03-4889GY', 'HUDSON S/T', '14'),
    ('06-4293MG', 'TAXI', '10X20'),
    ('06-4297RD', 'TAXI 24', 'L15'),
    ('06-4430RB', 'BC7 S/O', '18'),
    ('06-4432BK', 'BC7', '17'),
    ('06-4448WH', 'BCCV S/O', '26X18'),
    ('06-4450BL', 'BCCB', '17'),
    ('06-4451BK', 'BCCB', '17'),
    ('06-4453BL', 'BCCB', '19'),
    ('06-4455SL', 'BCCB', '19'),
    ('06-4456BL', 'BCCB', '21'),
    ('06-4473TL', 'EC3', '21'),
    ('06-4507BK', 'TAXI', '24'),
    ('06-4562BL', 'BC7', '17'),
    ('06-4565BL', 'BC7', '23'),
    ('06-4566VL', 'BCCB S/O', '14'),
    ('06-4572GY', 'EC1', '18'),
    ('06-4573GY', 'EC1', '21'),
    ('06-4590BL', 'TAXI 26', '21'),
    ('06-4606OR', 'BC7', '21'),
    ('06-4608MN', 'EC3 S/T', '15'),
    ('06-4614GN', 'EC1', '18'),
    ('06-4615GN', 'EC1', '21'),
    ('06-4617RD', 'EC2', '21'),
    ('06-4641BK', 'EC2', '18'),
    ('07-3529BL', 'JAMIS HOT ROD', NULL),
    ('07-3674GY', 'JUV XR.26', '13'),
    ('09-4827CL', 'RENEGADE S1 UDH FRAMEKIT', '54'),
    ('09-4828CL', 'RENEGADE S1 UDH FRAMEKIT', '56'),
    ('09-4829CL', 'RENEGADE S1 UDH FRAMEKIT', '58')
) AS v(sku, model, size)
WHERE m.sku = v.sku;

-- 2. 03-4046MN stored width_in = 875, a lost decimal for 8.75. Its 2026 sibling
--    03-4889GY measures 8.75 and every HUDSON S/T sits in that band. Left alone
--    it would have shipped an 875-inch carton to FedEx: the value is three
--    characters, so the field-length check passes it through.
UPDATE sku_metadata SET width_in = 8.75 WHERE sku = '03-4046MN' AND width_in = 875;

-- 3. Picking-note text leaked into `model` on 14 rows -- "ALLEGRO A1 23 THUNDER
--    GREY | Auto-cancel verification timeout | auto-restore on cancel". Two of
--    them are in the export set and would have carried that sentence into a
--    FedEx description. The names left behind are still whole item names rather
--    than clean models, but those SKUs are on default dimensions and stay out of
--    the export; this only removes the note. The write path that appends it is a
--    separate bug and is NOT fixed here.
UPDATE sku_metadata
SET model = btrim(split_part(model, ' | ', 1))
WHERE model LIKE '% | %';

-- 4. 07-3606GP is measured (56 x 9.75 x 37.5, a plausible carton) but its item
--    name is the single letter "P". A record with no model cannot produce a
--    description, so the name is cleared rather than guessed at: the export
--    skips rows with a NULL model and reports them as measured-but-unidentified,
--    which is the state it is actually in.
UPDATE sku_metadata SET model = NULL, size = NULL WHERE sku = '07-3606GP' AND model = 'P';

COMMIT;
