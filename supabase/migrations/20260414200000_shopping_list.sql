-- Shopping List: shared warehouse supply/material requests
-- idea-056

CREATE TABLE IF NOT EXISTS public.shopping_list (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  item_name text NOT NULL,
  quantity text,
  note text,
  urgent boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done')),
  requested_by uuid REFERENCES public.profiles(id),
  requested_by_name text,
  done_by uuid REFERENCES public.profiles(id),
  done_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.shopping_list ENABLE ROW LEVEL SECURITY;

-- All authenticated users can CRUD
CREATE POLICY "shopping_list_select_authenticated"
  ON public.shopping_list FOR SELECT TO authenticated USING (true);

CREATE POLICY "shopping_list_insert_authenticated"
  ON public.shopping_list FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "shopping_list_update_authenticated"
  ON public.shopping_list FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "shopping_list_delete_authenticated"
  ON public.shopping_list FOR DELETE TO authenticated USING (true);

-- Default query: pending first, urgent on top, newest first
CREATE INDEX idx_shopping_list_status_urgent_created
  ON public.shopping_list (status, urgent DESC, created_at DESC);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.shopping_list;
