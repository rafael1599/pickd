-- Per-user persistent layouts of physical slot groups in active rows.
--
-- Context: Rafael's warehouse has rows whose physical structure is
-- stable (e.g. "ROW 1 always has 2 towers together, ROW 4 always has
-- 1 tower + 2 lines together with same-SKU"). Defining those groups
-- every time the operator wants to fill the row is friction the new
-- /consolidation slot-fill tab is supposed to remove.
--
-- Schema choice: one row per (user_id, warehouse, row_name). The
-- `layout` jsonb is the canonical shape; we don't normalize the
-- groups into their own table because (a) the UI always reads the
-- whole layout at once and (b) groups are nested under rows with no
-- cross-row queries planned.
--
-- `layout` shape (validated client-side via a Zod schema):
--   {
--     "groups": [
--       {
--         "id": "g1",                    -- stable within layout
--         "label": "Front-left",         -- optional human label
--         "same_sku": true,              -- enforce all slots in this
--                                        --   group fill with one SKU
--         "slots": [
--           { "id": "s1", "type": "tower", "min_qty": 30, "max_qty": 35 },
--           { "id": "s2", "type": "line",  "min_qty": 4,  "max_qty": 7  },
--           { "id": "s3", "type": "custom","min_qty": 12, "max_qty": 18 }
--         ]
--       }
--     ]
--   }

CREATE TABLE IF NOT EXISTS public.warehouse_slot_layouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  warehouse text NOT NULL,
  row_name text NOT NULL,
  layout jsonb NOT NULL DEFAULT '{"groups":[]}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT warehouse_slot_layouts_unique_per_user_row
    UNIQUE (user_id, warehouse, row_name)
);

CREATE INDEX IF NOT EXISTS idx_warehouse_slot_layouts_user
  ON public.warehouse_slot_layouts (user_id);

-- Keep updated_at fresh on every UPDATE. The trigger is named with
-- the `zz_` prefix so it runs after any data-mutating triggers — same
-- convention used by other tables in this project.
CREATE OR REPLACE FUNCTION public.trg_warehouse_slot_layouts_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_zz_warehouse_slot_layouts_touch ON public.warehouse_slot_layouts;
CREATE TRIGGER trg_zz_warehouse_slot_layouts_touch
  BEFORE UPDATE ON public.warehouse_slot_layouts
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_warehouse_slot_layouts_touch_updated_at();

-- RLS: each user only sees and modifies their own layouts. Admins
-- could be granted broader access later via a separate policy, but
-- there's no business case yet for sharing layouts across users.
ALTER TABLE public.warehouse_slot_layouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own slot layouts" ON public.warehouse_slot_layouts;
CREATE POLICY "Users manage own slot layouts"
  ON public.warehouse_slot_layouts
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.warehouse_slot_layouts
  TO authenticated;

COMMENT ON TABLE public.warehouse_slot_layouts IS
  'Per-user persistent definition of slot groups within an active row. Consumed by /consolidation slot-fill tab.';
COMMENT ON COLUMN public.warehouse_slot_layouts.layout IS
  'jsonb { groups: [{ id, label?, same_sku, slots: [{ id, type, min_qty, max_qty }] }] }';
