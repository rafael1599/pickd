-- Whether a S/D can be sold (Rafael, 2 Oct 2026): "la marca de non sellable o
-- going to S/D … para saber si no es vendible, o no es vendible todavía hasta que
-- se marque como sellable". A notice for whoever reads the S/D Excel and the
-- Google Sheet, nothing more: it blocks no order and no move.
--
--   yes      For sale.
--   not_yet  Not for sale yet — waiting for someone to review it. Every bike that
--            becomes a S/D starts here (trigger below), so none is sold early.
--   no       Not for sale. "TODAS LAS XENITH SON NO (no se van a vender, aún están
--            en duda)" — the seven Xenith S/D start here.
--
-- Its own column on purpose: `condition` is the physical state (a bike can be
-- New · unbuilt and still not be for sale) and `sd_category` is the kind of S/D.
-- Null on a row that is not a S/D.
--
-- The sheet and the Excel show it as Yes / Not yet / No (sd_for_sale_label); the
-- sheet can change it, with the same rules as the other list columns.

alter table public.sku_metadata
  add column if not exists sd_for_sale text
  constraint sku_metadata_sd_for_sale_check check (sd_for_sale in ('yes', 'not_yet', 'no'));

comment on column public.sku_metadata.sd_for_sale is
  'S/D only: yes = for sale, not_yet = waiting for review (default when a SKU becomes S/D), no = not for sale. A notice; blocks nothing.';

create or replace function public.sd_for_sale_label(p_code text)
returns text
language sql
immutable
as $$
  select case p_code when 'yes' then 'Yes' when 'not_yet' then 'Not yet' when 'no' then 'No' end
$$;

create or replace function public.sd_for_sale_code(p_label text)
returns text
language sql
immutable
as $$
  select case lower(btrim(coalesce(p_label, '')))
    when 'yes' then 'yes' when 'not yet' then 'not_yet' when 'no' then 'no' end
$$;

-- A SKU that becomes S/D (or is born S/D) starts as "Not yet" unless the writer
-- says otherwise. Unmarking a S/D leaves the value: it is history, and it comes
-- back as it was if the SKU is marked again.
create or replace function public.sd_for_sale_default()
returns trigger
language plpgsql
as $$
begin
  if new.is_scratch_dent and new.sd_for_sale is null then
    new.sd_for_sale := 'not_yet';
  end if;
  return new;
end;
$$;

drop trigger if exists tr_sku_metadata_sd_for_sale_default on public.sku_metadata;
create trigger tr_sku_metadata_sd_for_sale_default
  before insert or update of is_scratch_dent, sd_for_sale on public.sku_metadata
  for each row execute function public.sd_for_sale_default();

-- The S/D that already exist were being sold: they keep doing so.
update public.sku_metadata set sd_for_sale = 'yes'
 where is_scratch_dent and sd_for_sale is null;

-- Every Xenith S/D (six bikes and one frame/fork, checked in prod on 2 Oct 2026).
-- The Xenith parts are not S/D and are left alone.
update public.sku_metadata set sd_for_sale = 'no'
 where is_scratch_dent
   and sku in ('01-2192', '01-0354', '01-0368XE', '01-0355', '01-OLD1', '01-0357XE', 'E19K01F0044');

-- And the ones Rafael named the same day ("AURORA ELITE, COMET, 01-0135, SPUTNIK,
-- DAKAR, 2004 ECLIPSE CARBON" → No): Aurora Elite #60, 01-0135 (Renegade Elite),
-- Sputnik #40, the three Dakar (01-0176, #24, #14) and Eclipse Carbon #13. COMET
-- is only stems in PickD (98-857x, parts), so there is no S/D to mark.
update public.sku_metadata set sd_for_sale = 'no'
 where is_scratch_dent
   and sku in ('M12035084', '01-0135', 'WE9H00107', '01-0176', 'H6K01013', 'WK5G00305', 'M4050191');

-- The sheet ----------------------------------------------------------------
-- Same as 20261002131210 plus 'For sale'. Lists copied from SdDetailsCard.tsx
-- (SD_CATEGORY_OPTIONS / SD_CONDITION_OPTIONS / SD_FOR_SALE_OPTIONS); if they
-- change there, change them here.

create or replace function public.sd_sheet_options()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'editable', jsonb_build_array('Category', 'Condition', 'For sale', 'Condition description', 'Serial', 'Internal note', 'PDF link'),
    'Category', jsonb_build_array('mountain', 'gravel', 'road', 'cruiser', 'urban', 'hybrid', 'kids', 'parts', 'other', '-'),
    'Condition', jsonb_build_array('new_unbuilt', 'new_built', 'ridden_demo', 'returned', 'defective_frame', '-'),
    'For sale', jsonb_build_array('Yes', 'Not yet', 'No')
  )
$$;

create or replace function public.sd_sheet_apply_edit(
  p_sku text, p_column text, p_old text, p_new text, p_editor text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_flag record;
  v_opts jsonb := public.sd_sheet_options();
  v_new text := btrim(coalesce(p_new, ''));
  v_old text := btrim(coalesce(p_old, ''));
  -- In the two lists, '-' is "none": the sheet shows it for an empty field and
  -- choosing it empties the field (a cleared cell still never writes).
  v_is_list boolean := p_column in ('Category', 'Condition');
  v_write text;
  v_current text;
  v_stored text;
  v_meta record;
  v_inv_id bigint;
  v_live int;
  v_reason text;
begin
  select enabled, config into v_flag from public.app_flags where key = 'sd_sheet_write';
  if not coalesce(v_flag.enabled, false) then
    v_reason := 'Editing from the sheet is turned off';
  elsif (select count(*) from public.sd_sheet_edits where created_at > now() - interval '1 minute')
        >= coalesce((v_flag.config->>'per_minute')::int, 30) then
    v_reason := 'Limit: 30 edits/min — try again in a minute';
  elsif (select count(*) from public.sd_sheet_edits where created_at > now() - interval '1 hour')
        >= coalesce((v_flag.config->>'per_hour')::int, 300) then
    v_reason := 'Limit: 300 edits/hour — change it in PickD';
  elsif not (v_opts->'editable') ? p_column then
    v_reason := 'Read-only column — change it in PickD';
  elsif v_new = '' then
    v_reason := 'A blank never writes — clear it in PickD';
  end if;

  if v_reason is null then
    select sku, category, condition, condition_description, serial_number, pdf_link, sd_for_sale
      into v_meta
      from public.sku_metadata
     where sku = p_sku and is_scratch_dent
       for update;
    if not found then
      v_reason := 'Not an S/D in PickD';
    else
      select count(*), min(id) into v_live, v_inv_id
        from public.inventory
       where sku = p_sku and warehouse = 'LUDLOW' and is_active and quantity > 0;
      if v_live = 0 then
        v_reason := 'Not in stock in PickD';
      elsif v_live > 1 and p_column = 'Internal note' then
        v_reason := 'On more than one shelf row — change the note in PickD';
      end if;
    end if;
  end if;

  if v_is_list and v_old = '-' then v_old := ''; end if;

  if v_reason is null then
    v_current := case p_column
      when 'Category' then v_meta.category
      when 'Condition' then v_meta.condition
      when 'For sale' then public.sd_for_sale_label(v_meta.sd_for_sale)
      when 'Condition description' then v_meta.condition_description
      when 'Serial' then v_meta.serial_number
      when 'PDF link' then v_meta.pdf_link
      when 'Internal note' then (select internal_note from public.inventory where id = v_inv_id)
    end;
    if p_column = 'For sale' then
      -- The sheet may say "not yet" or "NO": compare and validate by code.
      v_old := coalesce(public.sd_for_sale_label(public.sd_for_sale_code(v_old)), v_old);
      v_new := coalesce(public.sd_for_sale_label(public.sd_for_sale_code(v_new)), v_new);
    end if;
    if btrim(coalesce(v_current, '')) <> v_old then
      v_reason := 'PickD has a different value here (sheet out of order?) — wait a minute and retry';
    elsif p_column = 'Category' and not (v_opts->'Category') ? v_new then
      v_reason := 'Category must be one of the list';
    elsif p_column = 'Condition' and not (v_opts->'Condition') ? v_new then
      v_reason := 'Condition must be one of the list';
    elsif p_column = 'For sale' and not (v_opts->'For sale') ? v_new then
      v_reason := 'For sale must be Yes, Not yet or No';
    elsif p_column = 'Serial' and length(v_new) > 40 then
      v_reason := 'Serial: 40 characters max';
    elsif p_column = 'Serial' and exists (
      select 1 from public.sku_metadata
       where upper(btrim(serial_number)) = upper(v_new) and sku <> p_sku) then
      v_reason := 'That serial belongs to another SKU';
    elsif p_column in ('Condition description', 'Internal note', 'PDF link') and length(v_new) > 500 then
      v_reason := '500 characters max';
    elsif p_column = 'PDF link' and v_new !~* '^https://' then
      v_reason := 'PDF link must start with https://';
    end if;
  end if;

  if v_reason is not null then
    insert into public.sd_sheet_edits (sku, column_name, old_value, new_value, editor, applied, reason)
    values (coalesce(p_sku, ''), coalesce(p_column, ''), p_old, p_new, p_editor, false, v_reason);
    return jsonb_build_object('ok', false, 'reason', v_reason);
  end if;

  v_write := case when v_is_list and v_new = '-' then null else v_new end;
  if v_write is distinct from nullif(btrim(coalesce(v_current, '')), '') then
    case p_column
      when 'Category' then update public.sku_metadata set category = v_write where sku = p_sku;
      when 'Condition' then update public.sku_metadata set condition = v_write where sku = p_sku;
      when 'For sale' then
        update public.sku_metadata set sd_for_sale = public.sd_for_sale_code(v_new) where sku = p_sku;
      when 'Condition description' then
        update public.sku_metadata set condition_description = v_new where sku = p_sku;
      when 'Serial' then update public.sku_metadata set serial_number = v_new where sku = p_sku;
      when 'PDF link' then update public.sku_metadata set pdf_link = v_new where sku = p_sku;
      when 'Internal note' then update public.inventory set internal_note = v_new where id = v_inv_id;
    end case;
  end if;

  -- What PickD actually stored (a trigger may normalise it), so the cell shows it at once.
  v_stored := case p_column
    when 'Category' then (select category from public.sku_metadata where sku = p_sku)
    when 'Condition' then (select condition from public.sku_metadata where sku = p_sku)
    when 'For sale' then (select public.sd_for_sale_label(sd_for_sale) from public.sku_metadata where sku = p_sku)
    when 'Condition description' then (select condition_description from public.sku_metadata where sku = p_sku)
    when 'Serial' then (select serial_number from public.sku_metadata where sku = p_sku)
    when 'PDF link' then (select pdf_link from public.sku_metadata where sku = p_sku)
    when 'Internal note' then (select internal_note from public.inventory where id = v_inv_id)
  end;

  insert into public.sd_sheet_edits (sku, column_name, old_value, new_value, editor, applied)
  values (p_sku, p_column, v_current, v_stored, p_editor, true);
  return jsonb_build_object(
    'ok', true,
    'value', case when v_is_list then coalesce(nullif(v_stored, ''), '-') else coalesce(v_stored, '') end
  );
end;
$$;

-- Same as 20261002125302 plus 'For sale' (logged as its label, written back as its code).
create or replace function public.sd_sheet_revert(p_since timestamptz, p_apply boolean default false)
returns table (edit_id bigint, sku text, column_name text, set_back_to text, outcome text)
language plpgsql
security definer
set search_path = public
as $$
declare
  e record;
  v_now text;
  v_inv_id bigint;
  -- A preview walks the same newest-first order and remembers what each field
  -- would hold, so an older edit of the same field reads as revertible too.
  v_sim jsonb := '{}';
  v_key text;
begin
  for e in
    select * from public.sd_sheet_edits x
     where x.applied and x.reverted_at is null and x.created_at >= p_since
     order by x.created_at desc, x.id desc
  loop
    select min(id) into v_inv_id from public.inventory i
     where i.sku = e.sku and i.warehouse = 'LUDLOW' and i.is_active and i.quantity > 0;
    v_now := case e.column_name
      when 'Category' then (select m.category from public.sku_metadata m where m.sku = e.sku)
      when 'Condition' then (select m.condition from public.sku_metadata m where m.sku = e.sku)
      when 'For sale' then (select public.sd_for_sale_label(m.sd_for_sale) from public.sku_metadata m where m.sku = e.sku)
      when 'Condition description' then (select m.condition_description from public.sku_metadata m where m.sku = e.sku)
      when 'Serial' then (select m.serial_number from public.sku_metadata m where m.sku = e.sku)
      when 'PDF link' then (select m.pdf_link from public.sku_metadata m where m.sku = e.sku)
      when 'Internal note' then (select i.internal_note from public.inventory i where i.id = v_inv_id)
    end;
    v_key := e.sku || '|' || e.column_name;
    if v_sim ? v_key then v_now := v_sim->>v_key; end if;
    edit_id := e.id; sku := e.sku; column_name := e.column_name; set_back_to := e.old_value;
    if v_now is distinct from e.new_value then
      outcome := 'skipped: changed again since';
    elsif not p_apply then
      v_sim := v_sim || jsonb_build_object(v_key, e.old_value);
      outcome := 'would revert';
    else
      case e.column_name
        when 'Category' then update public.sku_metadata m set category = e.old_value where m.sku = e.sku;
        when 'Condition' then update public.sku_metadata m set condition = e.old_value where m.sku = e.sku;
        when 'For sale' then
          update public.sku_metadata m set sd_for_sale = public.sd_for_sale_code(e.old_value) where m.sku = e.sku;
        when 'Condition description' then
          update public.sku_metadata m set condition_description = e.old_value where m.sku = e.sku;
        when 'Serial' then update public.sku_metadata m set serial_number = e.old_value where m.sku = e.sku;
        when 'PDF link' then update public.sku_metadata m set pdf_link = e.old_value where m.sku = e.sku;
        when 'Internal note' then update public.inventory i set internal_note = e.old_value where i.id = v_inv_id;
      end case;
      update public.sd_sheet_edits x set reverted_at = now() where x.id = e.id;
      outcome := 'reverted';
    end if;
    return next;
  end loop;
end;
$$;

revoke all on function public.sd_sheet_apply_edit(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.sd_sheet_revert(timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.sd_sheet_apply_edit(text, text, text, text, text) to service_role;
grant execute on function public.sd_sheet_revert(timestamptz, boolean) to service_role;
