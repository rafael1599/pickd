-- The public order page read the shipment facts (pallets, photos, load #, carrier,
-- shipped) only from picking_lists. Since 20260927011500 shipments is the one that
-- is written: photos taken from then on went to the shipment only, so the page lost
-- them. Each row now also carries its shipment; PublicOrderView (combineOrdersCore)
-- already prefers it and falls back to the row. The other fields do not change.
CREATE OR REPLACE FUNCTION public.get_public_order(p_order_number text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
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
      'shipment_id', pl.shipment_id,
      'shipment', (
        SELECT jsonb_build_object(
          'id', s.id,
          'pallets_qty', s.pallets_qty,
          'load_number', s.load_number,
          'transport_company', s.transport_company,
          'total_weight_lbs', s.total_weight_lbs,
          'pallet_photos', s.pallet_photos,
          'pallet_dims', s.pallet_dims,
          'ship_to_address_id', s.ship_to_address_id,
          'is_shipped', s.is_shipped
        )
        FROM shipments s WHERE s.id = pl.shipment_id
      ),
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
$function$;
