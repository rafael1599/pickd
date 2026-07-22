import React, { Fragment } from 'react';
import { orderColorFor } from '../../../../../utils/orderColors';
import shippedImg from '../../../../../assets/shipped.png';
import shippedFedexImg from '../../../../../assets/shipped-fedex.png';
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw';
import Truck from 'lucide-react/dist/esm/icons/truck';
import { OrderProgressBar } from '../../../components/OrderProgressBar';
import { TransportLogo } from '../../../../../components/orders/TransportLogo';
import type { OrderWithRelations } from '../../hooks/useShipOrdersData';

interface ShipFeedCardProps {
  order: OrderWithRelations;
  isSelected: boolean;
  isShippedColumn: boolean;
  isFedex: boolean;
  userId?: string | null;
  onSelect: (order: OrderWithRelations) => void;
  onUndoShip?: (order: OrderWithRelations) => void;
  onShipClick?: (order: OrderWithRelations) => void;
  onResumeWaiting?: (order: OrderWithRelations) => void;
  onOpenDoubleCheck?: (order: OrderWithRelations, action?: 'edit' | 'cancel') => void;
  onResumeReopened?: (order: OrderWithRelations) => void;
}

export const ShipFeedCard: React.FC<ShipFeedCardProps> = ({
  order,
  isSelected,
  isShippedColumn,
  isFedex,
  userId,
  onSelect,
  onUndoShip,
  onShipClick,
  onResumeWaiting,
  onOpenDoubleCheck,
  onResumeReopened,
}) => {
  const shippingStripe =
    order.transport_company === 'PICK UP'
      ? 'bg-red-500/70'
      : isFedex
        ? 'bg-purple-500/70'
        : 'bg-emerald-500/70';

  return (
    <div
      className={`w-full flex items-stretch rounded-2xl border transition-all overflow-hidden ${
        isSelected
          ? 'bg-accent/10 border-accent/30'
          : 'bg-surface border-transparent hover:border-subtle'
      }`}
    >
      <div className={`w-1.5 shrink-0 ${shippingStripe}`} />
      <div className="flex-1 flex items-center justify-between gap-2 px-3 py-2.5 min-w-0">
        <div
          className="min-w-0 flex-1 flex flex-col cursor-pointer"
          onClick={() => onSelect(order)}
        >
          <span
            className="font-mono text-sm font-black text-content flex items-center gap-1 flex-wrap"
            title={
              order.order_number?.includes(' / ')
                ? order.order_number
                    .split(' / ')
                    .map((n) => n.trim())
                    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
                    .map((n) => `#${n}`)
                    .join(', ')
                : undefined
            }
          >
            {order.order_number?.includes(' / ') ? (
              <span>
                <span className="text-muted/60">#</span>
                {order.order_number
                  .split(' / ')
                  .map((n) => n.trim())
                  .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
                  .map((num, i, arr) => (
                    <Fragment key={`${num}-${i}`}>
                      {i > 0 && <span className="text-muted/50"> / </span>}
                      <span style={{ color: orderColorFor(num.trim(), arr).hex }}>
                        {num.trim().slice(-3)}
                      </span>
                    </Fragment>
                  ))}
              </span>
            ) : (
              <>#{order.order_number}</>
            )}
          </span>

          <span className="text-[11px] text-muted truncate">{order.customer?.name || '—'}</span>
          <div className="flex flex-col gap-0.5 mt-1 text-[9px] text-muted">
            {!order.is_shipped && (
              <span>
                Created:{' '}
                {new Date(order.created_at).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
            )}
          </div>
          <OrderProgressBar
            status={order.status}
            isShipped={order.is_shipped ?? false}
            items={order.items}
            verifiedKeys={order.verified_item_keys ?? null}
            totalUnits={order.total_units || 0}
            className="mt-2 w-full"
          />
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {isShippedColumn ? (
            <img
              src={isFedex ? shippedFedexImg : shippedImg}
              alt={isFedex ? 'Shipped via FedEx' : 'Shipped'}
              className="h-7 w-auto object-contain select-none shrink-0"
            />
          ) : (
            <TransportLogo
              company={order.transport_company || (isFedex ? 'FEDEX' : null)}
              height={14}
              className="select-none shrink-0"
            />
          )}
          {isShippedColumn ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onUndoShip?.(order);
              }}
              className="p-1 rounded bg-amber-500/15 border border-amber-500/30 text-amber-500 hover:bg-amber-500 hover:text-white transition-all active:scale-95 flex items-center justify-center"
              title="Undo Shipped"
            >
              <RotateCcw size={14} />
            </button>
          ) : (
            <>
              {order.status === 'completed' ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onShipClick?.(order);
                  }}
                  className="px-2 py-1 rounded-lg bg-accent/15 border border-accent/30 text-accent hover:bg-accent hover:text-white transition-all active:scale-95 flex items-center justify-center text-[9px] font-black uppercase tracking-wider"
                  title="Mark as Shipped"
                >
                  <Truck size={14} />
                </button>
              ) : order.status === 'reopened' ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onResumeReopened?.(order);
                  }}
                  className="px-2 py-1 rounded-lg bg-orange-500/10 border border-orange-500/30 text-orange-400 hover:bg-orange-500 hover:text-white transition-all active:scale-95 flex items-center justify-center text-[9px] font-black uppercase tracking-wider"
                  title={order.user_id !== userId ? 'Take Over Order' : 'Continue Editing'}
                >
                  {order.user_id !== userId ? 'Take Over Order' : 'Continue Editing'}
                </button>
              ) : order.is_waiting_inventory ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onResumeWaiting?.(order);
                  }}
                  className="px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500 hover:text-white transition-all active:scale-95 flex items-center justify-center text-[9px] font-black uppercase tracking-wider"
                  title="Resume Order"
                >
                  Resume Order
                </button>
              ) : ['ready_to_double_check', 'double_checking'].includes(order.status) ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenDoubleCheck?.(order);
                  }}
                  className="px-2 py-1 rounded-lg bg-sky-500/10 border border-sky-500/30 text-sky-400 hover:bg-sky-500 hover:text-white transition-all active:scale-95 flex items-center justify-center text-[9px] font-black uppercase tracking-wider"
                  title="Double Check"
                >
                  Double Check
                </button>
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenDoubleCheck?.(order, 'edit');
                  }}
                  className="px-2 py-1 rounded-lg bg-sky-500/10 border border-sky-500/30 text-sky-400 hover:bg-sky-500 hover:text-white transition-all active:scale-95 flex items-center justify-center text-[9px] font-black uppercase tracking-wider"
                  title="Edit Order"
                >
                  Edit Order
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
