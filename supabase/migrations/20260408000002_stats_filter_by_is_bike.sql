-- Align get_inventory_stats with is_bike classification.
-- Previously filtered by location pattern (ROW/PALLETIZED/UNASSIGNED).
-- Now filters by sku_metadata.is_bike for accurate bike vs parts counts.

CREATE OR REPLACE FUNCTION get_inventory_stats(p_include_parts boolean DEFAULT false)
RETURNS TABLE(total_skus bigint, total_units bigint) AS $$
  SELECT
    COUNT(DISTINCT inventory.sku),
    COALESCE(SUM(quantity), 0)
  FROM inventory
  JOIN sku_metadata ON sku_metadata.sku = inventory.sku
  WHERE inventory.is_active = true
    AND inventory.quantity > 0
    AND inventory.warehouse = 'LUDLOW'
    AND (p_include_parts OR sku_metadata.is_bike = true);
$$ LANGUAGE sql STABLE SECURITY DEFINER;
