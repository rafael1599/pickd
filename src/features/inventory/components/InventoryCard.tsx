import { memo, useState, useRef, useEffect } from 'react';
import Plus from 'lucide-react/dist/esm/icons/plus';
import Minus from 'lucide-react/dist/esm/icons/minus';
import ArrowRightLeft from 'lucide-react/dist/esm/icons/arrow-right-left';
import Tag from 'lucide-react/dist/esm/icons/tag';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import type { DistributionItem } from '../../../schemas/inventory.schema';

interface InventoryCardProps {
  sku: string;
  quantity: number;
  location?: string | null;
  onIncrement: () => void;
  onDecrement: () => void;
  onMove: () => void;
  detail?: string | null;
  onClick: () => void;
  warehouse?: string | null;
  mode?: 'stock' | 'picking' | 'double_checking' | 'idle' | 'reopened';
  reservedByOthers?: number;
  available?: number | null;
  lastUpdateSource?: 'local' | 'remote';
  is_active?: boolean;
  sku_metadata?: import('../../../schemas/skuMetadata.schema').SKUMetadata | null;
  internal_note?: string | null;
  distribution?: DistributionItem[];
  cartQty?: number;
  onCartIncrement?: () => void;
  onCartDecrement?: () => void;
  onCartRemove?: () => void;
  lastCounted?: Date | null;
  onPrintLabel?: () => void;
}

export const InventoryCard = memo(
  ({
    sku,
    quantity,
    location,
    onIncrement,
    onDecrement,
    onMove,
    detail,
    onClick,
    /* warehouse is received but unused (needed for prop-spreading from parent) */
    warehouse: _warehouse,
    mode = 'stock',
    reservedByOthers = 0,
    available = null,
    lastUpdateSource,
    is_active = true,
    sku_metadata = null,
    internal_note = null,
    distribution = [],
    cartQty = 0,
    onCartIncrement,
    onCartDecrement,
    onCartRemove,
    lastCounted = null,
    onPrintLabel,
  }: InventoryCardProps) => {
    const [flash, setFlash] = useState(false);
    const prevQuantityRef = useRef(quantity);

    useEffect(() => {
      if (prevQuantityRef.current !== quantity) {
        // Only flash if the update came from a remote source
        // Local updates (done by the user themselves) should be silent/smooth
        if (lastUpdateSource === 'remote') {
          // eslint-disable-next-line react-hooks/set-state-in-effect -- flash animation requires synchronous setState
          setFlash(true);
          const timer = setTimeout(() => setFlash(false), 800);
          prevQuantityRef.current = quantity;
          return () => clearTimeout(timer);
        } else {
          // Update the ref without flashing
          prevQuantityRef.current = quantity;
        }
      }
    }, [quantity, lastUpdateSource]);

    const isPicking = mode === 'picking';

    const isFullyReserved = isPicking && available !== null && available <= 0;
    const isZeroStock = mode === 'stock' && quantity <= 0;

    // In picking mode, disable if fully reserved. In stock mode, never disable.
    const isDisabled = isFullyReserved;

    const hasReservations = isPicking && reservedByOthers > 0;

    return (
      <div
        onClick={isDisabled ? undefined : onClick}
        className={`bg-card border rounded-xl p-1.5 mb-2 flex flex-col shadow-sm transition-premium origin-center ${
          isDisabled
            ? 'opacity-50 cursor-not-allowed border-red-500/30'
            : `border-subtle active:scale-[0.98] active:bg-main/50 cursor-pointer ${isZeroStock ? 'opacity-70 border-dashed bg-main/20' : ''} ${flash ? 'animate-flash-update scale-[1.02] border-accent/50 z-10' : ''}`
        }`}
      >
        <div className="flex gap-2">
          {sku_metadata?.image_url && (
            <img
              src={
                sku_metadata.image_url.includes('/catalog/')
                  ? sku_metadata.image_url
                      .replace('/catalog/', '/catalog/thumbs/')
                      .replace('.png', '.webp')
                  : sku_metadata.image_url.includes('/photos/')
                    ? sku_metadata.image_url.replace('/photos/', '/photos/thumbs/')
                    : sku_metadata.image_url
              }
              alt={sku}
              loading="lazy"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
              className="w-[70px] object-contain rounded flex-shrink-0 bg-white/5 self-stretch"
            />
          )}

          <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex justify-between items-center">
              <div className="flex flex-col">
                {location && (
                  <div className="flex items-center gap-1.5">
                    <div
                      className="text-[10px] text-accent font-extrabold uppercase tracking-tighter"
                      style={{ fontFamily: 'var(--font-heading)' }}
                    >
                      {location}
                    </div>
                    {internal_note && (
                      <span
                        className="text-[8px] text-muted font-bold uppercase tracking-tight bg-white/5 px-1 py-0.5 rounded border border-white/5 max-w-[120px] md:max-w-none truncate"
                        title={internal_note}
                      >
                        📍 {internal_note}
                      </span>
                    )}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <div
                    className={`text-base font-extrabold text-content tracking-tighter leading-tight ${!is_active ? 'line-through opacity-60' : ''}`}
                    style={{ fontFamily: 'var(--font-heading)' }}
                  >
                    {sku}
                  </div>
                  {!is_active && (
                    <span className="text-[8px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-red-500/10 text-red-500 border border-red-500/20">
                      Del
                    </span>
                  )}
                </div>
              </div>

              <div className="flex flex-col items-end gap-0.5">
                <span className="text-[9px] text-muted uppercase font-bold tracking-widest leading-none">
                  Stock
                </span>
                <div className="flex items-baseline gap-1">
                  <span className="text-xl font-black text-accent tabular-nums tracking-tighter leading-none">
                    {quantity}
                  </span>
                </div>
                {distribution && distribution.length > 0 && (
                  <span className="hidden md:inline-flex text-[8px] font-black text-muted/50 uppercase tracking-widest leading-none">
                    {distribution
                      .map(
                        (d) =>
                          `${d.count} ${d.type.charAt(0) + d.type.slice(1).toLowerCase()}${d.count > 1 ? 's' : ''}`
                      )
                      .join(' · ')}
                  </span>
                )}
              </div>
            </div>

            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                {detail && (
                  <div className="flex items-center gap-2">
                    <div className="px-1.5 py-0.5 rounded-[4px] bg-main text-muted text-[9px] font-bold uppercase tracking-tight inline-flex items-center border border-subtle">
                      {detail}
                    </div>
                      </div>
                )}
                {sku_metadata && ((sku_metadata.length_in ?? 0) > 0 || (sku_metadata.width_in ?? 0) > 0 || (sku_metadata.height_in ?? 0) > 0) && (
                  <div className="inline-flex px-1.5 py-0.5 rounded-[4px] bg-accent/5 text-accent/70 text-[9px] font-black tracking-widest border border-accent/10 whitespace-nowrap">
                    {sku_metadata.length_in ?? 0}×{sku_metadata.width_in ?? 0}×{sku_metadata.height_in ?? 0}"
                  </div>
                )}
                {(sku_metadata?.weight_lbs ?? 0) > 0 && (
                  <div className="inline-flex px-1.5 py-0.5 rounded-[4px] bg-amber-500/5 text-amber-500/70 text-[9px] font-black tracking-widest border border-amber-500/10 whitespace-nowrap">
                    {sku_metadata!.weight_lbs} lbs
                  </div>
                )}
              </div>

              {isPicking && available !== null && (
                <div className="flex items-center gap-2">
                  {available <= 0 ? (
                    <span className="text-[9px] font-black uppercase tracking-widest text-red-500 bg-red-500/10 px-1.5 py-0.5 rounded border border-red-500/20">
                      🚫 Fully Reserved
                    </span>
                  ) : (
                    <>
                      {hasReservations && (
                        <span className="text-[9px] font-black uppercase tracking-widest text-orange-500 bg-orange-500/10 px-1.5 py-0.5 rounded border border-orange-500/20">
                          {reservedByOthers} Res
                        </span>
                      )}
                      <span className="text-[9px] font-black uppercase tracking-widest text-green-600 bg-green-500/10 px-1.5 py-0.5 rounded border border-green-500/20">
                        {available} Avail
                      </span>
                    </>
                  )}
                </div>
              )}

            </div>

            {mode === 'stock' && (
              <div className="flex gap-2 mt-0.5">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDecrement();
                  }}
                  className="bg-main text-accent-red flex-1 h-9 rounded-lg flex items-center justify-center active:scale-90 transition-transform"
                  aria-label="Decrease quantity"
                >
                  <Minus size={16} strokeWidth={3} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onMove();
                  }}
                  className="bg-main text-accent-blue flex-1 h-9 rounded-lg flex items-center justify-center active:scale-90 transition-transform"
                  aria-label="Move item"
                >
                  <ArrowRightLeft size={16} strokeWidth={3} />
                </button>
                {onPrintLabel && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onPrintLabel();
                    }}
                    className="bg-main text-purple-400 flex-1 h-9 rounded-lg flex items-center justify-center active:scale-90 transition-transform"
                    aria-label="Print label"
                  >
                    <Tag size={16} strokeWidth={3} />
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onIncrement();
                  }}
                  className="bg-accent text-white flex-1 h-9 rounded-lg flex items-center justify-center active:scale-90 transition-transform shadow-lg shadow-accent/20"
                  aria-label="Increase quantity"
                >
                  <Plus size={16} strokeWidth={3} />
                </button>
              </div>
            )}

            {/* Cart stepper: visible in picking mode when item is in cart */}
            {cartQty > 0 && isPicking && (
              <div className="flex gap-2 mt-1 items-center">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCartDecrement?.();
                  }}
                  className="bg-main text-muted hover:text-content h-11 w-11 rounded-lg flex items-center justify-center active:scale-90 transition-all border border-subtle"
                  aria-label="Decrease cart quantity"
                >
                  <Minus size={18} strokeWidth={3} />
                </button>
                <div className="flex-1 h-11 rounded-lg bg-accent/10 border border-accent/30 flex items-center justify-center">
                  <span className="font-mono font-black text-accent text-lg tabular-nums">
                    {cartQty}
                  </span>
                  <span className="text-[9px] text-accent/60 font-bold uppercase ml-1.5 tracking-wider">
                    in order
                  </span>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCartIncrement?.();
                  }}
                  className="bg-accent text-white h-11 w-11 rounded-lg flex items-center justify-center active:scale-90 transition-all shadow-lg shadow-accent/20"
                  aria-label="Increase cart quantity"
                >
                  <Plus size={18} strokeWidth={3} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCartRemove?.();
                  }}
                  className="bg-red-500/10 text-red-500 h-11 w-11 rounded-lg flex items-center justify-center active:scale-90 transition-all border border-red-500/20"
                  aria-label="Remove from order"
                >
                  <Trash2 size={16} strokeWidth={2.5} />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Cycle count verified indicator */}
        {lastCounted && (
          <div className="mt-1 mx-1 mb-0.5">
            <div
              className={`h-1 rounded-full transition-all ${
                Date.now() - lastCounted.getTime() < 7 * 86400000
                  ? 'bg-green-500/40'
                  : Date.now() - lastCounted.getTime() < 30 * 86400000
                    ? 'bg-green-500/25'
                    : 'bg-green-500/10'
              }`}
            />
          </div>
        )}
      </div>
    );
  }
);

InventoryCard.displayName = 'InventoryCard';
