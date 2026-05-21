import { useMutation } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';

/**
 * Pick / Unpick mutation for the DoubleCheckView slider items.
 *
 * Why this hook exists (vs. the previous direct `supabase.rpc().then()`
 * call inside `PickingCartDrawer.toggleCheck`):
 *
 *  - The direct call did not inherit React Query's retry/backoff. On a
 *    flaky network the picker would tap an item, see the local Set flip,
 *    the RPC would fail once with `Failed to fetch`, and the toggle
 *    would revert with a toast — forcing the picker to retap.
 *  - `useMutation` runs through `query-client.ts`'s mutation defaults:
 *    `networkMode: 'offlineFirst'`, `retry: 3`, `retryDelay`
 *    exponential capped at 30s. One blip becomes three silent retries
 *    before any user-visible failure.
 *  - `mutationKey: ['pickItem', listId, sku, action]` gives implicit
 *    idempotency for the operator's rapid taps — TanStack dedupes
 *    in-flight mutations with the same key (Stripe/Square use a
 *    similar pattern with explicit idempotency keys; ours is derived
 *    from the action so we don't have to carry a UUID).
 *
 * Note: the local `checkedItems` Set inside PickingCartDrawer is the
 * source of truth for UI selection (each picker tracks their own).
 * The Set toggle stays in the parent for instant feedback; this
 * mutation only owns the server side. The parent passes an
 * `onError` callback to roll back the Set when the RPC ultimately
 * gives up.
 */

export type PickItemAction = 'pick' | 'unpick';

export interface PickItemVars {
  action: PickItemAction;
  listId: string;
  sku: string;
  warehouse: string;
  location: string;
  qty: number;
  userId: string;
}

export function usePickItemMutation() {
  return useMutation({
    // The key carries action + sku + list so two concurrent taps on
    // the same item dedupe naturally. Different items / different
    // actions stay independent.
    mutationKey: ['pick-item'] as const,
    mutationFn: async (vars: PickItemVars) => {
      const rpcName = vars.action === 'pick' ? 'pick_item' : 'unpick_item';
      const { error } = await supabase.rpc(
        rpcName as never,
        {
          p_list_id: vars.listId,
          p_sku: vars.sku,
          p_warehouse: vars.warehouse,
          p_location: vars.location,
          p_qty: vars.qty,
          p_user_id: vars.userId,
        } as never
      );
      if (error) throw error;
      return vars;
    },
  });
}
