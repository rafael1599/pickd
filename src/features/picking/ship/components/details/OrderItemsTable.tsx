import React from 'react';
import Printer from 'lucide-react/dist/esm/icons/printer';
import { printOrderDetail } from '../../../../orders/lib/printOrderDetail';
import type { OrderWithRelations } from '../../hooks/useShipOrdersData';
import type { OrderRow } from '../../../../orders/hooks/useOrdersOfDay';
import type { PickingListItem } from '../../../../../schemas/picking.schema';

interface OrderItemsTableProps {
  order: OrderWithRelations;
  bikeCount: number;
  partCount: number;
  /** When set (a combined order filtered to one sub-order), only that
   *  sub-order's items are shown — mirrors DoubleCheckView's pallets memo. */
  activeOrderFilter?: string | null;
}

export const OrderItemsTable: React.FC<OrderItemsTableProps> = ({
  order,
  bikeCount,
  partCount,
  activeOrderFilter = null,
}) => {
  const items = React.useMemo(() => {
    if (!order || !Array.isArray(order.items)) return [];
    return [...order.items]
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .filter((item) => {
        if (!activeOrderFilter) return true;
        return (
          (item as PickingListItem & { source_order?: string }).source_order === activeOrderFilter
        );
      })
      .sort((a, b) => {
        const locA = a.location || '';
        const locB = b.location || '';
        if (locA !== locB) return locA.localeCompare(locB, undefined, { numeric: true });
        return (a.sku || '').localeCompare(b.sku || '', undefined, { numeric: true });
      });
  }, [order, activeOrderFilter]);

  const handlePrintClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!order) return;
    try {
      void printOrderDetail(order as unknown as OrderRow, {
        bikes: bikeCount || 0,
        parts: partCount || 0,
      });
    } catch (err) {
      console.error('Failed to print order detail:', err);
    }
  };

  return (
    <div className="w-full bg-surface rounded-2xl border border-subtle overflow-hidden flex flex-col gap-0 shadow-sm mt-3">
      {/* Header */}
      <div className="px-4 py-3 border-b border-subtle flex items-center justify-between bg-card/50">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-black uppercase tracking-widest text-content">
            Order Items ({items.length})
            {activeOrderFilter && (
              <span className="text-muted normal-case tracking-normal font-semibold">
                {' '}
                — #{activeOrderFilter} only
              </span>
            )}
          </h3>
        </div>
        <button
          type="button"
          onClick={handlePrintClick}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-accent text-white text-[11px] font-black uppercase tracking-wider hover:bg-accent/90 transition-all active:scale-95 shadow-sm select-none cursor-pointer"
          title="Print Packing Slip with QR Code"
        >
          <Printer size={14} />
          <span>Print</span>
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto no-scrollbar">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-subtle bg-main/40 text-[10px] font-black uppercase tracking-wider text-muted select-none">
              <th className="py-2.5 px-4 text-right w-14">Qty</th>
              <th className="py-2.5 px-4 font-mono w-36">SKU</th>
              <th className="py-2.5 px-4">Description</th>
              <th className="py-2.5 px-4 font-mono w-28">Location</th>
              <th className="py-2.5 px-4 font-mono w-24">Sublocation</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-subtle/50 text-content">
            {items.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-6 text-center text-muted font-medium text-xs">
                  No items listed for this order
                </td>
              </tr>
            ) : (
              items.map((item, idx) => {
                const qty = item.pickingQty ?? item.quantity ?? 1;
                const sku = item.sku || item.raw_sku || '—';
                const desc = item.description || item.item_name || '—';
                const location = item.location || '—';
                const sublocRaw = item.sublocation;
                const sublocation = Array.isArray(sublocRaw)
                  ? sublocRaw.join('')
                  : sublocRaw || '—';

                return (
                  <tr key={`${sku}-${idx}`} className="hover:bg-main/30 transition-colors">
                    <td className="py-2.5 px-4 font-mono font-bold text-right text-accent">
                      {qty}
                    </td>
                    <td className="py-2.5 px-4 font-mono font-black tracking-tight">{sku}</td>
                    <td
                      className="py-2.5 px-4 font-medium text-content/90 truncate max-w-xs"
                      title={desc}
                    >
                      {desc}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-muted/90 font-semibold">
                      {location}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-muted/80 font-semibold">
                      {sublocation}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
