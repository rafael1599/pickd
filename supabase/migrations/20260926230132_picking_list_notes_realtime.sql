-- bug-033: a note written on one phone never reached the others live.
-- `usePickingNotesRealtime` (LayoutMain) listens for INSERTs on
-- picking_list_notes, but no migration ever added the table to the
-- supabase_realtime publication, so the channel received nothing and a new
-- note only appeared after a reload or a refetch. INSERT events need no
-- REPLICA IDENTITY FULL; RLS ("Collaborative Select Notes") still decides
-- who receives each row.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'picking_list_notes'
  ) then
    alter publication supabase_realtime add table public.picking_list_notes;
  end if;
end $$;
