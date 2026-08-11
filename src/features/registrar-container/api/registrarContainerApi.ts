import { supabase } from '../../../lib/supabase';
import { withAuthRefreshRetry } from '../../../lib/authRefreshRetry';
import type { ContainerInputItem, RegisterSummary, ResolvedItem } from '../lib/types';

// These RPCs are newer than the generated Supabase types, so we call them
// through a narrow, locally-typed wrapper instead of `any`.
type RpcError = { message: string; code?: string; status?: number };
type RpcResult<T> = { data: T | null; error: RpcError | null };
const callRpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string,
  args: Record<string, unknown>
) => Promise<RpcResult<unknown>>;

/**
 * Rethrow a Supabase error while preserving `code`/`status`. `new
 * Error(error.message)` drops them, and both the QueryCache/MutationCache
 * `onError` hooks and `query-client`'s retry predicate key off `code ===
 * 'PGRST301'` / `status === 401`. Stripping them meant an expired session
 * showed a dead-end red toast, burned three pointless mutation retries, and
 * never redirected to /login.
 */
function throwPreservingCode(error: RpcError): never {
  const err = new Error(error.message) as Error & { code?: string; status?: number };
  if (error.code) err.code = error.code;
  if (error.status) err.status = error.status;
  throw err;
}

export async function resolveContainerSkus(
  items: ContainerInputItem[],
  warehouse: string
): Promise<ResolvedItem[]> {
  const { data, error } = await withAuthRefreshRetry(
    () => callRpc('resolve_container_skus', { p_items: items, p_warehouse: warehouse }),
    { label: 'resolveContainerSkus' }
  );
  if (error) throwPreservingCode(error);
  return (data as ResolvedItem[] | null) ?? [];
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
  const { data, error } = await withAuthRefreshRetry(
    () =>
      callRpc('register_container', {
        p_location: args.location,
        p_items: args.items,
        p_user_id: args.userId,
        p_performed_by: args.performedBy,
        p_warehouse: args.warehouse,
        p_order_number: args.orderNumber ?? null,
      }),
    { label: 'registerContainer' }
  );
  if (error) throwPreservingCode(error);

  const rows = buildTypeRows(args);
  if (rows.length > 0) {
    // Second write, separate from the RPC's transaction: the stock is already
    // in. If this fails we must still say so — silently swallowing it left the
    // container registered with every bike/part designation the operator just
    // made thrown away, and `is_bike` back-filled by the DB trigger's prefix
    // guess. That's the exact misclassification the mandatory type step exists
    // to prevent, so surface it rather than reporting success.
    const { error: metaError } = await withAuthRefreshRetry(
      () => supabase.from('sku_metadata').upsert(rows, { onConflict: 'sku' }),
      { label: 'registerContainer.skuMetadata' }
    );
    if (metaError) {
      throw new Error(
        `Container registered in ${args.location}, but saving the Bike/Part types failed: ${metaError.message}. Fix the types from Inventory before picking.`
      );
    }
  }

  return data as RegisterSummary;
}

/** Per-SKU designations when present, else the screen-wide Bike/Part choice. */
function buildTypeRows(args: RegisterContainerArgs): Array<{ sku: string; is_bike: boolean }> {
  if (args.itemTypesBySku && Object.keys(args.itemTypesBySku).length > 0) {
    return Object.entries(args.itemTypesBySku).map(([sku, type]) => ({
      sku: sku.trim().toUpperCase(),
      is_bike: type === 'bike',
    }));
  }
  if (typeof args.isBike === 'boolean') {
    const isBike = args.isBike;
    const uniqueSkus = [...new Set(args.items.map((i) => i.sku.trim().toUpperCase()))].filter(
      Boolean
    );
    return uniqueSkus.map((sku) => ({ sku, is_bike: isBike }));
  }
  return [];
}
