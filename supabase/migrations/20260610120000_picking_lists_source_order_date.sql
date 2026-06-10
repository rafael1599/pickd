-- Add the AS400 source document "Order Date" to picking_lists.
-- Written by watchdog-pickd when it parses the purchase-order PDF.
-- Additive + nullable so it is safe on the shared staging/prod DB.
ALTER TABLE picking_lists
  ADD COLUMN IF NOT EXISTS source_order_date date;

COMMENT ON COLUMN picking_lists.source_order_date IS
  'AS400 document Order Date (ISO yyyy-mm-dd) captured at PDF import. NULL when unknown.';
