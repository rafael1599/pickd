-- '-' in the S/D sheet's Category and Condition lists (Rafael, 2 Oct 2026: "en
-- las listas agrega para que se pueda elegir un -"). The sheet shows '-' for an
-- empty list field, and choosing '-' empties it — a deliberate clear, unlike a
-- deleted cell, which still never writes. Everything else as in 20261002125302.

create or replace function public.sd_sheet_options()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'editable', jsonb_build_array('Category', 'Condition', 'Condition description', 'Serial', 'Internal note', 'PDF link'),
    'Category', jsonb_build_array('mountain', 'gravel', 'road', 'cruiser', 'urban', 'hybrid', 'kids', 'parts', 'other', '-'),
    'Condition', jsonb_build_array('new_unbuilt', 'new_built', 'ridden_demo', 'returned', 'defective_frame', '-')
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

  if v_is_list and v_old = '-' then v_old := ''; end if;

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

  v_write := case when v_is_list and v_new = '-' then null else v_new end;
  if v_write is distinct from nullif(btrim(coalesce(v_current, '')), '') then
    case p_column
      when 'Category' then update public.sku_metadata set category = v_write where sku = p_sku;
      when 'Condition' then update public.sku_metadata set condition = v_write where sku = p_sku;
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
  return jsonb_build_object(
    'ok', true,
    'value', case when v_is_list then coalesce(nullif(v_stored, ''), '-') else coalesce(v_stored, '') end
  );
end;
$$;

