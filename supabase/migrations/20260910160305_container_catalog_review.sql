-- ============================================================================
-- Every bike that came in on a container since June, read line by line.
--
-- Rafael, 10 Sep 2026: "revisa todos los items de los últimos containers para
-- ver si ahora sí están bien sus modelos, color, año, etc". 13 intakes, 114
-- SKUs (7004N back to the Florida container of 1 Jun). What was wrong, by kind:
--
--   1. The 2025 Florida container was never split. Its rows carry the old
--      pattern -- 'TRAIL X A2 17 NILE' in `model`, size NULL, 'BLUE' in
--      `color` -- which makes every size a FedEx group of one: TRAIL X A2 19
--      NILE BLUE (43 units) cannot use the carton measured on its Monterey
--      Grey twin. Same for DXT A1, DXT A3 S/O and TAXI TRIKE. Siblings of the
--      same family outside the container list (03-3747BL, 03-3750GY,
--      03-3856GY, 03-3869BL, 03-3871BL) had the same split and are fixed with
--      them. Colours cut to their last word (SMOKE for BLUE SMOKE, GREY for
--      MONTEREY GREY, Blue for RIPTIDE / SEAFOAM, Black for Matte Black) take
--      the whole colour the name and the sheet carry.
--   2. The 2026 Lasers were registered as 'Laser 1.6' / 'Laser 2.0' while
--      the catalog -- and AS400, the naming authority (idea-154) -- writes
--      'JUV LASER 1.6' / 'JUV LASER 2.0'. Two spellings are two FedEx records
--      for one carton (1.6: 37x18x8 against 37x17x8, inside the export's
--      one-inch tolerance).
--   3. Colour twins weigh the same (Rafael, 9 Sep). Where one colour of a
--      model+size from the same container was weighed and its twins still
--      carry the 45 lb default, the twins take the reading -- Ship adds that
--      number up for Audit Source, and the 704 new Lasers were 45 lb each
--      against 28.6 / 32.1 on the scale.
--   4. Card names (inventory.item_name) broken on rows with stock: two names
--      joined with ' | ', or the colour word appended twice ('OXBLOOD Red').
--      Six of these are outside the containers; same defect, same fix. Plus
--      the visible zero-stock rows of container SKUs that search still shows
--      ('sanity test', '17', '').
--
-- Two decisions taken on a default, from the evidence on the rows:
--   - 03-4865GY: `size` says 17, the name says Hudson E1 19 Dakota Grey. The
--     family is numbered in colour pairs (4866/4867 S/O 14, 4868/4869 S/O 18)
--     and 03-4864BL is the Midnight Blue 19, so 4865 is its Dakota Grey twin.
--   - 06-4735BK TAXI 26 S/O: the sheet says 18 and every other TAXI 26 S/O row
--     is 18; with the size blank, its measurement covered nothing.
--
-- Year: there is no column for it and none is added. The 2025 containers carry
-- it in the card name; the 2026 sheets never had one. AS400's model_year lands
-- in sku_metadata.as400_snapshot once the watchdog reads (0 of 2197 today).
--
-- Left alone, on purpose: DIVIDE writes 2026 sizes as '15' / '17' / '19' and
-- 2025 ones as '15X27' / '19X29', and the two must not merge -- the 2026 19
-- carton measures 63 x 32 x 9 against 61 x 31 x 8.55. The legacy TAXI 26
-- rows with "17 COSMO BLUE" in `model` are not container stock and still wait
-- for the TAXI decision in 20260909205906.
--
-- Every write below is guarded on the exact values it replaces: a row fixed by
-- hand since is left alone, and a second run is a no-op.
-- ============================================================================

-- ── 1) Model / size / colour ───────────────────────────────────────────────
UPDATE sku_metadata AS m
SET model = v.new_model,
    size  = v.new_size,
    color = v.new_color
FROM (VALUES
    -- sku,          old model,                 old size, old colour,  model,        size,  colour
    ('03-3746GY', 'TRAIL X A2',              '13',   'GREY',      'TRAIL X A2', '13',  'MONTEREY GREY'),
    ('03-3747BL', 'TRAIL X A2 13 NILE',      NULL,   'BLUE',      'TRAIL X A2', '13',  'NILE BLUE'),
    ('03-3750GY', 'TRAIL X A2 17 MONTEREY',  NULL,   'GREY',      'TRAIL X A2', '17',  'MONTEREY GREY'),
    ('03-3751BL', 'TRAIL X A2 17 NILE',      NULL,   'BLUE',      'TRAIL X A2', '17',  'NILE BLUE'),
    ('03-3752GY', 'TRAIL X A2 19 MONTEREY',  NULL,   'GREY',      'TRAIL X A2', '19',  'MONTEREY GREY'),
    ('03-3753BL', 'TRAIL X A2 19 NILE',      NULL,   'BLUE',      'TRAIL X A2', '19',  'NILE BLUE'),
    ('03-3754GY', 'TRAIL X A2 21 MONTEREY',  NULL,   'GREY',      'TRAIL X A2', '21',  'MONTEREY GREY'),
    ('03-3755BL', 'TRAIL X A2 21 NILE',      NULL,   'BLUE',      'TRAIL X A2', '21',  'NILE BLUE'),
    ('03-3852GY', 'DXT A1 15 MONTEREY',      NULL,   'GREY',      'DXT A1',     '15',  'MONTEREY GREY'),
    ('03-3853GY', 'DXT A1 17 MONTEREY GREY', NULL,   'GREY',      'DXT A1',     '17',  'MONTEREY GREY'),
    ('03-3854GY', 'DXT A1',                  '19',   'GREY',      'DXT A1',     '19',  'MONTEREY GREY'),
    ('03-3855GY', 'DXT A1 21 MONTEREY',      NULL,   'GREY',      'DXT A1',     '21',  'MONTEREY GREY'),
    ('03-3856GY', 'DXT A1 23 MONTEREY',      NULL,   'GREY',      'DXT A1',     '23',  'MONTEREY GREY'),
    ('03-3868BL', 'DXT A3',                  '15',   'SMOKE',     'DXT A3',     '15',  'BLUE SMOKE'),
    ('03-3869BL', 'DXT A3',                  '17',   'SMOKE',     'DXT A3',     '17',  'BLUE SMOKE'),
    ('03-3870BL', 'DXT A3',                  '19',   'SMOKE',     'DXT A3',     '19',  'BLUE SMOKE'),
    ('03-3871BL', 'DXT A3',                  '21',   'SMOKE',     'DXT A3',     '21',  'BLUE SMOKE'),
    ('03-3872BL', 'DXT A3',                  '23',   'SMOKE',     'DXT A3',     '23',  'BLUE SMOKE'),
    ('03-3873BL', 'DXT A3 S/O',              '14',   'Blue',      'DXT A3 S/O', '14',  'SEAFOAM'),
    ('03-3875BL', 'DXT A3 S/O 20 SEAFOAM',   NULL,   'Blue',      'DXT A3 S/O', '20',  'SEAFOAM'),
    ('06-4653BL', 'TAXI TRIKE MIDNIGHT',     NULL,   'BLUE',      'TAXI TRIKE', NULL,  'MIDNIGHT BLUE'),
    ('06-4654PU', 'TAXI TRIKE ORCHARD',      NULL,   'Purple',    'TAXI TRIKE', NULL,  'ORCHARD'),
    ('06-4655YL', 'TAXI TRIKE YELLOW CAB',   NULL,   'Yellow',    'TAXI TRIKE', NULL,  'YELLOW CAB'),
    ('03-3769BL', 'DIVIDE S/O',              '14',   'Blue',      'DIVIDE S/O', '14',  'RIPTIDE'),
    ('03-4806BK', 'ALLEGRO A3',              '15',   'Black',     'ALLEGRO A3', '15',  'Matte Black'),
    ('03-4808BK', 'ALLEGRO A3',              '17',   'Black',     'ALLEGRO A3', '17',  'Matte Black'),
    ('03-4810BK', 'ALLEGRO A3',              '19',   'Black',     'ALLEGRO A3', '19',  'Matte Black'),
    ('03-4812BK', 'ALLEGRO A3',              '21',   'Black',     'ALLEGRO A3', '21',  'Matte Black'),
    ('06-4735BK', 'TAXI 26 S/O',             NULL,   'Gloss Black', 'TAXI 26 S/O', '18', 'Gloss Black'),
    ('03-4865GY', NULL,                      '17',   NULL,        'HUDSON E1',  '19',  'Dakota Grey'),
    ('07-3741RD', 'Laser 1.6',               NULL,   'Crimson',      'JUV LASER 1.6', NULL, 'Crimson'),
    ('07-3742BK', 'Laser 1.6',               NULL,   'Gloss Black',  'JUV LASER 1.6', NULL, 'Gloss Black'),
    ('07-3743PK', 'Laser 1.6',               NULL,   'Popstar Pink', 'JUV LASER 1.6', NULL, 'Popstar Pink'),
    ('07-3744BL', 'Laser 2.0',               NULL,   'Royal Blue',   'JUV LASER 2.0', NULL, 'Royal Blue'),
    ('07-3745WH', 'Laser 2.0',               NULL,   'Pure White',   'JUV LASER 2.0', NULL, 'Pure White'),
    ('07-3746PU', 'Laser 2.0',               NULL,   'Velvet Lilac', 'JUV LASER 2.0', NULL, 'Velvet Lilac')
) AS v(sku, old_model, old_size, old_color, new_model, new_size, new_color)
WHERE m.sku = v.sku
  AND m.model IS NOT DISTINCT FROM v.old_model
  AND m.size  IS NOT DISTINCT FROM v.old_size
  AND m.color IS NOT DISTINCT FROM v.old_color;

-- ── 3) Colour twins take the weighed twin's reading ────────────────────────
-- A changed weight is marked weight_verified by the trigger, as for the
-- Renegade S4 54 twin in 20260910154516. Same model + size, same container.
UPDATE sku_metadata AS m
SET weight_lbs = v.lbs
FROM (VALUES
    ('07-3741RD', 28.6),  -- JUV LASER 1.6, weighed on 07-3743PK
    ('07-3742BK', 28.6),
    ('07-3744BL', 32.1),  -- JUV LASER 2.0, weighed on 07-3746PU
    ('07-3745WH', 32.1),
    ('03-3750GY', 40.8),  -- TRAIL X A2 17, weighed on 03-3751BL
    ('03-3753BL', 41.4),  -- TRAIL X A2 19, weighed on 03-3752GY
    ('06-4653BL', 70.5),  -- TAXI TRIKE, weighed on 06-4652BK
    ('06-4654PU', 70.5),
    ('06-4655YL', 70.5)
) AS v(sku, lbs)
WHERE m.sku = v.sku
  AND m.weight_lbs = 45
  AND NOT coalesce(m.weight_verified, false);

-- ── 4) Card names ──────────────────────────────────────────────────────────
UPDATE inventory AS i
SET item_name = v.new_name
FROM (VALUES
    -- with stock
    ('03-3755BL', 'ROW 5',    'TRAIL X A2 21 NILE BLUE | TRAIL X A2 21 2025 NILE BLUE', 'TRAIL X A2 21 2025 NILE BLUE'),
    ('03-3768BL', 'REBOX',    'DIVIDE S/O 12X27 2025 RIPTIDE Blue',     'DIVIDE S/O 12X27 2025 RIPTIDE'),
    ('03-3777RD', 'ROW 33',   'DIVIDE 19X29 2025 OXBLOOD Red',          'DIVIDE 19X29 2025 OXBLOOD'),
    ('03-3778BK', 'ROW 9',    'DIVIDE 21X29 2025 GLOSS BLACK Black',    'DIVIDE 21X29 2025 GLOSS BLACK'),
    ('03-4806BK', 'ROW 7',    'ALLEGRO A3 15 Black',                    'Allegro A3 15 Matte Black'),
    ('03-4810BK', 'ROW 4',    'ALLEGRO A3 19 Black',                    'Allegro A3 19 Matte Black'),
    ('03-4812BK', 'ROW 4',    'ALLEGRO A3 21 Black',                    'Allegro A3 21 Matte Black'),
    -- with stock, outside the containers
    ('03-3373CL', 'ROW 20',   'Sequel S3 | SEQUEL S3',                  'SEQUEL S3'),
    ('03-3373CL', 'ROW 33',   'Sequel S3 | SEQUEL S3',                  'SEQUEL S3'),
    ('03-3731GY', 'ROW 1',    'DURANGO A2 17 2025 THUNDER GREY Grey',   'DURANGO A2 17 2025 THUNDER GREY'),
    ('03-3842BL', 'ROW 22',   'SEQUEL S2 15 2025 RIPTIDE Blue',         'SEQUEL S2 15 2025 RIPTIDE'),
    ('03-3845BL', 'ROW 38',   'SEQUEL S2 21 2025 RIPTIDE Blue',         'SEQUEL S2 21 2025 RIPTIDE'),
    ('03-3851BL', 'ROW 26',   'SEQUEL S3 23 2025 MIDNIGHT BLUE Blue',   'SEQUEL S3 23 2025 MIDNIGHT BLUE'),
    ('03-4037BK', 'ROW 26',   'HUDSON 19 GLOSS BLACK Black',            'HUDSON 19 GLOSS BLACK'),
    -- zero stock, still shown by search
    ('03-4664BR', 'INCOMING', 'sanity test',                            'Divide 15 Milk Chocolate'),
    ('03-4865GY', 'ROW 13',   '17',                                     'Hudson E1 19 Dakota Grey'),
    ('03-4636RD', 'ROW 12',   'Helix 16" Pomodoro | Helix 16 Pomodoro', 'Helix 16 Pomodoro'),
    ('03-4667BR', 'ROW 13',   'Divide 19" Milk Chocolate | Divide 19 Milk Chocolate', 'Divide 19 Milk Chocolate'),
    ('03-4638RD', 'ROW 13',   '',                                       'Helix 18 Pomodoro'),
    ('03-3768BL', 'ROW 41',   '',                                       'DIVIDE S/O 12X27 2025 RIPTIDE')
) AS v(sku, location, old_name, new_name)
WHERE i.sku = v.sku
  AND i.warehouse = 'LUDLOW'
  AND i.location = v.location
  AND i.item_name = v.old_name;
