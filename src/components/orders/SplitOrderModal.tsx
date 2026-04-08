import React, { useMemo, useState } from 'react';
import { useScrollLock } from '../../hooks/useScrollLock';
import X from 'lucide-react/dist/esm/icons/x';
import Scissors from 'lucide-react/dist/esm/icons/scissors';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import type { Json } from '../../integrations/supabase/types';
import type { CombineMeta, PickingList, PickingListItem } from '../../schemas/picking.schema';

interface SplitOrder extends PickingList {
  combine_meta: CombineMeta;
}

interface SplitOrderModalProps {
  order: SplitOrder;
  onClose: () => void;
  onSplitComplete: () => void;
}

export const SplitOrderModal: React.FC<SplitOrderModalProps> = ({
  order,
  onClose,
  onSplitComplete,
}) => {
  useScrollLock(true, onClose);
  const [isSplitting, setIsSplitting] = useState(false);

  const combineMeta: CombineMeta = order.combine_meta;
  const sourceOrders = combineMeta?.source_orders || [];

  // Group items by source_order
  const groupedItems = useMemo(() => {
    const items: (PickingListItem & { source_order?: string })[] = order.items || [];
    const groups: Record<string, (PickingListItem & { source_order?: string })[]> = {};

    for (const item of items) {
      const source = item.source_order || 'unknown';
      if (!groups[source]) groups[source] = [];
      groups[source].push(item);
    }

    return groups;
  }, [order.items]);

  const handleSplit = async () => {
    if (sourceOrders.length < 2) return;

    setIsSplitting(true);
    try {
      // Create individual orders for each source
      for (const source of sourceOrders) {
        const orderNum = source.order_number;
        const items = (groupedItems[orderNum] || []).map(
          (item: PickingListItem & { source_order?: string }) => {
            const { source_order: _SOURCE, ...rest } = item;
            return rest;
          }
        );

        if (items.length === 0) continue;

        await supabase.from('picking_lists').insert({
          user_id: order.user_id!,
          order_number: orderNum,
          status: 'ready_to_double_check',
          source: order.source ?? 'pdf_import',
          is_addon: false,
          items: items as unknown as Json,
          customer_id: order.customer_id,
          combine_meta: null,
        });
      }

      // Cancel the combined order
      await supabase.from('picking_lists').update({ status: 'cancelled' }).eq('id', order.id);

      toast.success(`Split into ${sourceOrders.length} separate orders`);
      onSplitComplete();
    } catch (err) {
      console.error('Split failed:', err);
      toast.error('Failed to split orders');
    } finally {
      setIsSplitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-card border border-subtle rounded-3xl w-full max-w-lg max-h-[80vh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-subtle">
          <div className="flex items-center gap-2">
            <Scissors size={16} className="text-blue-400" />
            <h3 className="text-sm font-black uppercase tracking-widest text-content">
              Split Combined Order
            </h3>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-surface transition-all"
          >
            <X size={16} className="text-muted" />
          </button>
        </div>

        {/* Source Orders Preview */}
        <div className="p-5 space-y-4">
          {sourceOrders.map((source, i) => {
            const items = groupedItems[source.order_number] || [];
            return (
              <div key={i} className="p-4 bg-surface border border-subtle rounded-2xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono font-black text-lg text-content">
                    #{source.order_number}
                  </span>
                  <span className="text-[10px] font-bold text-muted uppercase tracking-wider">
                    {items.length} items
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {items.map((item, j: number) => (
                    <span
                      key={j}
                      className="text-[10px] font-mono bg-main px-2 py-0.5 rounded-lg text-muted border border-subtle"
                    >
                      {item.sku} x{item.pickingQty}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}

          {/* Items without source_order */}
          {groupedItems['unknown'] && groupedItems['unknown'].length > 0 && (
            <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl space-y-2">
              <span className="text-xs font-bold text-amber-400">
                Untagged items (will stay in first order)
              </span>
              <div className="flex flex-wrap gap-1">
                {groupedItems['unknown'].map(
                  (item: { sku: string; pickingQty: number }, j: number) => (
                    <span
                      key={j}
                      className="text-[10px] font-mono bg-main px-2 py-0.5 rounded-lg text-muted"
                    >
                      {item.sku} x{item.pickingQty}
                    </span>
                  )
                )}
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="p-5 border-t border-subtle flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 bg-surface border border-subtle rounded-2xl text-[10px] font-black uppercase tracking-widest text-muted transition-all active:scale-95"
          >
            Cancel
          </button>
          <button
            onClick={handleSplit}
            disabled={isSplitting || sourceOrders.length < 2}
            className="flex-1 py-3 bg-blue-500 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isSplitting ? (
              'Splitting...'
            ) : (
              <>
                <Scissors size={12} />
                Split into {sourceOrders.length} Orders
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
