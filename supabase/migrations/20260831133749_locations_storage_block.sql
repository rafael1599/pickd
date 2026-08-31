-- locations.storage_block: the physical block of 3+ adjacent rows a ROW belongs to.
--
-- Why: AS400 admits ONE location per SKU (and no sublocation letter). Inside a
-- block only the edge rows touch a hall, so a SKU spread across its rows
-- (31 A / 32 C / 33 D) is one physical place to a person walking the floor —
-- the sync report cites one row of the block with the SKU's total in it.
-- Two rows side by side stay regular (NULL): both face a hall, and stock split
-- across them is genuinely two places (Rafael, 31 Aug 2026).
--
-- Decided once, from the measured map (engine default layout: N-S rows, west
-- hall off). Bay 1 (ROW 41+) is not measured and gets no labels. ROW 35/36 do
-- not exist as locations today; if ROW 36 is ever created it belongs to
-- BLOCK 36-38.

alter table public.locations
  add column if not exists storage_block text;

comment on column public.locations.storage_block is
  'Physical block of 3+ adjacent rows this location belongs to (e.g. BLOCK 30-33). NULL = regular storage. The AS400 sync report collapses a SKU''s stock across one block into a single location. Set once from the measured warehouse map; change only when the floor is re-laid.';

update public.locations
set storage_block = b.label
from (
  values
    ('ROW 13', 'BLOCK 13-15'),
    ('ROW 14', 'BLOCK 13-15'),
    ('ROW 15', 'BLOCK 13-15'),
    ('ROW 20', 'BLOCK 20-22'),
    ('ROW 21', 'BLOCK 20-22'),
    ('ROW 22', 'BLOCK 20-22'),
    ('ROW 23', 'BLOCK 23-25'),
    ('ROW 24', 'BLOCK 23-25'),
    ('ROW 25', 'BLOCK 23-25'),
    ('ROW 26', 'BLOCK 26-29'),
    ('ROW 27', 'BLOCK 26-29'),
    ('ROW 28', 'BLOCK 26-29'),
    ('ROW 29', 'BLOCK 26-29'),
    ('ROW 30', 'BLOCK 30-33'),
    ('ROW 31', 'BLOCK 30-33'),
    ('ROW 32', 'BLOCK 30-33'),
    ('ROW 33', 'BLOCK 30-33'),
    ('ROW 36', 'BLOCK 36-38'),
    ('ROW 37', 'BLOCK 36-38'),
    ('ROW 38', 'BLOCK 36-38')
) as b(location, label)
where locations.warehouse = 'LUDLOW'
  and locations.location = b.location;
