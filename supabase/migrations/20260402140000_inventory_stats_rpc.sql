-- RPC function: returns total unique SKUs and total units for LUDLOW warehouse.
-- Runs entirely in Postgres — returns 2 numbers instead of thousands of rows.
-- Parameter: p_include_parts (default false) — when true, includes parts bins.

CREATE OR REPLACE FUNCTION get_inventory_stats(p_include_parts boolean DEFAULT false)
RETURNS TABLE(total_skus bigint, total_units bigint) AS $$
  SELECT
    COUNT(DISTINCT sku),
    COALESCE(SUM(quantity), 0)
  FROM inventory
  WHERE is_active = true
    AND quantity > 0
    AND warehouse = 'LUDLOW'
    AND (p_include_parts OR location LIKE 'ROW %' OR location = 'PALLETIZED' OR location = 'UNASSIGNED');
$$ LANGUAGE sql STABLE SECURITY DEFINER;

REVOKE ALL ON FUNCTION get_inventory_stats FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_inventory_stats TO authenticated, service_role;
