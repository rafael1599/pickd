import { supabase } from '../../../lib/supabase';
import { summarizeIntakes } from '../lib/containers';
import type {
  ContainerInputItem,
  ContainerIntake,
  RegisterSummary,
  ResolvedItem,
} from '../lib/types';

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

/**
 * The containers among `locations` that PickD already has -- the rule is
 * summarizeIntakes'. Two reads: the ADDs that ever went into those names, and
 * the stock they hold now.
 */
export async function fetchContainerIntakes(
  locations: string[],
  warehouse: string
): Promise<Map<string, ContainerIntake>> {
  if (locations.length === 0) return new Map();
  const [logs, stock] = await Promise.all([
    supabase
      .from('inventory_logs')
      .select('to_location, action_type, quantity_change, performed_by, created_at, is_reversed')
      .in('to_location', locations)
      .eq('action_type', 'ADD')
      .gt('quantity_change', 0),
    supabase
      .from('inventory')
      .select('location, quantity')
      .eq('warehouse', warehouse)
      .in('location', locations)
      .gt('quantity', 0),
  ]);
  if (logs.error) throw new Error(logs.error.message);
  if (stock.error) throw new Error(stock.error.message);
  return summarizeIntakes(locations, logs.data ?? [], stock.data ?? []);
}

export interface RegisterContainerArgs {
  location: string;
  items: ContainerInputItem[];
  userId: string;
  performedBy: string;
  warehouse: string;
  orderNumber?: string | null;
  isBike?: boolean;
  itemTypesBySku?: Record<string, 'bike' | 'part'>;
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

  if (args.itemTypesBySku && Object.keys(args.itemTypesBySku).length > 0) {
    const rows = Object.entries(args.itemTypesBySku).map(([sku, type]) => ({
      sku: sku.trim().toUpperCase(),
      is_bike: type === 'bike',
    }));
    await supabase.from('sku_metadata').upsert(rows, { onConflict: 'sku' });
  } else if (typeof args.isBike === 'boolean') {
    const uniqueSkus = [...new Set(args.items.map((i) => i.sku.trim().toUpperCase()))].filter(
      Boolean
    );
    if (uniqueSkus.length > 0) {
      const rows = uniqueSkus.map((sku) => ({ sku, is_bike: args.isBike }));
      await supabase.from('sku_metadata').upsert(rows, { onConflict: 'sku' });
    }
  }

  return data as RegisterSummary;
}
