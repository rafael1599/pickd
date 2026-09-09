-- ============================================================================
-- The one-line name, split: model / size / colour for the container catalog
--
-- `model` is the grouping key of the FedEx Dimensions export and half of the
-- key of the coverage rule (`utils/fedexCarton`), so a row whose model reads
-- "Divide 13 x 27.5 Smokey Green" is a group of one: it can never share a
-- carton record with the same bike in another colour, and it sends somebody to
-- measure a box that is already in the file.
--
-- 20260820160000 split the 171 SKUs that had a real measurement and left the
-- rest on purpose -- "no vale la pena partir un nombre cuyo numero no es real".
-- This is the other half of that job, scoped to what Rafael asked for on 9 sep
-- 2026: the juvenile catalog (07-) and everything that came in on a container
-- since June, plus two families where a measured colour was sitting one string
-- away from covering an unmeasured one:
--
--   03-3779RD  DIVIDE 21X29 Oxblood      113 units, covered by 03-3778BK
--   03-3984BL  CITIZEN 2 23 Monterey      84 units, covered by 03-3985GY
--
-- Every value below was read off `inventory.item_name`, which keeps the whole
-- line and is NOT touched here -- so the string this was derived from survives
-- and the split can be re-read or corrected against it.
--
-- Where the catalog already spelled a model, this follows that spelling rather
-- than a tidier one, because two spellings are two records for one carton:
-- DIVIDE S/O takes 12X27 from 03-3768BL and 14 from 03-3769BL (the two are
-- inconsistent with each other; that predates this and is left alone).
--
-- Checked against prod before applying: no group becomes a dimension_conflict,
-- and the export goes from 216 records to 208 -- eight pairs of colours that
-- were two records each are now one, which is the merge the export exists for.
--
-- NOT touched, because the row cannot be read honestly and a wrong guess lands
-- in the FedEx grouping key:
--   03-4865GY  item_name says "Hudson E1 19", the size column says 17
--   07-3606GP  item_name is the single letter "P"; measured 56 x 37.5 x 9.75
--   07-3682BK  no item_name at all
--   the TAXI 26 / TAXI 24 family, where frame and wheel are written three
--   different ways ("TAXI 26" size 21, "TAXI 26 17 GLOSS BLACK", "TAXI 24"
--   size L15) and one measurement would cover four colours once it is settled
-- ============================================================================

UPDATE sku_metadata AS m
SET model = v.model,
    size  = v.size,
    -- The colour is overwritten, not filled in. What is on these rows now was
    -- derived from the two letters at the end of the SKU when they were
    -- registered -- 'Blue' for a Monterey Blue, 'Red' for an Oxblood, 'Teal'
    -- for a Radiant Teal -- while the name carries the one on the box. The
    -- colour is display text and not part of any key, so the specific one wins.
    color = v.color
FROM (VALUES
    ('03-4663GN', 'DIVIDE', '13X27', 'Smokey Green'),
    ('03-4660YL', 'DIVIDE S/O', '12X27', 'Golden Pop'),
    ('03-4661PU', 'DIVIDE S/O', '14', 'Velvet Lilac'),
    ('03-4664YL', 'DIVIDE', '15', 'Golden Pop'),
    ('03-4665GN', 'DIVIDE', '15', 'Smokey Green'),
    ('03-4666BR', 'DIVIDE', '17', 'Milk Chocolate'),
    ('03-4667BR', 'DIVIDE', '19', 'Milk Chocolate'),
    ('03-3772BK', 'DIVIDE', '15X27', 'Gloss Black'),
    ('03-3773RD', 'DIVIDE', '15X27', 'Oxblood'),
    ('03-3779RD', 'DIVIDE', '21X29', 'Oxblood'),
    ('03-4814BK', 'ALLEGRO A3', '23', 'Matte Black'),
    ('03-4582BL', 'KOMODO 29', '15', 'Riptide'),
    ('03-4583GY', 'KOMODO 29', '15', 'Rhino'),
    ('03-4585BL', 'KOMODO 29', '17', 'Riptide'),
    ('03-4586GY', 'KOMODO 29', '17', 'Rhino'),
    ('03-4588BL', 'KOMODO 29', '19', 'Riptide'),
    ('03-4589GY', 'KOMODO 29', '19', 'Rhino'),
    ('03-4591BL', 'KOMODO 29', '21', 'Riptide'),
    ('03-4592GY', 'KOMODO 29', '21', 'Rhino'),
    ('03-4864BL', 'HUDSON E1', '19', 'Midnight Blue'),
    ('03-4866BL', 'HUDSON E1 S/O', '14', 'Midnight Blue'),
    ('03-4867MN', 'HUDSON E1 S/O', '14', 'Vanilla Mint'),
    ('03-4868BL', 'HUDSON E1 S/O', '18', 'Midnight Blue'),
    ('03-4869MN', 'HUDSON E1 S/O', '18', 'Vanilla Mint'),
    ('03-3976BL', 'CITIZEN 2', '15', 'Monterey Blue'),
    ('03-3977GY', 'CITIZEN 2', '15', 'Storm Grey'),
    ('03-3978BL', 'CITIZEN 2', '17', 'Monterey Blue'),
    ('03-3979GY', 'CITIZEN 2', '17', 'Storm Grey'),
    ('03-3980BL', 'CITIZEN 2', '19', 'Monterey Blue'),
    ('03-3981GY', 'CITIZEN 2', '19', 'Storm Grey'),
    ('03-3982BL', 'CITIZEN 2', '21', 'Monterey Blue'),
    ('03-3983GY', 'CITIZEN 2', '21', 'Storm Grey'),
    ('03-3984BL', 'CITIZEN 2', '23', 'Monterey Blue'),
    ('03-3985GY', 'CITIZEN 2', '23', 'Storm Grey'),
    ('03-3986TL', 'CITIZEN 2 S/T', '14', 'Radiant Teal'),
    ('03-3987GY', 'CITIZEN 2 S/T', '14', 'Storm Grey'),
    ('03-3988TL', 'CITIZEN 2 S/T', '16', 'Radiant Teal'),
    ('03-3989GY', 'CITIZEN 2 S/T', '16', 'Storm Grey'),
    ('03-3990TL', 'CITIZEN 2 S/T', '18', 'Radiant Teal'),
    ('03-4636RD', 'HELIX', '16', 'Pomodoro'),
    ('06-4731BK', 'TAXI 24 S/O', '15', 'Gloss Black'),
    ('06-4735BK', 'TAXI 26 S/O', NULL, 'Gloss Black'),
    ('07-3529BL', 'JAMIS HOT ROD', NULL, 'Radiant Blue'),
    ('07-3626BL', 'JUV LASER 2.0', NULL, 'Cosmo Blue'),
    ('07-3629RD', 'JUV LASER 1.6', NULL, 'Victory Red'),
    ('07-3639GR', 'JUV CRITTER 12', NULL, 'Ninja Green'),
    ('07-3641RD', 'JUV CRITTER 12', NULL, 'Victory Red'),
    ('07-3642VL', 'JUV CRITTER 12', NULL, 'Vivid Violet'),
    ('07-3663BL', 'JUV STARLITE', NULL, 'Blue Lagoon'),
    ('07-3664PK', 'JUV MISS DAISY', NULL, 'Hot Pink'),
    ('07-3671SG', 'JUV XR.26 S/O', '12', 'Sage'),
    ('07-3672SG', 'JUV XR.26 S/O', '14', 'Sage'),
    ('07-3673BK', 'JUV XR.26', '13', 'Gloss Black'),
    ('07-3674GY', 'JUV XR.26', '13', 'Smoke'),
    ('07-3680PD', 'JUV X.24 DISC', NULL, 'Palladium'),
    ('07-3684BL', 'JUV XR.24', NULL, 'Sky Blue'),
    ('07-3686BK', 'JUV XR.20', '10', 'Gloss Black'),
    ('07-3689WH', 'JUV CAPRI 2.4', NULL, 'Vanilla'),
    ('07-3690BL', 'JUV CAPRI 2.4', NULL, 'Sky Blue'),
    ('07-3692BL', 'JUV LASER 1.6', NULL, 'Deep Blue'),
    ('07-3697BK', 'JUV XR.20 SUSPENSION', NULL, 'Gloss Black'),
    ('07-3698GN', 'JUV XR.20 SUSPENSION', NULL, 'Limelight')
) AS v(sku, model, size, color)
WHERE m.sku = v.sku;
