-- An S/D unit's name ends in "SD" (Rafael, 30 Sep 2026: "SD debe ir al final en
-- el nombre completo"). The full name (model, size, colour, whatever else the
-- floor wrote) comes first; any "S/D" or "SD" it carried anywhere else goes.
--
-- Marking a SKU as S/D adds the suffix to all its shelf rows, unmarking takes it
-- off. Rewriting the name of an S/D row keeps it: the item form rebuilds the name
-- from model/size/colour, writes inventory and metadata without waiting for each
-- other, and the S/D intake marks the SKU before its shelf row exists — a trigger
-- on the marking alone would lose the suffix on all three paths.

create or replace function public.strip_sd_item_name(p_name text)
returns text
language sql
immutable
as $$
  select case
    when p_name is null then null
    else btrim(regexp_replace(
      regexp_replace(p_name, '(^|\s)(S/D|SD|S\.D\.?)(?=\s|$)', ' ', 'gi'),
      '\s+', ' ', 'g'))
  end
$$;

create or replace function public.sd_item_name(p_name text)
returns text
language sql
immutable
as $$
  select case
    when nullif(public.strip_sd_item_name(p_name), '') is null then p_name
    else public.strip_sd_item_name(p_name) || ' SD'
  end
$$;

do $$
begin
  assert public.sd_item_name('S/D XENITH SL 2014 54cm BLACK') = 'XENITH SL 2014 54cm BLACK SD';
  assert public.sd_item_name('Hudson St SD 14" Blue Lagoon') = 'Hudson St 14" Blue Lagoon SD';
  assert public.sd_item_name('SD Renegade 56 cm Charcoal') = 'Renegade 56 cm Charcoal SD';
  assert public.sd_item_name('Coda S2 21" Gloss Black SD') = 'Coda S2 21" Gloss Black SD';
  assert public.sd_item_name('EXPLORER A1 ST 16 TEAL    Y22B010415') = 'EXPLORER A1 ST 16 TEAL Y22B010415 SD';
  assert public.sd_item_name('Allegro A3 sd 17"') = 'Allegro A3 17" SD';
  assert public.sd_item_name('SDX 700 SDI') = 'SDX 700 SDI SD';
  assert public.sd_item_name('') = '';
  assert public.sd_item_name('SD') = 'SD';
  assert public.sd_item_name(null) is null;
  assert public.strip_sd_item_name('Hudson 19" Sandstone SD') = 'Hudson 19" Sandstone';
end $$;

-- Shelf side: a name written for an S/D SKU keeps its suffix.
create or replace function public.keep_sd_item_name()
returns trigger
language plpgsql
as $$
begin
  if exists (select 1 from public.sku_metadata m where m.sku = new.sku and m.is_scratch_dent) then
    new.item_name := public.sd_item_name(new.item_name);
  end if;
  return new;
end;
$$;

drop trigger if exists tr_inventory_sd_item_name on public.inventory;
create trigger tr_inventory_sd_item_name
  before insert or update of item_name, sku on public.inventory
  for each row execute function public.keep_sd_item_name();

-- Catalogue side: marking adds the suffix to every shelf row, unmarking removes it.
create or replace function public.sync_sd_item_names()
returns trigger
language plpgsql
as $$
begin
  if new.is_scratch_dent and (tg_op = 'INSERT' or not old.is_scratch_dent) then
    update public.inventory i
       set item_name = public.sd_item_name(i.item_name)
     where i.sku = new.sku
       and i.item_name is distinct from public.sd_item_name(i.item_name);
  elsif tg_op = 'UPDATE' and old.is_scratch_dent and not new.is_scratch_dent then
    update public.inventory i
       set item_name = public.strip_sd_item_name(i.item_name)
     where i.sku = new.sku
       and i.item_name is distinct from public.strip_sd_item_name(i.item_name);
  end if;
  return null;
end;
$$;

drop trigger if exists tr_sku_metadata_sd_item_name on public.sku_metadata;
create trigger tr_sku_metadata_sd_item_name
  after insert or update of is_scratch_dent on public.sku_metadata
  for each row execute function public.sync_sd_item_names();

-- Every S/D there is today: "SD" moves from after the model to the very end.
update public.inventory i
   set item_name = public.sd_item_name(i.item_name)
  from public.sku_metadata m
 where m.sku = i.sku
   and m.is_scratch_dent
   and i.item_name is distinct from public.sd_item_name(i.item_name);
