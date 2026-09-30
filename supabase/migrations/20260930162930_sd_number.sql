-- Every S/D gets a number, #1, #2, … (Rafael, 30 Sep 2026): the first time its
-- label is printed, in the order the print job lists it. The number sticks to
-- the SKU and every reprint prints it again. Numbering starts today, by print;
-- nothing is backfilled.
--
-- One number per SKU, never reused: a S/D that is sold or unmarked keeps it, so
-- re-marking it prints the same one. Gaps are fine (a PDF opened and never
-- printed still used its number). A S/D is one bike per SKU; if a SKU ever holds
-- more units, they all share its number.

create sequence if not exists public.sd_number_seq start 1;

alter table public.sku_metadata add column if not exists sd_number integer;

create unique index if not exists sku_metadata_sd_number_key
  on public.sku_metadata (sd_number) where sd_number is not null;

comment on column public.sku_metadata.sd_number is
  'S/D number printed next to the label (#n). Given by assign_sd_numbers on the first print, never changed.';

-- Once given, a number does not move. The only way to change one is a deliberate
-- repair that says so: set_config('pickd.sd_number_repair','on',true).
create or replace function public.protect_sd_number()
returns trigger
language plpgsql
as $$
begin
  if old.sd_number is not null
     and new.sd_number is distinct from old.sd_number
     and coalesce(current_setting('pickd.sd_number_repair', true), '') <> 'on' then
    raise exception 'sd_number % of % cannot change', old.sd_number, old.sku
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists tr_sku_metadata_protect_sd_number on public.sku_metadata;
create trigger tr_sku_metadata_protect_sd_number
  before update of sd_number on public.sku_metadata
  for each row execute function public.protect_sd_number();

-- Numbers the S/D SKUs of a print job that have none yet, in the order given,
-- and returns the number of every S/D SKU in the job (new or old). Non-S/D SKUs
-- come back without a row. Two people printing at once cannot get the same
-- number: the row lock makes the second UPDATE see the first one's number.
create or replace function public.assign_sd_numbers(p_skus text[])
returns table (sku text, sd_number integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sku text;
begin
  if auth.uid() is null and current_user not in ('postgres', 'service_role') then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  foreach v_sku in array coalesce(p_skus, '{}') loop
    update public.sku_metadata m
       set sd_number = nextval('public.sd_number_seq')
     where m.sku = v_sku
       and m.is_scratch_dent
       and m.sd_number is null;
  end loop;

  return query
    select m.sku, m.sd_number
      from public.sku_metadata m
     where m.sku = any (coalesce(p_skus, '{}'))
       and m.is_scratch_dent
       and m.sd_number is not null;
end;
$$;

revoke all on function public.assign_sd_numbers(text[]) from public;
grant execute on function public.assign_sd_numbers(text[]) to authenticated, service_role;
