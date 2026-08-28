-- A plan on the warehouse map: where each line should go, drawn before it
-- moves (idea-173, PRD docs/prds/warehouse-map-plan-and-live.md, P1).
--
-- One draft per zone, in the database so everyone sees the same ghosts —
-- the old zone page kept its plan in one browser's localStorage and nobody
-- else could see it. A plan is a list of moves over live stock; PLAN
-- COMPLETED executes them through the app's own mutations (updateItem for
-- a letter change inside the row, move_inventory_stock across rows), each
-- line revalidated first, and records what happened to each move here.
-- Nothing in these tables changes inventory by itself.

create table public.slot_plans (
  id uuid primary key default gen_random_uuid(),
  zone_id text not null,
  warehouse text not null default 'LUDLOW',
  status text not null default 'draft' check (status in ('draft', 'executed', 'discarded')),
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  executed_by uuid,
  executed_at timestamptz
);

comment on table public.slot_plans is
  'A drawn arrangement of a map zone: moves over live stock, executed by PLAN COMPLETED. One draft per zone.';

create unique index slot_plans_one_draft_per_zone
  on public.slot_plans (zone_id)
  where status = 'draft';

create trigger tr_slot_plans_updated_at
  before update on public.slot_plans
  for each row execute function public.update_updated_at_column();

create table public.slot_plan_moves (
  id bigserial primary key,
  plan_id uuid not null references public.slot_plans (id) on delete cascade,
  position integer not null,
  inventory_id bigint not null,
  sku text not null,
  qty integer not null,
  item_name text,
  warehouse text not null,
  from_location text not null,
  from_sublocation text[],
  to_location text not null,
  to_sublocation text[] not null,
  -- relabel = same row, only the letter changes (updateItem, EDIT log);
  -- move = another row (move_inventory_stock, MOVE log).
  kind text not null check (kind in ('relabel', 'move')),
  status text not null default 'planned' check (status in ('planned', 'done', 'skipped', 'failed')),
  executed_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  unique (plan_id, inventory_id)
);

comment on table public.slot_plan_moves is
  'One line of a slot plan: an inventory row and the square it should go to. status/error say what PLAN COMPLETED did with it.';

create index slot_plan_moves_plan_idx on public.slot_plan_moves (plan_id, position);

alter table public.slot_plans enable row level security;
alter table public.slot_plan_moves enable row level security;

-- Anyone signed in plans and executes; a plan nobody wants is discarded,
-- not deleted, so the audit stays.
create policy "signed-in read slot plans" on public.slot_plans
  for select to authenticated using (true);
create policy "signed-in write slot plans" on public.slot_plans
  for insert to authenticated with check (true);
create policy "signed-in update slot plans" on public.slot_plans
  for update to authenticated using (true) with check (true);

create policy "signed-in read slot plan moves" on public.slot_plan_moves
  for select to authenticated using (true);
create policy "signed-in write slot plan moves" on public.slot_plan_moves
  for insert to authenticated with check (true);
create policy "signed-in update slot plan moves" on public.slot_plan_moves
  for update to authenticated using (true) with check (true);
create policy "signed-in remove planned moves" on public.slot_plan_moves
  for delete to authenticated using (status = 'planned');
