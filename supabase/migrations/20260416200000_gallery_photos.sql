-- Gallery photos: standalone photos captured in the Projects screen
CREATE TABLE IF NOT EXISTS public.gallery_photos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  filename text NOT NULL,
  url text NOT NULL,
  thumbnail_url text NOT NULL,
  caption text,
  deleted_at timestamptz,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.gallery_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read gallery_photos" ON public.gallery_photos
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert gallery_photos" ON public.gallery_photos
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update gallery_photos" ON public.gallery_photos
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated delete gallery_photos" ON public.gallery_photos
  FOR DELETE TO authenticated USING (true);

CREATE INDEX idx_gallery_photos_deleted_at ON public.gallery_photos (deleted_at);
CREATE INDEX idx_gallery_photos_created_at ON public.gallery_photos (created_at DESC);

-- Junction: photos assigned to tasks (many-to-many)
CREATE TABLE IF NOT EXISTS public.task_photos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES public.project_tasks(id) ON DELETE CASCADE,
  photo_id uuid NOT NULL REFERENCES public.gallery_photos(id) ON DELETE CASCADE,
  assigned_by uuid REFERENCES public.profiles(id),
  assigned_at timestamptz DEFAULT now(),
  UNIQUE (task_id, photo_id)
);

ALTER TABLE public.task_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read task_photos" ON public.task_photos
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert task_photos" ON public.task_photos
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated delete task_photos" ON public.task_photos
  FOR DELETE TO authenticated USING (true);

CREATE INDEX idx_task_photos_task_id ON public.task_photos (task_id);
CREATE INDEX idx_task_photos_photo_id ON public.task_photos (photo_id);
