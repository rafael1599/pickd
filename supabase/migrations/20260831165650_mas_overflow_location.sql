-- MAS: the floor of the south main hall, where the map's plan parks what has
-- no square left (Rafael, 31 Aug 2026: "cuando no haya espacio el extra va en
-- pasillo main hall south llamándolo MAS").
--
-- It already existed as `MAIN HALL`, created for the same purpose and never
-- used: 0 rows in inventory, inventory_logs, daily_inventory_snapshots and
-- asset_tags on 31 Aug 2026, so this rename touches no denormalized history
-- (unlike 20260731180000 / 20260814020000, which had to rewrite five tables).
--
-- It is an aisle, not a shelf, so it never counts as warehouse space:
-- `counts_as_storage = false`, like INCOMING and the BAY* staging areas.
-- `picking_order` stays NULL: nothing is picked from the hall on purpose.

update public.locations
set location = 'MAS',
    counts_as_storage = false,
    is_active = true
where warehouse = 'LUDLOW'
  and upper(trim(location)) = 'MAIN HALL';

-- A clone site (or a rerun after the rename) gets the row it needs.
insert into public.locations (warehouse, location, zone, is_active, counts_as_storage)
select 'LUDLOW', 'MAS', 'UNASSIGNED', true, false
where not exists (
  select 1 from public.locations
  where warehouse = 'LUDLOW' and upper(trim(location)) = 'MAS'
);

comment on column public.locations.counts_as_storage is
  'Does this location''s capacity count as warehouse space? false for shipping, staging, cages, containers and aisles (MAS).';
