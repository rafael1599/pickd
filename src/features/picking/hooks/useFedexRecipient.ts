import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import {
  resolveFedexRecipient,
  type FedexRecipientAddress,
  type FedexRecipientCustomer,
  type FedexRecipientState,
} from '../utils/fedexRecipient';

const ADDRESS_COLUMNS =
  'id, label, street, city, state, zip_code, fedex_recipient_id, contact_name, residential, fedex_synced_at';

/**
 * Explicit FK hint: picking_lists reaches customer_addresses through one FK,
 * but customers also relates to customer_addresses, so the hint keeps the
 * embed unambiguous for PostgREST.
 */
const SELECT = `id, customer_id, ship_to_address_id,
  customer:customers(id, name, as400_account, ship_to_varies),
  ship_to:customer_addresses!picking_lists_ship_to_address_id_fkey(${ADDRESS_COLUMNS})`;

interface Row {
  id: string;
  customer_id: string | null;
  ship_to_address_id: string | null;
  customer: (FedexRecipientCustomer & { id: string; name: string }) | null;
  ship_to: FedexRecipientAddress | null;
}

export const fedexRecipientQueryKey = (listId: string | null) => ['fedex-recipient', listId];

async function fetchFedexRecipient(listId: string): Promise<FedexRecipientState> {
  const { data, error } = await supabase
    .from('picking_lists')
    .select(SELECT)
    .eq('id', listId)
    .maybeSingle<Row>();
  if (error) throw error;
  if (!data) return resolveFedexRecipient(null, null);

  let address = data.ship_to;
  // Orders created before the watcher linked a ship-to (or manual ones) fall
  // back to the customer's default address, which is what the card shows anyway.
  if (!address && data.customer_id) {
    const fallback = await supabase
      .from('customer_addresses')
      .select(ADDRESS_COLUMNS)
      .eq('customer_id', data.customer_id)
      .eq('is_default', true)
      .maybeSingle<FedexRecipientAddress>();
    if (fallback.error) throw fallback.error;
    address = fallback.data;
  }
  return resolveFedexRecipient(data.customer, address);
}

/**
 * FedEx recipient state for an order: which id to paste in FSM and what to
 * do there. One cache entry per order; cheap, so it can sit on every card.
 */
export function useFedexRecipient(listId: string | null) {
  return useQuery({
    queryKey: fedexRecipientQueryKey(listId),
    queryFn: () => fetchFedexRecipient(listId as string),
    enabled: !!listId,
    staleTime: 60_000,
  });
}
