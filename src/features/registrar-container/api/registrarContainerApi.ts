import { supabase } from '../../../lib/supabase';
import type { ContainerInputItem, RegisterSummary, ResolvedItem } from '../lib/types';

// These RPCs are newer than the generated Supabase types, so we call them
// through a narrow, locally-typed wrapper instead of `any`.
type RpcResult<T> = { data: T | null; error: { message: string } | null };
const callRpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string,
  args: Record<string, unknown>
) => Promise<RpcResult<unknown>>;

export async function resolveContainerSkus(
  items: ContainerInputItem[],
  warehouse: string
): Promise<ResolvedItem[]> {
  const { data, error } = await callRpc('resolve_container_skus', {
    p_items: items,
    p_warehouse: warehouse,
  });
  if (error) throw new Error(error.message);
  return (data as ResolvedItem[] | null) ?? [];
}

export interface RegisterContainerArgs {
  location: string;
  items: ContainerInputItem[];
  userId: string;
  performedBy: string;
  warehouse: string;
  orderNumber?: string | null;
}

export async function registerContainer(args: RegisterContainerArgs): Promise<RegisterSummary> {
  const { data, error } = await callRpc('register_container', {
    p_location: args.location,
    p_items: args.items,
    p_user_id: args.userId,
    p_performed_by: args.performedBy,
    p_warehouse: args.warehouse,
    p_order_number: args.orderNumber ?? null,
  });
  if (error) throw new Error(error.message);
  return data as RegisterSummary;
}
