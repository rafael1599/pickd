import { useEffect, useState, useCallback } from 'react';
import { fetchCustomerAddresses, type CustomerAddress } from '../lib/customerAddresses';

export function useCustomerAddresses(customerId: string | null) {
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(() => {
    if (!customerId) {
      setAddresses([]);
      return;
    }
    setLoading(true);
    fetchCustomerAddresses(customerId)
      .then(setAddresses)
      .catch(() => setAddresses([]))
      .finally(() => setLoading(false));
  }, [customerId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { addresses, loading, refresh };
}
