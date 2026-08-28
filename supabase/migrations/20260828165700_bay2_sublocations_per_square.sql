-- Bay 2 (ROW 1–17, LUDLOW): one sublocation letter per square instead of one
-- per two squares — the same rule Bay 3 North got in 20260828161324, which
-- Rafael extended to Bay 2 the same day ("ok bay 2"). Bay 1 is NOT touched:
-- its usable floor has not been measured yet ("todo el que se ve no es el
-- real"), and the letters follow the floor.
--
-- Old A covered squares 1–2 → new A / B; B → C / D; C → E / F; D → G / H;
-- E → I / J; F → K / L. Letters past F (ROW 9 has H, ROW 16 has G) were
-- already per-square and stay. Within a row and an old letter the live lines
-- are dealt alternately to the two new squares, largest first; a line
-- spanning old letters spans their new squares; a line with no stock takes
-- the first square. No quantity moves. Every relabel is recorded in
-- sublocation_relabels, old and new.

with scope as (
  select i.id, i.sku, i.warehouse, i.location, i.quantity, i.is_active, i.sublocation,
         cardinality(i.sublocation) = 1 as single
  from public.inventory i
  where i.warehouse = 'LUDLOW'
    and i.location ~ '^ROW ([1-9]|1[0-7])$'
    and i.sublocation is not null
),
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
  select id, sku, warehouse, location, old_sub, new_sub, 'bay2-per-square-2026-08-28'
  from changed
  returning inventory_id
)
update public.inventory i
set sublocation = c.new_sub
from changed c
where i.id = c.id;
