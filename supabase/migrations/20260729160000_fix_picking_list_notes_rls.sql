-- Fix RLS policy violation on picking_list_notes table
-- Allows all warehouse staff/shippers to add, view, update, and delete notes for any picking list

DROP POLICY IF EXISTS "Users can add notes to relevant lists" ON public.picking_list_notes;
DROP POLICY IF EXISTS "Users can view notes for accessible lists" ON public.picking_list_notes;
DROP POLICY IF EXISTS "Collaborative Select Notes" ON public.picking_list_notes;
DROP POLICY IF EXISTS "Collaborative Insert Notes" ON public.picking_list_notes;
DROP POLICY IF EXISTS "Collaborative Update Notes" ON public.picking_list_notes;
DROP POLICY IF EXISTS "Collaborative Delete Notes" ON public.picking_list_notes;

CREATE POLICY "Collaborative Select Notes"
  ON public.picking_list_notes FOR SELECT
  USING (true);

CREATE POLICY "Collaborative Insert Notes"
  ON public.picking_list_notes FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Collaborative Update Notes"
  ON public.picking_list_notes FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Collaborative Delete Notes"
  ON public.picking_list_notes FOR DELETE
  USING (true);
