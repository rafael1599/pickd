import { supabase } from '../../../lib/supabase';

export interface RegisterReturnInput {
  tracking: string;
  isBike: boolean;
  rma: string | null;
  isMisship: boolean;
  labelUrl: string | null;
  performedBy: string;
  userId: string | null;
}

/**
 * A FedEx return in one step (`register_return`, 20261006033118, idea-250): its
 * own unit with the tracking as SKU, 1 u in FDX RETURNS, the label photo with it.
 */
export async function registerReturn(input: RegisterReturnInput): Promise<string> {
  const { data, error } = await supabase.rpc('register_return', {
    p_tracking: input.tracking,
    p_is_bike: input.isBike,
    p_performed_by: input.performedBy,
    p_user_id: input.userId ?? undefined,
    p_rma: input.rma ?? undefined,
    p_is_misship: input.isMisship,
    p_label_url: input.labelUrl ?? undefined,
  });
  if (error) throw error;
  return (data as { sku?: string } | null)?.sku ?? input.tracking;
}
