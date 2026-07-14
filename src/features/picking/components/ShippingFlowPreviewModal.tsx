import React, { useMemo, useState } from 'react';
import X from 'lucide-react/dist/esm/icons/x';
import Check from 'lucide-react/dist/esm/icons/check';
import Layers3 from 'lucide-react/dist/esm/icons/layers-3';
import Columns2 from 'lucide-react/dist/esm/icons/columns-2';
import Truck from 'lucide-react/dist/esm/icons/truck';
import Clock3 from 'lucide-react/dist/esm/icons/clock-3';
import { TransportLogo } from '../../../components/orders/TransportLogo';

export interface ShippingPreviewOrder {
  id: string;
  orderNumber: string | null;
  customerName: string | null;
  transportCompany: string | null;
  palletsQty: number | null;
  totalUnits: number | null;
  createdAt: string;
  delayedDays: number;
}

interface ShippingFlowPreviewModalProps {
  orders: ShippingPreviewOrder[];
  onClose: () => void;
}

type PreviewVariant = 'queue' | 'split';

function orderMeta(order: ShippingPreviewOrder) {
  const pallets = order.palletsQty ?? 0;
  const units = order.totalUnits ?? 0;
  if (pallets > 0) return `${pallets} pallet${pallets === 1 ? '' : 's'} · ${units} units`;
  return `${units} units`;
}

function byDay(order: ShippingPreviewOrder) {
  return order.delayedDays > 0 ? 'delayed' : 'today';
}

export const ShippingFlowPreviewModal: React.FC<ShippingFlowPreviewModalProps> = ({
  orders,
  onClose,
}) => {
  const [variant, setVariant] = useState<PreviewVariant>('queue');
  const [activeIds, setActiveIds] = useState<Set<string>>(new Set(orders.map((o) => o.id)));

  const todayOrders = useMemo(() => orders.filter((o) => byDay(o) === 'today'), [orders]);
  const delayedOrders = useMemo(() => orders.filter((o) => byDay(o) === 'delayed'), [orders]);

  const toggle = (id: string) => {
    setActiveIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderCard = (order: ShippingPreviewOrder) => {
    const isActive = activeIds.has(order.id);
    return (
      <button
        key={order.id}
        type="button"
        onClick={() => toggle(order.id)}
        className={`w-full rounded-3xl border p-4 md:p-5 text-left transition-all ${
          isActive
            ? 'border-accent bg-accent/10 shadow-lg shadow-accent/5'
            : 'border-subtle bg-card opacity-55'
        }`}
      >
        <div className="grid grid-cols-[1fr_auto] md:grid-cols-[1fr_8.5rem_auto] items-start gap-4 md:gap-5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-lg md:text-xl font-black text-content">
                #{order.orderNumber || '—'}
              </span>
              {order.delayedDays > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-amber-400">
                  <Clock3 size={10} />
                  Delayed {order.delayedDays}d
                </span>
              )}
              {!isActive && (
                <span className="inline-flex items-center rounded-full bg-muted/10 border border-subtle px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-muted">
                  Not shipping now
                </span>
              )}
            </div>
            <p className="mt-2 text-base md:text-lg font-bold text-content truncate">
              {order.customerName || 'Unknown customer'}
            </p>
            <div className="mt-2 flex items-center gap-3 flex-wrap text-sm font-bold text-muted">
              <span>{orderMeta(order)}</span>
            </div>
          </div>

          <div className="hidden md:flex h-full min-h-[5.5rem] w-[8.5rem] shrink-0 items-center justify-center rounded-3xl border border-subtle bg-main/50 px-3">
            {order.transportCompany ? (
              <TransportLogo company={order.transportCompany} height={34} plain />
            ) : (
              <span className="text-[10px] font-black uppercase tracking-widest text-muted">
                No carrier
              </span>
            )}
          </div>

          <div className="flex flex-col items-end gap-2 shrink-0">
            <div
              className={`w-8 h-8 rounded-2xl border flex items-center justify-center ${
                isActive
                  ? 'bg-accent text-main border-accent'
                  : 'bg-bg-main text-muted border-subtle'
              }`}
            >
              <Check size={16} />
            </div>
            <div className="md:hidden rounded-2xl border border-subtle bg-main/50 px-2.5 py-2 min-w-[5.5rem] flex items-center justify-center">
              {order.transportCompany ? (
                <TransportLogo company={order.transportCompany} height={22} plain />
              ) : (
                <span className="text-[9px] font-black uppercase tracking-widest text-muted">
                  No carrier
                </span>
              )}
            </div>
          </div>
        </div>
      </button>
    );
  };

  const selectedCount = activeIds.size;
  const selectedToday = todayOrders.filter((o) => activeIds.has(o.id)).length;
  const selectedDelayed = delayedOrders.filter((o) => activeIds.has(o.id)).length;

  return (
    <div className="fixed inset-0 z-[140] bg-main/80 backdrop-blur-xl">
      <div className="absolute inset-0 flex flex-col">
        <div className="px-4 md:px-8 py-4 border-b border-subtle bg-main/90 backdrop-blur-xl flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl md:text-2xl font-black tracking-tight text-content">
              Start Shipping
            </h2>
            <p className="text-xs md:text-sm font-bold text-muted mt-1">
              Preview concept — all eligible orders are pre-selected. Deselect any order that did
              not ship.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setVariant('queue')}
              className={`inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-xs font-black uppercase tracking-widest border transition-all ${
                variant === 'queue'
                  ? 'bg-accent text-main border-accent'
                  : 'bg-card text-content border-subtle'
              }`}
            >
              <Layers3 size={14} />
              View A
            </button>
            <button
              type="button"
              onClick={() => setVariant('split')}
              className={`inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-xs font-black uppercase tracking-widest border transition-all ${
                variant === 'split'
                  ? 'bg-accent text-main border-accent'
                  : 'bg-card text-content border-subtle'
              }`}
            >
              <Columns2 size={14} />
              View B
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-11 h-11 rounded-2xl border border-subtle bg-card text-content flex items-center justify-center"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6">
          {variant === 'queue' ? (
            <div className="max-w-5xl mx-auto space-y-4">
              <div className="mb-2">
                <h3 className="text-sm font-black uppercase tracking-widest text-muted">
                  View A · Shipping Queue
                </h3>
              </div>
              {orders.map(renderCard)}
            </div>
          ) : (
            <div className="max-w-7xl mx-auto grid grid-cols-1 xl:grid-cols-2 gap-6">
              <section className="rounded-3xl border border-subtle bg-card p-4 md:p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-black uppercase tracking-widest text-content">
                      Today
                    </h3>
                    <p className="text-xs font-bold text-muted mt-1">Orders shipping today</p>
                  </div>
                  <span className="text-xs font-black uppercase tracking-widest text-accent">
                    {todayOrders.length}
                  </span>
                </div>
                <div className="space-y-3">
                  {todayOrders.length > 0 ? (
                    todayOrders.map(renderCard)
                  ) : (
                    <p className="text-sm text-muted">No today orders.</p>
                  )}
                </div>
              </section>

              <section className="rounded-3xl border border-amber-500/20 bg-amber-500/5 p-4 md:p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-black uppercase tracking-widest text-amber-300">
                      Delayed
                    </h3>
                    <p className="text-xs font-bold text-muted mt-1">
                      Orders from previous days still pending shipment
                    </p>
                  </div>
                  <span className="text-xs font-black uppercase tracking-widest text-amber-400">
                    {delayedOrders.length}
                  </span>
                </div>
                <div className="space-y-3">
                  {delayedOrders.length > 0 ? (
                    delayedOrders.map(renderCard)
                  ) : (
                    <p className="text-sm text-muted">No delayed orders.</p>
                  )}
                </div>
              </section>
            </div>
          )}
        </div>

        <div className="px-4 md:px-8 py-4 border-t border-subtle bg-main/95 backdrop-blur-xl flex items-center justify-between gap-4">
          <div className="text-sm font-black text-content flex flex-wrap items-center gap-2 md:gap-3">
            <span>{selectedCount} selected</span>
            <span className="text-muted">·</span>
            <span>{selectedToday} today</span>
            <span className="text-muted">·</span>
            <span>{selectedDelayed} delayed</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setActiveIds(new Set())}
              className="px-4 py-3 rounded-2xl border border-subtle bg-card text-content text-xs font-black uppercase tracking-widest"
            >
              Clear all
            </button>
            <button
              type="button"
              onClick={() => setActiveIds(new Set(orders.map((o) => o.id)))}
              className="px-4 py-3 rounded-2xl border border-subtle bg-card text-content text-xs font-black uppercase tracking-widest"
            >
              Reselect all
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-accent text-main text-xs font-black uppercase tracking-widest shadow-lg shadow-accent/20"
            >
              <Truck size={14} />
              Ship selected ({selectedCount})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
