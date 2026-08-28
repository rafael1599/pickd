-- Bay 3 North (ROW 18–33, LUDLOW): one sublocation letter per square instead
-- of one per two squares.
--
-- Rafael, 28 Aug 2026, on seeing the measured map lay the stock over the
-- plan: "sublocations antes eran cada 2 cuadros una sublocation, ahora es
-- cada cuadro una sublocation; divídelo de modo que tenga un poco de
-- sentido, en el piso ya los iremos actualizando."
--
-- Old A covered squares 1–2 → new A / B; B → C / D; C → E / F; D → G / H;
-- E → I / J; F → K / L. Letters past F were already per-square — ROW 27–33
-- carried K at the far end — and are left exactly as they are.
--
-- "Un poco de sentido": within one row and one old letter, the live lines
-- are sorted by units and dealt alternately to the two new squares, largest
-- first, so neither square gets everything; a line spanning several old
-- letters spans all their new squares; a line with no stock (the ghost
-- trail) takes the first square of its pair. No quantity moves, no line is
-- split: the floor will put each line in its real square over time, and the
-- map lists what it cannot place instead of hiding it.
--
-- Every relabel is recorded in sublocation_relabels (append-only, admin
-- reads), old and new, so the floor's corrections can be compared with what
-- this rule guessed — and so it can be undone line by line if it has to be.

create table if not exists public.sublocation_relabels (
  id bigserial primary key,
  inventory_id bigint not null,
  sku text not null,
  warehouse text not null,
  location text not null,
  old_sublocation text[],
  new_sublocation text[],
  rule text not null,
  created_at timestamptz not null default now()
);

comment on table public.sublocation_relabels is
  'Every sublocation relabel done by rule rather than by hand, old and new. Append-only.';

alter table public.sublocation_relabels enable row level security;

drop policy if exists "admins read sublocation relabels" on public.sublocation_relabels;
create policy "admins read sublocation relabels"
  on public.sublocation_relabels for select
  to authenticated
  using (public.is_admin());

with scope as (
  select i.id, i.sku, i.warehouse, i.location, i.quantity, i.is_active, i.sublocation,
         cardinality(i.sublocation) = 1 as single
  from public.inventory i
  where i.warehouse = 'LUDLOW'
    and i.location ~ '^ROW (1[89]|2[0-9]|3[0-3])$'
    and i.sublocation is not null
),
-- Live single-letter lines, dealt alternately within (row, old letter):
-- rank 1 → first new square, 2 → second, 3 → first, …
ranked as (
  select id,
         row_number() over (
           partition by location, sublocation[1]
           order by quantity desc, sku, id
         ) as rn
  from scope
  where single and is_active and quantity > 0
    and sublocation[1] between 'A' and 'F'
),
mapped as (
  select s.id, array_agg(distinct m.l order by m.l) as new_sub
  from scope s
  left join ranked r on r.id = s.id
  cross join lateral unnest(s.sublocation) as old(letter)
  cross join lateral unnest(
    case
      when old.letter not between 'A' and 'F' then array[old.letter]
      when not s.single then array[
        chr(65 + (ascii(old.letter) - 65) * 2),
        chr(66 + (ascii(old.letter) - 65) * 2)
      ]
      when r.rn is null or r.rn % 2 = 1 then array[chr(65 + (ascii(old.letter) - 65) * 2)]
      else array[chr(66 + (ascii(old.letter) - 65) * 2)]
    end
  ) as m(l)
  group by s.id
),
changed as (
  select s.id, s.sku, s.warehouse, s.location, s.sublocation as old_sub, m.new_sub
  from scope s
  join mapped m on m.id = s.id
  where m.new_sub is distinct from s.sublocation
),
logged as (
  insert into public.sublocation_relabels
    (inventory_id, sku, warehouse, location, old_sublocation, new_sublocation, rule)
  select id, sku, warehouse, location, old_sub, new_sub, 'bay3-north-per-square-2026-08-28'
  from changed
  returning inventory_id
)
update public.inventory i
set sublocation = c.new_sub
from changed c
where i.id = c.id;
