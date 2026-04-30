import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
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
 */
export const ShippingTypeToggle: React.FC<Props> = ({ listId }) => {
  const [type, setType] = useState<ShippingType | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('picking_lists')
        .select('shipping_type')
        .eq('id', listId)
        .maybeSingle();
      if (cancelled || error || !data) return;
      const v = data.shipping_type;
      setType(v === 'fedex' || v === 'regular' ? v : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [listId]);

  const apply = async (next: ShippingType) => {
    if (busy || next === type) return;
    setBusy(true);
    const previous = type;
    setType(next); // optimistic

    const { data: row, error } = await supabase
      .from('picking_lists')
      .update({ shipping_type: next })
      .eq('id', listId)
      .select('group_id, order_group:order_groups(group_type)')
      .single();

    if (error) {
      setType(previous);
      toast.error('Failed to update shipping type');
      setBusy(false);
      return;
    }

    // If the group's type no longer matches, ungroup so the badge truth
    // matches the order's actual classification. The remaining siblings
    // keep the group untouched.
    const group = (row as { order_group?: { group_type?: string } | null })?.order_group;
    if (row?.group_id && group?.group_type && group.group_type !== next) {
      await supabase.from('picking_lists').update({ group_id: null }).eq('id', listId);
    }

    toast.success(next === 'fedex' ? 'Set to FedEx' : 'Set to Regular');
    setBusy(false);
  };

  const baseBtn =
    'text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-full border transition-colors';

  return (
    <div className="flex items-center gap-1" title="Shipping type">
      <button
        onClick={() => apply('fedex')}
        disabled={busy}
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
        disabled={busy}
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
