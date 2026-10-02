-- The S/D Google Sheet can write back to PickD (Rafael, 2 Oct 2026), planned for
-- the worst case: "que borren todo el contenido, que desordenen el contenido con
-- filtros". The sheet itself stays a mirror (sd-sheet GET, every minute); this is
-- the narrow way in, and every rule lives here, not in Apps Script, because
-- anyone who can edit the sheet can read its script.
--
--   * One cell, one field. A pasted block, a cleared range or a deleted row never
--     arrives (Apps Script only sends single-cell edits). A blank never writes.
--   * Compare-and-set: each edit carries the value the cell had. If PickD holds
--     something else — a sorted or shifted sheet put that cell next to another
--     bike — the edit is refused instead of landing on the wrong SKU.
--   * Six columns only: Category, Condition (the app's lists), Condition
--     description, Serial (not another SKU's), Internal note, PDF link (https).
--   * 30 attempts a minute and 300 an hour for the whole sheet, refused or not.
--   * Every attempt is a row in sd_sheet_edits; sd_sheet_revert undoes what came
--     in since a given time. app_flags.sd_sheet_write is the off switch.

create table if not exists public.sd_sheet_edits (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  sku text not null,
  column_name text not null,
  old_value text,
  new_value text,
  editor text,
  applied boolean not null,
  reason text,
  reverted_at timestamptz
);
create index if not exists sd_sheet_edits_created_at on public.sd_sheet_edits (created_at desc);

alter table public.sd_sheet_edits enable row level security;
drop policy if exists sd_sheet_edits_admin_read on public.sd_sheet_edits;
create policy sd_sheet_edits_admin_read on public.sd_sheet_edits
  for select to authenticated using (public.is_admin());

insert into public.app_flags (key, enabled, config, note)
values (
  'sd_sheet_write', true, '{"per_minute": 30, "per_hour": 300}',
  'Google Sheet S&D bikes → PickD (sd_sheet_apply_edit). Off = the sheet is read-only.'
)
on conflict (key) do nothing;

-- The app's lists, copied from src/features/inventory/components/ItemDetailView/SdDetailsCard.tsx
-- (SD_CATEGORY_OPTIONS / SD_CONDITION_OPTIONS); if they change there, change them here.
create or replace function public.sd_sheet_options()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'editable', jsonb_build_array('Category', 'Condition', 'Condition description', 'Serial', 'Internal note', 'PDF link'),
    'Category', jsonb_build_array('mountain', 'gravel', 'road', 'cruiser', 'urban', 'hybrid', 'kids', 'parts', 'other'),
    'Condition', jsonb_build_array('new_unbuilt', 'new_built', 'ridden_demo', 'returned', 'defective_frame')
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
    select sku, category, condition, condition_description, serial_number, pdf_link
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

  if v_reason is null then
    v_current := case p_column
      when 'Category' then v_meta.category
      when 'Condition' then v_meta.condition
      when 'Condition description' then v_meta.condition_description
      when 'Serial' then v_meta.serial_number
      when 'PDF link' then v_meta.pdf_link
      when 'Internal note' then (select internal_note from public.inventory where id = v_inv_id)
    end;
    if btrim(coalesce(v_current, '')) <> v_old then
      v_reason := 'PickD has a different value here (sheet out of order?) — wait a minute and retry';
    elsif p_column = 'Category' and not (v_opts->'Category') ? v_new then
      v_reason := 'Category must be one of the list';
    elsif p_column = 'Condition' and not (v_opts->'Condition') ? v_new then
      v_reason := 'Condition must be one of the list';
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

  if v_new is distinct from btrim(coalesce(v_current, '')) then
    case p_column
      when 'Category' then update public.sku_metadata set category = v_new where sku = p_sku;
      when 'Condition' then update public.sku_metadata set condition = v_new where sku = p_sku;
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
    when 'Condition description' then (select condition_description from public.sku_metadata where sku = p_sku)
    when 'Serial' then (select serial_number from public.sku_metadata where sku = p_sku)
    when 'PDF link' then (select pdf_link from public.sku_metadata where sku = p_sku)
    when 'Internal note' then (select internal_note from public.inventory where id = v_inv_id)
  end;

  insert into public.sd_sheet_edits (sku, column_name, old_value, new_value, editor, applied)
  values (p_sku, p_column, v_current, v_stored, p_editor, true);
  return jsonb_build_object('ok', true, 'value', coalesce(v_stored, ''));
end;
$$;

-- Undo what the sheet wrote since p_since, newest first. A field someone has
-- changed again since (in PickD or the sheet) is left alone and reported.
-- Preview unless p_apply.
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
