-- Who decided a move: the operator's hand, or the plan's own arithmetic.
--
-- Rafael, 31 Aug 2026: "quiero que los movimientos que se hacen a un sku
-- queden fijos a menos que yo lo vuelva a mover". The repair passes were
-- rewriting his drops whenever anything else changed, because the plan had no
-- way to tell his intent from its own suggestions.
--
-- `hand` is a hard constraint — the passes plan AROUND it, they never remove
-- or re-aim it; only another gesture of his does. `auto` (DISTRIBUTE and the
-- repair passes) is the only thing they may rewrite. It is the same rule as
-- Siebel's "Lock Assignment" (the optimizer cannot change it, the person can)
-- and Dynamics' booking lock (locked bookings stay IN the optimized schedule).
--
-- Default `auto` so anything written by an older client is still the plan's to
-- tidy; the rows already in a DRAFT plan are set to `hand`, because they are
-- what the operator is looking at right now and nothing should rewrite them
-- behind his back.

alter table public.slot_plan_moves
  add column if not exists origin text not null default 'auto'
    check (origin in ('hand', 'auto'));

comment on column public.slot_plan_moves.origin is
  'hand = the operator dropped it and it is fixed until he moves it again; auto = DISTRIBUTE or a repair pass, the only kind the plan may rewrite.';

update public.slot_plan_moves m
set origin = 'hand'
from public.slot_plans p
where p.id = m.plan_id
  and p.status = 'draft'
  and m.status = 'planned';
