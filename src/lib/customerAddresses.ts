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
  created_at: string;
  updated_at: string;
}

export async function fetchCustomerAddresses(customerId: string): Promise<CustomerAddress[]> {
  const { data, error } = await supabase
    .from('customer_addresses')
    .select('*')
    .eq('customer_id', customerId)
    .order('is_default', { ascending: false })
    .order('updated_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as CustomerAddress[];
}

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
}) {
  if (!street.trim()) return;

  const { error } = await supabase
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
    );

  if (error && !error.message.includes('duplicate')) {
    console.error('[customerAddresses] Save error:', error.message);
  }
}
