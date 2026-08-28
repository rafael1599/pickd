-- A line may need more than one move in a plan: DISTRIBUTE widens its span
-- inside its row (a relabel) and sends what still does not fit to buried
-- squares in another row (a move of just those units). The "one move per
-- line" of the first migration was the hand's rule, not the plan's; the app
-- still keeps one move per line for a hand drop.

alter table public.slot_plan_moves
  drop constraint if exists slot_plan_moves_plan_id_inventory_id_key;

create index if not exists slot_plan_moves_line_idx
  on public.slot_plan_moves (plan_id, inventory_id);
