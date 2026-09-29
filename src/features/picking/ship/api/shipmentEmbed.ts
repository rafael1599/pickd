/**
 * Its own module, imported by the list hook and by `shipOrderDetail.ts`: the two
 * import each other, and a constant one of them evaluates at load time must not
 * live in either (`Cannot access 'SHIPMENT_EMBED' before initialization`).
 *
 * The shipment's facts, embedded wherever Ship reads an order: since 27 Sep they
 * live only in `shipments`, and a read without this falls back to the old
 * picking_lists columns (bug-049: the open order lost its photos).
 */
export const SHIPMENT_EMBED = `shipment:shipments(
    id,
    customer_id,
    ship_to_address_id,
    transport_company,
    load_number,
    pallets_qty,
    total_weight_lbs,
    pallet_dims,
    pallet_photos,
    is_shipped,
    shipped_at,
    metadata
  )`;
