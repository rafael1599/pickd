-- Add total_capacity to get_inventory_stats so the warehouse capacity
-- bar shows the real total, not just loaded locations.
-- Must DROP first because return type changes (adding total_capacity column).

DROP FUNCTION IF EXISTS get_inventory_stats(boolean);

-- p_include_parts = false → bikes only (is_bike = true)
-- p_include_parts = true  → parts only (is_bike = false)
CREATE OR REPLACE FUNCTION get_inventory_stats(p_include_parts boolean DEFAULT false)
RETURNS TABLE(total_skus bigint, total_units bigint, total_capacity bigint) AS $$
  SELECT
    COUNT(DISTINCT inventory.sku),
    COALESCE(SUM(quantity), 0),
    (SELECT COALESCE(SUM(l.max_capacity), 0)
     FROM locations l
     WHERE l.warehouse = 'LUDLOW' AND l.is_active = true
       AND l.location NOT ILIKE 'CAGE%'
       AND EXISTS (
         SELECT 1 FROM inventory inv
         JOIN sku_metadata sm2 ON inv.sku = sm2.sku
         WHERE inv.location = l.location AND inv.warehouse = l.warehouse
           AND inv.is_active = true AND inv.quantity > 0
           AND sm2.is_bike = (NOT p_include_parts)
       )
    )
  FROM inventory
  JOIN sku_metadata ON sku_metadata.sku = inventory.sku
  WHERE inventory.is_active = true
    AND inventory.quantity > 0
    AND inventory.warehouse = 'LUDLOW'
    AND sku_metadata.is_bike = (NOT p_include_parts);
$$ LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp;
