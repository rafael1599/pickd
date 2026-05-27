import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useStockReservations,
  buildReservationKey,
} from '../../../picking/hooks/useStockReservations';

interface Props {
  sku: string;
  warehouse: string;
  location: string;
}

const RECENT_PICK_WINDOW_MS = 24 * 60 * 60 * 1000;

const isRecent = (iso: string | null): boolean => {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  return Date.now() - t < RECENT_PICK_WINDOW_MS;
};

/**
 * idea-105 Phase 3 — pill layout for stock holds.
 *
 *   STOCK · 13 total
 *   🟢 11 libre   🟡 2 en espera · #879999   🔴 1 salió · #879541
 *
 * Green: free units. Always shown when free > 0.
 * Amber: per-order reserved (picked=false). Tap → navigate to /orders.
 * Red:   per-order picked within last 24h (older picks fade silently). Tap → navigate.
 *
 * Section hides entirely when nothing to show (no reserved + no recent picked).
 */
export const StockReservationBreakdown: React.FC<Props> = ({ sku, warehouse, location }) => {
  const navigate = useNavigate();
  const key = buildReservationKey(sku, warehouse, location);
  const { data } = useStockReservations(sku && warehouse && location ? [key] : [], null);
  const info = data?.get(key);

  if (!info) return null;

  const free = Math.max(0, info.stock - info.reserved);
  const reservedOrders = info.reservingOrders
    .filter((o) => !o.picked)
    .sort((a, b) => (b.qty || 0) - (a.qty || 0));
  const recentPickedOrders = info.reservingOrders
    .filter((o) => o.picked && isRecent(o.pickedAt))
    .sort((a, b) => (b.qty || 0) - (a.qty || 0));

  if (reservedOrders.length === 0 && recentPickedOrders.length === 0) return null;

  const openOrder = (orderNumber: string) => {
    if (!orderNumber) return;
    navigate(`/orders?o=${encodeURIComponent(orderNumber)}`);
  };

  return (
    <div className="px-4 py-3 border-t border-subtle">
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-[10px] font-black text-muted uppercase tracking-widest">Stock</span>
        <span className="text-[10px] text-muted">·</span>
        <span className="text-[11px] font-bold text-content">{info.stock} total</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {free > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            {free} free
          </span>
        )}
        {reservedOrders.map((o) => (
          <button
            type="button"
            key={`r-${o.listId}`}
            onClick={() => openOrder(o.orderNumber)}
            title={o.customerName ?? undefined}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 active:scale-95 transition-all"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            {o.qty} reserved · #{o.orderNumber}
            {o.isWaiting && <span className="text-[9px] uppercase opacity-70">waiting</span>}
          </button>
        ))}
        {recentPickedOrders.map((o) => (
          <button
            type="button"
            key={`p-${o.listId}`}
            onClick={() => openOrder(o.orderNumber)}
            title={o.customerName ?? undefined}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-bold bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25 active:scale-95 transition-all"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
            {o.qty} picked · #{o.orderNumber}
          </button>
        ))}
      </div>
    </div>
  );
};
