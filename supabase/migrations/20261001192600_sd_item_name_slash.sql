-- An S/D unit's name ends in "S/D", not "SD" (Rafael, 1 Oct 2026: "cambia la
-- regla para como se ven y se imprimen sd … de sd a S/D"). Same rule as
-- 20260930150819 — the full name first, any S/D / SD / S.D. elsewhere removed,
-- the mark once at the very end — only the mark changes. The label prints
-- item_name, so the printed label follows.
--
-- strip_sd_item_name already recognises all three spellings and is unchanged;
-- the triggers call sd_item_name, so redefining it is the whole switch.

create or replace function public.sd_item_name(p_name text)
returns text
language sql
immutable
as $$
  select case
    when nullif(public.strip_sd_item_name(p_name), '') is null then p_name
    else public.strip_sd_item_name(p_name) || ' S/D'
  end
$$;

do $$
begin
  assert public.sd_item_name('S/D XENITH SL 2014 54cm BLACK') = 'XENITH SL 2014 54cm BLACK S/D';
  assert public.sd_item_name('Hudson St SD 14" Blue Lagoon') = 'Hudson St 14" Blue Lagoon S/D';
  assert public.sd_item_name('Coda S2 21" Gloss Black SD') = 'Coda S2 21" Gloss Black S/D';
  assert public.sd_item_name('Coda S2 21" Gloss Black S/D') = 'Coda S2 21" Gloss Black S/D';
  assert public.sd_item_name('Allegro A3 sd 17"') = 'Allegro A3 17" S/D';
  assert public.sd_item_name('SDX 700 SDI') = 'SDX 700 SDI S/D';
  assert public.sd_item_name('') = '';
  assert public.sd_item_name('SD') = 'SD';
  assert public.sd_item_name(null) is null;
  assert public.strip_sd_item_name('Hudson 19" Sandstone S/D') = 'Hudson 19" Sandstone';
end $$;

-- Every S/D there is today: the trailing "SD" becomes "S/D".
update public.inventory i
   set item_name = public.sd_item_name(i.item_name)
  from public.sku_metadata m
 where m.sku = i.sku
   and m.is_scratch_dent
   and i.item_name is distinct from public.sd_item_name(i.item_name);
