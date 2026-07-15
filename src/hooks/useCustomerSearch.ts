import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { Customer } from '../types/schema';
import { debounce } from '../utils/debounce';

export const useCustomerSearch = (query: string) => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!query || query.length < 2) {
      setCustomers([]);
      return;
    }

    const search = debounce(async (q: string) => {
      setIsLoading(true);
      try {
        const { data, error } = await supabase
          .from('customers')
          .select('*')
          .ilike('name', `%${q}%`)
          .limit(10);

        if (error) throw error;
        setCustomers(data || []);
      } catch (err) {
        console.error('Customer search failed:', err);
      } finally {
        setIsLoading(false);
      }
    }, 300);

    search(query);
  }, [query]);

  return { customers, isLoading };
};
