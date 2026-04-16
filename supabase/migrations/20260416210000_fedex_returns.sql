-- FedEx Returns Queue
-- Tracks incoming return packages through intake → processing → resolution

-- ─── Table: fedex_returns ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fedex_returns (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tracking_number text NOT NULL,
  status text NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'processing', 'resolved')),
  label_photo_url text,
  notes text,
  received_by uuid REFERENCES public.profiles(id),
  received_by_name text,
  processed_by uuid REFERENCES public.profiles(id),
  processed_by_name text,
  received_at timestamptz DEFAULT now(),
  processed_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT fedex_returns_tracking_unique UNIQUE (tracking_number)
);

-- ─── Table: fedex_return_items ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fedex_return_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  return_id uuid NOT NULL REFERENCES public.fedex_returns(id) ON DELETE CASCADE,
  sku text NOT NULL,
  item_name text,
  quantity integer NOT NULL DEFAULT 1,
  condition text NOT NULL DEFAULT 'good'
    CHECK (condition IN ('good', 'damaged', 'defective', 'unknown')),
  moved_to_location text,
  moved_to_warehouse text,
  moved_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.fedex_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fedex_return_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fedex_returns_select" ON public.fedex_returns
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "fedex_returns_insert" ON public.fedex_returns
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "fedex_returns_update" ON public.fedex_returns
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "fedex_returns_delete" ON public.fedex_returns
  FOR DELETE TO authenticated USING (true);

CREATE POLICY "fedex_return_items_select" ON public.fedex_return_items
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "fedex_return_items_insert" ON public.fedex_return_items
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "fedex_return_items_update" ON public.fedex_return_items
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "fedex_return_items_delete" ON public.fedex_return_items
  FOR DELETE TO authenticated USING (true);

-- ─── Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX idx_fedex_returns_status ON public.fedex_returns (status, received_at DESC);
CREATE INDEX idx_fedex_returns_processed_at ON public.fedex_returns (processed_at DESC);
CREATE INDEX idx_fedex_return_items_return_id ON public.fedex_return_items (return_id);
CREATE INDEX idx_fedex_return_items_sku ON public.fedex_return_items (sku);

-- ─── Realtime ────────────────────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE public.fedex_returns;
ALTER PUBLICATION supabase_realtime ADD TABLE public.fedex_return_items;
