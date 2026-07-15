import React, { useMemo, useState, useEffect } from 'react';
import Search from 'lucide-react/dist/esm/icons/search';
import X from 'lucide-react/dist/esm/icons/x';
import Check from 'lucide-react/dist/esm/icons/check';
import Truck from 'lucide-react/dist/esm/icons/truck';
import Clock3 from 'lucide-react/dist/esm/icons/clock-3';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle';
import { TransportLogo } from '../../../components/orders/TransportLogo';
import { supabase } from '../../../lib/supabase';

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
  onConfirm: (ids: string[]) => Promise<void> | void;
  isSubmitting?: boolean;
}

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
  onConfirm,
  isSubmitting = false,
}) => {
  const [activeIds, setActiveIds] = useState<Set<string>>(new Set(orders.map((o) => o.id)));
  const [searchQuery, setSearchQuery] = useState('');

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

  const filteredOrders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((order) => {
      const orderNum = String(order.orderNumber || '').toLowerCase();
      const customer = String(order.customerName || '').toLowerCase();
      return orderNum.includes(q) || customer.includes(q);
    });
  }, [orders, searchQuery]);

  const [dbSearchStatus, setDbSearchStatus] = useState<
    'idle' | 'searching' | 'found' | 'not_found'
  >('idle');
  const [dbSearchResult, setDbSearchResult] = useState<{
    order_number: string | null;
    status: string | null;
    is_shipped: boolean | null;
  } | null>(null);

  useEffect(() => {
    const q = searchQuery.trim();
    if (!q || filteredOrders.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDbSearchStatus('idle');

      setDbSearchResult(null);
      return;
    }

    if (q.length < 3) {
      setDbSearchStatus('idle');

      setDbSearchResult(null);
      return;
    }

    let isMounted = true;
    setDbSearchStatus('searching');

    const searchDb = async () => {
      const { data, error } = await supabase
        .from('picking_lists')
        .select('order_number, status, is_shipped')
        .ilike('order_number', `%${q}%`)
        .limit(1)
        .maybeSingle();

      if (!isMounted) return;

      if (error || !data) {
        setDbSearchStatus('not_found');
        setDbSearchResult(null);
      } else {
        setDbSearchStatus('found');
        setDbSearchResult(data);
      }
    };

    const timer = setTimeout(searchDb, 500);
    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [searchQuery, filteredOrders.length]);

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
              onClick={onClose}
              className="w-11 h-11 rounded-2xl border border-subtle bg-card text-content flex items-center justify-center"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6">
          <div className="max-w-5xl mx-auto space-y-4">
            <div className="mb-2 space-y-3">
              <h3 className="text-sm font-black uppercase tracking-widest text-muted">
                Shipping Queue
              </h3>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Find an order in Start Shipping..."
                  className="w-full rounded-2xl border border-subtle bg-card pl-9 pr-3 py-3 text-sm font-semibold text-content focus:outline-none focus:border-accent"
                />
              </div>
            </div>
            {filteredOrders.length > 0 ? (
              filteredOrders.map(renderCard)
            ) : (
              <div className="rounded-3xl border border-subtle bg-card px-4 py-10 text-center flex flex-col items-center justify-center gap-4">
                {dbSearchStatus === 'searching' ? (
                  <>
                    <Loader2 size={24} className="text-accent animate-spin" />
                    <p className="text-sm font-bold text-muted">
                      Searching database for "{searchQuery}"...
                    </p>
                  </>
                ) : dbSearchStatus === 'found' && dbSearchResult ? (
                  <>
                    <div className="w-12 h-12 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center">
                      <AlertCircle size={24} className="text-accent" />
                    </div>
                    <div className="space-y-1.5">
                      <p className="text-base font-black text-content">
                        Order #{dbSearchResult.order_number ?? '—'} found in database
                      </p>
                      <p className="text-sm font-bold text-muted">
                        Status:{' '}
                        <span className="uppercase tracking-widest px-2 py-0.5 rounded-full bg-muted/10 border border-subtle">
                          {(dbSearchResult.status ?? 'unknown').replace(/_/g, ' ')}
                        </span>
                      </p>
                      {dbSearchResult.is_shipped && (
                        <p className="text-sm font-black text-emerald-400 mt-2">
                          ✓ This order has already been shipped.
                        </p>
                      )}
                      {!dbSearchResult.is_shipped && dbSearchResult.status !== 'ready_to_ship' && (
                        <p className="text-sm font-bold text-amber-400 mt-2">
                          This order is not ready to ship yet.
                        </p>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="text-sm font-bold text-muted">
                    No orders match that search locally or in the database.
                  </p>
                )}
              </div>
            )}
          </div>
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
              disabled={selectedCount === 0 || isSubmitting}
              onClick={() => void onConfirm(Array.from(activeIds))}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-accent text-main text-xs font-black uppercase tracking-widest shadow-lg shadow-accent/20 disabled:opacity-50"
            >
              <Truck size={14} />
              {isSubmitting ? 'Shipping…' : `Ship selected (${selectedCount})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
