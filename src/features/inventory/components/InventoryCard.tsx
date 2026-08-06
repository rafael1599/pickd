import { memo, useState, useRef, useEffect } from 'react';
import Plus from 'lucide-react/dist/esm/icons/plus';
import Minus from 'lucide-react/dist/esm/icons/minus';
import ArrowRightLeft from 'lucide-react/dist/esm/icons/arrow-right-left';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import Package from 'lucide-react/dist/esm/icons/package';
import type { DistributionItem } from '../../../schemas/inventory.schema';
import { DistributionJengaViz } from './DistributionJengaViz';
import { feedbackService } from '../../../services/feedback.service';
import { flashSyncStatus } from '../../../components/layout/SyncStatusIndicator';

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
  sublocation?: string[] | null;
  distribution?: DistributionItem[];
  onAdjust?: () => void;
  cartQty?: number;
  onCartIncrement?: () => void;
  onCartDecrement?: () => void;
  onCartRemove?: () => void;
  lastCounted?: Date | null;
  fedex_tracking_number?: string | null;
  fedex_return_id?: string | null;
  fedex_return_status?: 'received' | 'processing' | 'resolved' | null;
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
    warehouse: _warehouse, // eslint-disable-line @typescript-eslint/no-unused-vars
    mode = 'stock',
    reservedByOthers = 0,
    available = null,
    lastUpdateSource,
    is_active = true,
    sku_metadata = null,
    internal_note = null,
    sublocation = null,
    distribution = [],
    onAdjust,
    cartQty = 0,
    onCartIncrement,
    onCartDecrement,
    onCartRemove,
    lastCounted = null,
    fedex_tracking_number = null,
    fedex_return_id = null,
    fedex_return_status = null,
  }: InventoryCardProps) => {
    const [flash, setFlash] = useState(false);
    const [glow, setGlow] = useState(false);
    const prevQuantityRef = useRef(quantity);
    const [now] = useState(() => Date.now());

    useEffect(() => {
      if (prevQuantityRef.current !== quantity) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- glow animation requires synchronous setState
        setGlow(true);
        const glowTimer = setTimeout(() => setGlow(false), 600);
        if (lastUpdateSource === 'remote') {
          setFlash(true);
          const timer = setTimeout(() => setFlash(false), 800);
          prevQuantityRef.current = quantity;
          return () => {
            clearTimeout(timer);
            clearTimeout(glowTimer);
          };
        } else {
          prevQuantityRef.current = quantity;
          return () => clearTimeout(glowTimer);
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
        className={`bg-card border rounded-xl p-1.5 sm:p-0 mb-2 flex flex-col shadow-sm transition-premium origin-center overflow-hidden ${
          isDisabled
            ? 'opacity-50 cursor-not-allowed border-red-500/30'
            : `border-subtle active:scale-[0.98] active:bg-main/50 cursor-pointer ${isZeroStock ? 'opacity-70 border-dashed bg-main/20' : ''} ${glow ? 'animate-glow-success border-emerald-400 z-10' : ''} ${flash ? 'animate-flash-update scale-[1.02] border-accent/50 z-10' : ''}`
        }`}
      >
        {/* Mobile-only DistributionJengaViz header */}
        <div className="sm:hidden">
          <DistributionJengaViz
            distribution={distribution}
            onAdjust={() => (onAdjust ?? onClick)()}
            sku={sku}
            quantity={quantity}
            location={location}
            sku_metadata={sku_metadata}
          />
        </div>

        <div className="flex gap-2 sm:gap-3 flex-col sm:flex-row items-stretch sm:min-h-[120px]">
          {/* Left Column: Compact thumbnail on mobile, full-height tile on desktop */}
          {sku_metadata?.image_url ? (
            <div className="w-[70px] h-[70px] sm:w-36 sm:h-auto shrink-0 bg-white/5 sm:border-r border-subtle/50 p-1 sm:p-3 flex items-center justify-center rounded-lg sm:rounded-none sm:rounded-l-xl self-start sm:self-stretch overflow-hidden">
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
                className="w-full h-full object-contain max-h-[70px] sm:max-h-[110px] rounded"
              />
            </div>
          ) : (
            <div className="hidden sm:flex w-16 sm:w-24 shrink-0 bg-white/5 border-r border-subtle/50 p-2 items-center justify-center rounded-l-xl self-stretch">
              <Package size={24} className="text-muted/40" />
            </div>
          )}

          {/* Right Column: DistributionJengaViz on desktop + data + action buttons */}
          <div className="flex-1 min-w-0 flex flex-col justify-between sm:py-2 sm:pr-3">
            {/* Desktop-only DistributionJengaViz header */}
            <div className="hidden sm:block mb-1">
              <DistributionJengaViz
                distribution={distribution}
                onAdjust={() => (onAdjust ?? onClick)()}
                sku={sku}
                quantity={quantity}
                location={location}
                sku_metadata={sku_metadata}
              />
            </div>
            <div>
              {fedex_tracking_number && (
                <a
                  href={fedex_return_id ? `/fedex-returns/${fedex_return_id}` : undefined}
                  onClick={(e) => e.stopPropagation()}
                  className={`mb-1 inline-flex items-center gap-1 self-start text-[9px] sm:text-xs font-black uppercase tracking-widest px-1.5 py-0.5 rounded border ${
                    fedex_return_status === 'resolved'
                      ? 'bg-muted/10 text-muted border-muted/20'
                      : 'bg-purple-500/15 text-purple-400 border-purple-500/30'
                  }`}
                  title="FedEx Return — tap to open"
                >
                  FDX {fedex_tracking_number}
                  {sku !== fedex_tracking_number && (
                    <span className="text-muted/60 font-bold normal-case tracking-normal">
                      → now {sku}
                    </span>
                  )}
                </a>
              )}

              <div className="flex justify-between items-start gap-2">
                <div className="flex flex-col min-w-0">
                  {location && (
                    <div className="flex items-center gap-1.5">
                      <div
                        className="text-[10px] sm:text-xs text-accent font-extrabold uppercase tracking-tighter"
                        style={{ fontFamily: 'var(--font-heading)' }}
                      >
                        {location}
                      </div>
                      {internal_note && (
                        <span
                          className="text-[8px] sm:text-xs text-muted font-bold uppercase tracking-tight bg-white/5 px-1 py-0.5 rounded border border-white/5 max-w-[120px] sm:max-w-none truncate"
                          title={internal_note}
                        >
                          📍 {internal_note}
                        </span>
                      )}
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <div
                      className={`text-base sm:text-2xl md:text-3xl font-black text-content tracking-tighter leading-tight ${!is_active ? 'line-through opacity-60' : ''}`}
                      style={{ fontFamily: 'var(--font-heading)' }}
                    >
                      {sku}
                      {sku_metadata?.is_scratch_dent && sku_metadata.serial_number && (
                        <span className="ml-1.5 text-xs sm:text-sm font-bold text-muted tracking-tight">
                          ({sku_metadata.serial_number})
                        </span>
                      )}
                    </div>
                    {!is_active && (
                      <span className="text-[8px] sm:text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-red-500/10 text-red-500 border border-red-500/20">
                        Del
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {/* Sublocation Badge */}
                  {sublocation && sublocation.length > 0 && (
                    <div className="inline-flex px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 text-lg sm:text-lg font-black uppercase tracking-tighter tabular-nums leading-none border border-amber-500/20 whitespace-nowrap">
                      {sublocation.join(',')}
                    </div>
                  )}

                  {/* Stock Qty Badge */}
                  <div className="flex flex-col items-end">
                    <span className="text-[9px] text-muted uppercase font-bold tracking-widest leading-none">
                      Stock
                    </span>
                    <span className="text-xl sm:text-2xl font-black text-accent tabular-nums tracking-tighter leading-none mt-0.5">
                      {quantity}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex justify-between items-center mt-1">
                {detail && (
                  <div className="px-1.5 py-0.5 rounded bg-main text-muted text-[9px] sm:text-xs font-bold uppercase tracking-tight border border-subtle">
                    {detail}
                  </div>
                )}

                {isPicking && available !== null && (
                  <div className="flex items-center gap-2 ml-auto">
                    {available <= 0 ? (
                      <span className="text-[9px] sm:text-xs font-black uppercase tracking-widest text-red-500 bg-red-500/10 px-1.5 py-0.5 rounded border border-red-500/20">
                        🚫 Fully Reserved
                      </span>
                    ) : (
                      <>
                        {hasReservations && (
                          <span className="text-[9px] sm:text-xs font-black uppercase tracking-widest text-orange-500 bg-orange-500/10 px-1.5 py-0.5 rounded border border-orange-500/20">
                            {reservedByOthers} Res
                          </span>
                        )}
                        <span className="text-[9px] sm:text-xs font-black uppercase tracking-widest text-green-500 bg-green-500/10 px-1.5 py-0.5 rounded border border-green-500/20">
                          {available} Avail
                        </span>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Quick Action Buttons: compact on mobile, underneath data on sm+ */}
            {mode === 'stock' && (
              <div className="flex gap-2 mt-1 sm:mt-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDecrement();
                    feedbackService.success();
                    flashSyncStatus('Stock Saved', 1200);
                  }}
                  className="bg-main text-accent-red flex-1 h-9 sm:h-8 rounded-lg flex items-center justify-center active:scale-95 transition-all hover:bg-red-500/10 border border-subtle"
                  aria-label="Decrease quantity"
                >
                  <Minus size={15} strokeWidth={3} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onMove();
                  }}
                  className="bg-main text-accent-blue flex-1 h-9 sm:h-8 rounded-lg flex items-center justify-center active:scale-95 transition-all hover:bg-blue-500/10 border border-subtle"
                  aria-label="Move item"
                >
                  <ArrowRightLeft size={15} strokeWidth={3} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onIncrement();
                    feedbackService.success();
                    flashSyncStatus('Stock Saved', 1200);
                  }}
                  className="bg-accent text-white flex-1 h-9 sm:h-8 rounded-lg flex items-center justify-center active:scale-95 transition-all shadow-sm shadow-accent/20 hover:brightness-110"
                  aria-label="Increase quantity"
                >
                  <Plus size={15} strokeWidth={3} />
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
                now - lastCounted.getTime() < 7 * 86400000
                  ? 'bg-green-500/40'
                  : now - lastCounted.getTime() < 30 * 86400000
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
