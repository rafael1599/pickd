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
  /**
   * Bike/part and unit weight per line (ShipScreen's metaForItem). Every line
   * shows its weight — the operator asked to see, on every order, what each
   * bike weighs, after a combined bike was priced as a part (bug-021).
   */
  lineMeta?: (item: PickingListItem) => { is_bike: boolean; weight_lbs: number | null };
  /** Tapping a SKU opens its Item Detail (idea-165). */
  onSkuClick?: (item: PickingListItem) => void;
}

export const OrderItemsTable: React.FC<OrderItemsTableProps> = ({
  order,
  bikeCount,
  partCount,
  activeOrderFilter = null,
  lineMeta,
  onSkuClick,
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
              {lineMeta && <th className="py-2.5 px-4 font-mono w-20 text-right">Lbs</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-subtle/50 text-content">
            {items.length === 0 ? (
              <tr>
                <td
                  colSpan={lineMeta ? 6 : 5}
                  className="py-6 text-center text-muted font-medium text-xs"
                >
                  No items listed for this order
                </td>
              </tr>
            ) : (
              items.map((item, idx) => {
                const qty = item.pickingQty ?? item.quantity ?? 1;
                // Orders stored before the schema settled carry raw_sku and
                // description instead of sku and item_name.
                const legacy = item as typeof item & {
                  raw_sku?: string | null;
                  description?: string | null;
                };
                const sku = item.sku || legacy.raw_sku || '—';
                const desc = legacy.description || item.item_name || '—';
                const location = item.location || '—';
                const sublocRaw = item.sublocation;
                const sublocation = Array.isArray(sublocRaw)
                  ? sublocRaw.join('')
                  : sublocRaw || '—';
                const meta = lineMeta?.(item);
                const unitLbs = meta?.weight_lbs ?? null;
                const lineLbs = unitLbs == null ? null : Math.round(unitLbs * qty * 10) / 10;
                return (
                  <tr key={`${sku}-${idx}`} className="hover:bg-main/30 transition-colors">
                    <td className="py-2.5 px-4 font-mono font-bold text-right text-accent">
                      {qty}
                    </td>
                    <td className="py-2.5 px-4 font-mono font-black tracking-tight">
                      {onSkuClick && item.sku ? (
                        <button
                          type="button"
                          onClick={() => onSkuClick(item)}
                          className="text-accent hover:underline underline-offset-2 active:opacity-70"
                          title="Open item detail"
                        >
                          {sku}
                        </button>
                      ) : (
                        sku
                      )}
                    </td>
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
                    {lineMeta && (
                      <td
                        className={`py-2.5 px-4 font-mono font-semibold text-right ${
                          lineLbs == null
                            ? 'text-amber-500'
                            : meta?.is_bike
                              ? 'text-content'
                              : 'text-muted/80'
                        }`}
                        title={
                          lineLbs == null
                            ? 'No weight on file'
                            : qty > 1
                              ? `${unitLbs} lb each × ${qty}`
                              : `${unitLbs} lb`
                        }
                      >
                        {lineLbs == null ? '?' : lineLbs}
                      </td>
                    )}
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
