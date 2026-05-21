import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { withSupabaseRetry } from '../../../lib/supabaseRetry';
import toast from 'react-hot-toast';

type ShippingType = 'fedex' | 'regular';

interface Props {
  listId: string;
}

/**
 * Manual shipping_type override for the order being double-checked.
 * Lets the verifier flip FDX ↔ TRK without leaving the view — needed
 * because the BEFORE-INSERT auto-classify (idea-057) freezes the type
 * at intake time when only 1 item exists, and never re-runs as items
 * are added.
 *
 * Side-effect: if the order is in a group whose type no longer matches,
 * remove it from the group so the FDX/GRP badge stops lying.
 *
 * Optimistic-update pattern (idea-112 #2):
 *   - `useMutation` so the update inherits the project's
 *     networkMode/retry/backoff defaults from query-client.ts.
 *   - `onMutate` captures the pre-flight `type` in the mutation
 *     context — this is the formal snapshot that `onError` rolls
 *     back from (previously the rollback used a captured `previous`
 *     local var, which is fine in practice but isn't covered by
 *     TanStack's failure semantics if the mutation throws after
 *     dispatching but before resolving).
 *   - `mutationKey: ['shipping-type', listId]` dedupes concurrent
 *     taps on the toggle without an explicit lock.
 */
export const ShippingTypeToggle: React.FC<Props> = ({ listId }) => {
  const [type, setType] = useState<ShippingType | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await withSupabaseRetry(
        () => supabase.from('picking_lists').select('shipping_type').eq('id', listId).maybeSingle(),
        { label: 'ShippingTypeToggle.load' }
      );
      if (cancelled || error || !data) return;
      const v = data.shipping_type;
      setType(v === 'fedex' || v === 'regular' ? v : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [listId]);

  const mutation = useMutation({
    mutationKey: ['shipping-type', listId],
    mutationFn: async (next: ShippingType) => {
      const { data, error } = await supabase
        .from('picking_lists')
        .update({ shipping_type: next })
        .eq('id', listId)
        .select('group_id, order_group:order_groups(group_type)')
        .single();
      if (error) throw error;

      // If the group's type no longer matches, ungroup so the badge
      // truth matches the order's actual classification. Remaining
      // siblings keep the group untouched.
      const group = (data as { order_group?: { group_type?: string } | null })?.order_group;
      if (data?.group_id && group?.group_type && group.group_type !== next) {
        await supabase.from('picking_lists').update({ group_id: null }).eq('id', listId);
      }
      return next;
    },
    onMutate: (next): { previous: ShippingType | null; next: ShippingType } => {
      // Snapshot the pre-flight value so onError can restore it even
      // if the mutation throws after dispatch.
      const previous = type;
      setType(next);
      return { previous, next };
    },
    onError: (_err, _vars, context) => {
      if (context) setType(context.previous);
      toast.error('Failed to update shipping type');
    },
    onSuccess: (next) => {
      toast.success(next === 'fedex' ? 'Set to FedEx' : 'Set to Regular');
    },
  });

  const apply = (next: ShippingType) => {
    if (mutation.isPending || next === type) return;
    mutation.mutate(next);
  };

  const baseBtn =
    'text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-full border transition-colors';

  return (
    <div className="flex items-center gap-1" title="Shipping type">
      <button
        onClick={() => apply('fedex')}
        disabled={mutation.isPending}
        className={`${baseBtn} ${
          type === 'fedex'
            ? 'bg-purple-500 text-white border-purple-500'
            : 'bg-surface text-muted border-subtle hover:text-content'
        }`}
      >
        FDX
      </button>
      <button
        onClick={() => apply('regular')}
        disabled={mutation.isPending}
        className={`${baseBtn} ${
          type === 'regular'
            ? 'bg-emerald-500 text-white border-emerald-500'
            : 'bg-surface text-muted border-subtle hover:text-content'
        }`}
      >
        TRK
      </button>
    </div>
  );
};
