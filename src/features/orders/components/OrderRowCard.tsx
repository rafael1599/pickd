import React, { useMemo } from 'react';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import Tag from 'lucide-react/dist/esm/icons/tag';
import { isFedexOrder, type OrderRow } from '../hooks/useOrdersOfDay';

interface OrderRowCardProps {
  order: OrderRow;
  expanded: boolean;
  onToggle: () => void;
  onEditLabel: () => void;
}

/** Sum of pickingQty across items, falling back to total_units. */
function getOrderUnits(order: OrderRow): number {
  const items = order.items;
  if (Array.isArray(items) && items.length > 0) {
    const sum = items.reduce((acc, i) => acc + (i.pickingQty || 0), 0);
    if (sum > 0) return sum;
  }
  return order.total_units ?? 0;
}

/** Small color language for the status pill (mirrors SortableOrderCard). */
function getStatusPill(status: string): { label: string; className: string } | null {
  switch (status) {
    case 'needs_correction':
      return {
        label: 'Needs Correction',
        className: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
      };
    case 'double_checking':
      return {
        label: 'Checking',
        className: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
      };
    case 'completed':
      return {
        label: 'Completed',
        className: 'bg-accent/10 text-accent border-accent/20',
      };
    default:
      return null;
  }
}

function formatPrice(value: number | null | undefined): string {
  if (value == null || value === 0) return '—';
  return `$${value.toFixed(2)}`;
}

function formatOrderDate(source: string | null): string {
  if (!source) return '—';
  const d = new Date(source);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString();
}

export const OrderRowCard: React.FC<OrderRowCardProps> = ({
  order,
  expanded,
  onToggle,
  onEditLabel,
}) => {
  const units = getOrderUnits(order);
  const fedex = isFedexOrder(order);
  const statusPill = getStatusPill(order.status);
  const displayNumber = order.order_number || order.id.slice(-6);

  const items = order.items ?? [];
  const total = useMemo(
    () =>
      items.reduce((sum, i) => {
        const price = i.unit_price ?? 0;
        const qty = i.pickingQty ?? 0;
        if (price > 0) return sum + price * qty;
        return sum;
      }, 0),
    [items]
  );

  const shippingLabel = fedex ? 'FedEx' : 'Freight / Truck';

  return (
    <div className="rounded-xl border border-subtle bg-surface overflow-hidden">
      {/* Collapsed header — whole thing toggles */}
      <div className="flex items-stretch">
        <button
          onClick={onToggle}
          className="flex-1 flex items-center justify-between gap-3 py-3 px-3 text-left group"
        >
          <div className="min-w-0">
            <div className="text-lg font-black uppercase tracking-tight text-content flex items-center gap-1.5 flex-wrap">
              #{displayNumber}
              <span
                className={`text-[10px] ${fedex ? 'bg-purple-500' : 'bg-emerald-500'} text-white px-1.5 py-0.5 rounded font-black uppercase tracking-wider`}
              >
                {fedex ? 'FDX' : 'TRK'}
              </span>
              {statusPill && (
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded border font-black uppercase tracking-wider ${statusPill.className}`}
                >
                  {statusPill.label}
                </span>
              )}
            </div>
            <div className="text-sm text-muted font-bold uppercase tracking-wider mt-1 flex items-center gap-2.5 min-w-0">
              <span className="truncate max-w-[200px] normal-case tracking-normal text-content/80">
                {order.customer?.name || 'No customer'}
              </span>
              {units > 0 && (
                <span className="text-muted/80 shrink-0">
                  {units} {units === 1 ? 'unit' : 'units'}
                </span>
              )}
            </div>
          </div>
          <ChevronDown
            size={20}
            className={`text-subtle group-hover:text-accent transition-transform shrink-0 ${expanded ? 'rotate-180' : ''}`}
          />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEditLabel();
          }}
          className="flex items-center gap-1.5 px-3 my-2 mr-2 rounded-lg bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-colors text-[11px] font-black uppercase tracking-wider shrink-0"
          title="Edit shipping label"
        >
          <Tag size={14} />
          <span className="hidden sm:inline">Edit Label</span>
        </button>
      </div>

      {/* Expanded packing-slip detail */}
      {expanded && (
        <div className="border-t border-subtle px-3 py-4 space-y-4 bg-main/30">
          {/* Ship-to */}
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-muted/50 mb-1">
              Ship To
            </p>
            <div className="text-sm text-content">
              <div className="font-bold">{order.customer?.name || '—'}</div>
              {order.customer?.street && <div>{order.customer.street}</div>}
              <div>
                {[order.customer?.city, order.customer?.state, order.customer?.zip_code]
                  .filter(Boolean)
                  .join(', ')}
              </div>
              {order.customer?.phone && <div className="text-muted">{order.customer.phone}</div>}
            </div>
          </div>

          {/* Meta line */}
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
            <span>
              <span className="font-black uppercase tracking-widest text-muted/50">
                Order Date:{' '}
              </span>
              {formatOrderDate(order.source_order_date)}
            </span>
            <span>
              <span className="font-black uppercase tracking-widest text-muted/50">Shipping: </span>
              {shippingLabel}
            </span>
            <span>
              <span className="font-black uppercase tracking-widest text-muted/50">Units: </span>
              {units}
            </span>
          </div>

          {/* AS400 notes */}
          {order.notes && (
            <div className="text-xs text-content bg-surface border border-subtle rounded-lg px-3 py-2 whitespace-pre-wrap">
              {order.notes}
            </div>
          )}

          {/* Line items */}
          <div className="-mx-3 overflow-x-auto">
            <table className="w-full min-w-[480px] text-xs">
              <thead>
                <tr className="text-[10px] font-black uppercase tracking-widest text-muted/50 border-b border-subtle">
                  <th className="text-right py-2 px-2 w-12">Qty</th>
                  <th className="text-left py-2 px-2">SKU</th>
                  <th className="text-left py-2 px-2">Description</th>
                  <th className="text-right py-2 px-2">Price</th>
                  <th className="text-right py-2 px-2">Extended</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => {
                  const qty = item.pickingQty ?? 0;
                  const price = item.unit_price ?? 0;
                  const extended = price > 0 ? price * qty : null;
                  return (
                    <tr key={idx} className="border-b border-subtle/50 last:border-0">
                      <td className="text-right py-2 px-2 font-mono font-bold text-content">
                        {qty}
                      </td>
                      <td className="text-left py-2 px-2 font-mono text-content">
                        {item.sku || item.raw_sku || '—'}
                      </td>
                      <td className="text-left py-2 px-2 text-content/80">
                        {item.description || item.item_name || '—'}
                      </td>
                      <td className="text-right py-2 px-2 font-mono text-content">
                        {formatPrice(item.unit_price)}
                      </td>
                      <td className="text-right py-2 px-2 font-mono text-content">
                        {extended != null ? `$${extended.toFixed(2)}` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {total > 0 && (
                <tfoot>
                  <tr className="border-t border-subtle font-black">
                    <td
                      colSpan={4}
                      className="text-right py-2 px-2 uppercase tracking-widest text-[10px] text-muted"
                    >
                      Total
                    </td>
                    <td className="text-right py-2 px-2 font-mono text-content">
                      ${total.toFixed(2)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
