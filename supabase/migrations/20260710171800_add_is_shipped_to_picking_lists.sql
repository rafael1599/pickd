-- Add is_shipped column to public.picking_lists to track shipped status
ALTER TABLE public.picking_lists ADD COLUMN IF NOT EXISTS is_shipped BOOLEAN DEFAULT false;

-- Mark all completed orders up to now as shipped
UPDATE public.picking_lists
SET is_shipped = true
WHERE status = 'completed';
