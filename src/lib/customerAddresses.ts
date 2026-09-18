import { supabase } from './supabase';

export interface CustomerAddress {
  id: string;
  customer_id: string;
  label: string | null;
  street: string;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  is_default: boolean;
  /** Two-digit AS400 ship-to suffix ("00"); the DB mints fedex_recipient_id from it. */
  as400_ship_to: string | null;
  /** What the ship station types into FedEx Ship Manager's Recipient ID. */
  fedex_recipient_id: string | null;
  contact_name: string | null;
  residential: boolean;
  /** Last time FSM and Pickd agreed on this row; NULL = not known to be in FSM. */
  fedex_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function fetchCustomerAddresses(customerId: string): Promise<CustomerAddress[]> {
  const { data, error } = await supabase
    .from('customer_addresses')
    .select(
      'id, customer_id, label, street, city, state, zip_code, is_default, as400_ship_to, fedex_recipient_id, contact_name, residential, fedex_synced_at, created_at, updated_at'
    )
    .eq('customer_id', customerId)
    .order('is_default', { ascending: false })
    .order('updated_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as CustomerAddress[];
}

/** Upserts the address and returns its id, so a caller can link it as a
 *  specific order's `ship_to_address_id` — otherwise the row is saved but
 *  nothing points at it, which looks like "it didn't save" on next load. */
export async function saveCustomerAddress({
  customerId,
  street,
  city,
  state,
  zip,
}: {
  customerId: string;
  street: string;
  city?: string;
  state?: string;
  zip?: string;
}): Promise<string | null> {
  if (!street.trim()) return null;

  const { data, error } = await supabase
    .from('customer_addresses')
    .upsert(
      {
        customer_id: customerId,
        street: street.trim(),
        city: city || null,
        state: state || null,
        zip_code: zip || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'customer_id,normalized_address' }
    )
    .select('id')
    .single();

  if (error) {
    if (!error.message.includes('duplicate')) {
      console.error('[customerAddresses] Save error:', error.message);
    }
    return null;
  }
  return data?.id ?? null;
}
