import { supabase } from '../../../lib/supabase';

export type ResolveAction = 'stock' | 'sd' | 'dispose';

export interface ResolveReturnInput {
  sku: string;
  action: ResolveAction;
  performedBy: string;
  userId: string;
  userRole: 'admin' | 'staff';
  /** stock: the catalogue SKU the unit joins, and where. */
  modelSku?: string;
  location?: string;
  squares?: string[];
  /** sd: an S/D needs its serial. */
  serial?: string;
  /** dispose: why. */
  reason?: string;
}

/**
 * The three ways out of a FedEx return (`resolve_return`, 20261006125642,
 * docs/prds/fedex-return-card.md F2), each in one transaction: back to its
 * model's stock, the S/D it is, or disposed. The return's card stays at 0.
 */
export async function resolveReturn(input: ResolveReturnInput): Promise<void> {
  const { error } = await supabase.rpc('resolve_return', {
    p_sku: input.sku,
    p_action: input.action,
    p_performed_by: input.performedBy,
    p_user_id: input.userId,
    p_user_role: input.userRole,
    p_model_sku: input.modelSku,
    p_location: input.location,
    p_sublocation: input.squares?.length ? input.squares : undefined,
    p_serial: input.serial,
    p_reason: input.reason,
  });
  if (error) throw error;
}
