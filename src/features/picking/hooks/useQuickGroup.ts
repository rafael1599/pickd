import { supabase } from '../../../lib/supabase';
import toast from 'react-hot-toast';

export const useQuickGroup = () => {
  const quickGroupCompletedOrders = async (listIds: string[], location: string) => {
    if (listIds.length < 2) {
      toast.error('Select at least 2 orders');
      return null;
    }

    try {
      const { data, error } = await supabase.rpc('quick_group_completed_orders' as any, {
        p_list_ids: listIds,
        p_location: location,
      });

      if (error) throw error;

      const result = data as any;
      toast.success(`Grouped ${result?.orders_grouped || 2} orders at ${location}`);
      return result?.group_id;
    } catch (err) {
      console.error('Quick group failed:', err);
      toast.error('Failed to group orders');
      return null;
    }
  };

  return { quickGroupCompletedOrders };
};
