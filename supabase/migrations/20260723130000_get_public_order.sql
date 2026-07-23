-- Public RPC: resolve one order's full detail by order_number, for the
-- public /order/:orderNumber page the printed packing-slip QR links to.
-- No session required (RLS on picking_lists/customers is authenticated-only),
-- so this SECURITY DEFINER function is the read path, same pattern as
-- get_public_tag_by_sku.
--
-- order_number lookup has two cases:
--   1. Exact match — covers a single order AND a watchdog DB-merged combined
--      order, whose order_number column already IS the "X / Y" string.
--   2. Fallback: split the input on ' / ' and match each part against its
--      OWN order_number — covers a group_id-merged combined order, whose
--      joined "X / Y" string is only ever built client-side and never
--      stored on any row.
-- Either way this returns an array of raw per-row objects (not merged) —
-- the client applies the same merge it already uses everywhere else
-- (tag items with source_order, merge pallet_photos, sum units/pallets).
CREATE OR REPLACE FUNCTION get_public_order(p_order_number text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
DECLARE
  v_numbers text[];
  v_rows jsonb;
BEGIN
  IF EXISTS (
    SELECT 1 FROM picking_lists
    WHERE order_number = p_order_number AND status <> 'cancelled'
  ) THEN
    v_numbers := ARRAY[p_order_number];
  ELSE
    SELECT array_agg(trim(part)) INTO v_numbers
    FROM unnest(string_to_array(p_order_number, ' / ')) AS part;
  END IF;

  SELECT jsonb_agg(row) INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'id', pl.id,
      'order_number', pl.order_number,
      'status', pl.status,
      'items', pl.items,
      'notes', pl.notes,
      'source_order_date', pl.source_order_date,
      'pallets_qty', pl.pallets_qty,
      'total_units', pl.total_units,
      'load_number', pl.load_number,
      'created_at', pl.created_at,
      'updated_at', pl.updated_at,
      'transport_company', pl.transport_company,
      'total_weight_lbs', pl.total_weight_lbs,
      'pallet_photos', pl.pallet_photos,
      'is_shipped', pl.is_shipped,
      'combine_meta', pl.combine_meta,
      'group_id', pl.group_id,
      'customer', (
        SELECT jsonb_build_object(
          'id', c.id,
          'name', c.name,
          'street', c.street,
          'city', c.city,
          'state', c.state,
          'zip_code', c.zip_code,
          'phone', c.phone
        )
        FROM customers c WHERE c.id = pl.customer_id
      ),
      'picker', (SELECT p.full_name FROM profiles p WHERE p.id = pl.user_id),
      'checker', (SELECT p.full_name FROM profiles p WHERE p.id = pl.checked_by)
    ) AS row
    FROM picking_lists pl
    WHERE pl.order_number = ANY(v_numbers)
      AND pl.status <> 'cancelled'
    ORDER BY pl.created_at ASC
  ) t;

  RETURN COALESCE(v_rows, '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION get_public_order FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_public_order TO anon, authenticated, service_role;
