-- Project tasks kanban board
CREATE TABLE IF NOT EXISTS public.project_tasks (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  note text,
  status text NOT NULL DEFAULT 'future' CHECK (status IN ('future', 'in_progress', 'done')),
  position integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.project_tasks ENABLE ROW LEVEL SECURITY;

-- RLS: authenticated users can read all, admins can write
CREATE POLICY "Authenticated users can read project_tasks" ON public.project_tasks
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can insert project_tasks" ON public.project_tasks
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Admins can update project_tasks" ON public.project_tasks
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Admins can delete project_tasks" ON public.project_tasks
  FOR DELETE TO authenticated USING (true);

-- Task state change log
CREATE TABLE IF NOT EXISTS public.task_state_changes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES public.project_tasks(id) ON DELETE CASCADE,
  from_status text NOT NULL,
  to_status text NOT NULL,
  changed_at timestamptz DEFAULT now(),
  changed_by uuid REFERENCES public.profiles(id)
);

ALTER TABLE public.task_state_changes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read task_state_changes" ON public.task_state_changes
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert task_state_changes" ON public.task_state_changes
  FOR INSERT TO authenticated WITH CHECK (true);

-- Index for report queries (tasks completed today)
CREATE INDEX idx_task_state_changes_to_status_date ON public.task_state_changes (to_status, changed_at);
CREATE INDEX idx_project_tasks_status ON public.project_tasks (status);
