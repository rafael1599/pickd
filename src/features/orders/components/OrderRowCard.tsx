import React, { useMemo, useState } from 'react';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import Tag from 'lucide-react/dist/esm/icons/tag';
import Printer from 'lucide-react/dist/esm/icons/printer';
import { PhotoLightbox } from '../../../components/ui/PhotoLightbox';
import { computeBikesParts, isFedexOrder, type OrderRow } from '../hooks/useOrdersOfDay';
import { printOrderDetail } from '../lib/printOrderDetail';
import { OrderNotes } from './OrderNotes';
import { TransportLogo } from '../../../components/orders/TransportLogo';

interface OrderRowCardProps {
  order: OrderRow;
  skuIsBike: Record<string, boolean>;
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

/** `Jul 8 · 12:48 PM` style timestamp. */
function formatDateTime(source: string | null): string {
  if (!source) return '—';
  const d = new Date(source);
  if (Number.isNaN(d.getTime())) return '—';
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${date} · ${time}`;
}

/** A small inline summary chip. */
const Chip: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="text-[11px] font-black uppercase tracking-wider bg-surface border border-subtle rounded-full px-2.5 py-1 text-content/80">
    {children}
  </span>
);

export const OrderRowCard: React.FC<OrderRowCardProps> = ({
  order,
  skuIsBike,
  expanded,
  onToggle,
  onEditLabel,
}) => {
  const units = getOrderUnits(order);
  const fedex = isFedexOrder(order);
  const statusPill = getStatusPill(order.status);
  const displayNumber = order.order_number || order.id.slice(-6);

  const items = order.items ?? [];
  const { bikes, parts } = useMemo(() => computeBikesParts(order, skuIsBike), [order, skuIsBike]);

  const photos = order.pallet_photos ?? [];
  const [lightboxIndex, setLightboxIndex] = useState(-1);

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
          {/* Summary chips */}
          {((order.pallets_qty ?? 0) > 0 ||
            bikes > 0 ||
            parts > 0 ||
            (order.total_weight_lbs ?? 0) > 0 ||
            order.transport_company ||
            order.load_number) && (
            <div className="flex flex-wrap gap-1.5">
              {(order.pallets_qty ?? 0) > 0 && <Chip>Pallets: {order.pallets_qty}</Chip>}
              {bikes > 0 && <Chip>Bikes: {bikes}</Chip>}
              {parts > 0 && <Chip>Parts: {parts}</Chip>}
              {(order.total_weight_lbs ?? 0) > 0 && (
                <Chip>Weight: {order.total_weight_lbs} lbs</Chip>
              )}
              {order.transport_company && (
                <TransportLogo
                  company={order.transport_company}
                  height={16}
                  className="border border-subtle"
                />
              )}
              {order.load_number && <Chip>Load #: {order.load_number}</Chip>}
            </div>
          )}

          {/* Ship-to (left) + details (right) */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
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
            <div className="text-xs text-muted space-y-0.5 shrink-0 sm:text-right">
              <div>
                <span className="font-black uppercase tracking-widest text-muted/50">
                  Updated:{' '}
                </span>
                {formatDateTime(order.updated_at)}
              </div>
              {order.user?.full_name && <div>Picked by {order.user.full_name}</div>}
              {order.checker?.full_name && <div>Checked by {order.checker.full_name}</div>}
            </div>
          </div>

          {/* Order notes (AS400 own notes) */}
          {order.notes && (
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-muted/50 mb-1">
                Order notes
              </p>
              <div className="text-xs text-content bg-surface border border-subtle rounded-lg px-3 py-2 whitespace-pre-wrap">
                {order.notes}
              </div>
            </div>
          )}

          {/* Our in-app notes (mounted only while expanded) */}
          <OrderNotes listId={order.id} />

          {/* Pallet photos */}
          {photos.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {photos.map((url, idx) => (
                <button
                  key={idx}
                  onClick={() => setLightboxIndex(idx)}
                  className="aspect-square w-full rounded-lg overflow-hidden border border-subtle bg-surface"
                >
                  <img src={url} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}

          {/* Line items */}
          <div className="-mx-3 overflow-x-auto">
            <table className="w-full min-w-[520px] text-xs">
              <thead>
                <tr className="text-[10px] font-black uppercase tracking-widest text-muted/50 border-b border-subtle">
                  <th className="text-right py-2 px-2 w-12">Qty</th>
                  <th className="text-left py-2 px-2">SKU</th>
                  <th className="text-left py-2 px-2">Description</th>
                  <th className="text-left py-2 px-2">Location</th>
                  <th className="text-left py-2 px-2">Sublocation</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => {
                  const qty = item.pickingQty ?? 0;
                  const sublocation = (item.sublocation ?? []).join('') || '—';
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
                      <td className="text-left py-2 px-2 font-mono text-content/80">
                        {item.location || '—'}
                      </td>
                      <td className="text-left py-2 px-2 font-mono text-content/80">
                        {sublocation}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Buttons row */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => printOrderDetail(order, { bikes, parts })}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-surface text-content border border-subtle hover:border-accent/40 transition-colors text-[11px] font-black uppercase tracking-wider"
            >
              <Printer size={14} />
              Print
            </button>
            <button
              onClick={onEditLabel}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-colors text-[11px] font-black uppercase tracking-wider"
            >
              <Tag size={14} />
              Edit Label
            </button>
          </div>
        </div>
      )}

      {lightboxIndex >= 0 && (
        <PhotoLightbox
          photos={photos}
          index={lightboxIndex}
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxIndex(-1)}
        />
      )}
    </div>
  );
};
