import { memo, useState, useRef, useEffect } from 'react';
import Plus from 'lucide-react/dist/esm/icons/plus';
import Minus from 'lucide-react/dist/esm/icons/minus';
import ArrowRightLeft from 'lucide-react/dist/esm/icons/arrow-right-left';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import Camera from 'lucide-react/dist/esm/icons/camera';
import type { DistributionItem } from '../../../schemas/inventory.schema';
import { DistributionGlyph, DistributionMenu } from './DistributionJengaViz';
import { useSkuPhotoCapture } from '../hooks/useSkuPhotoCapture';
import { cardThumbUrl, compactDistribution, type DistributionGroup } from '../utils/stockCard';
import { daysWaiting } from '../utils/returnCard';
import { feedbackService } from '../../../services/feedback.service';
import { flashSyncStatus } from '../../../components/layout/SyncStatusIndicator';
import { sanitizeItemName } from '../../../utils/sanitizeItemName';
import { withSizeUnit } from '../../../utils/size';
import { serialRepeatsSku } from '../utils/labelLayout';
import { UnitKindChip } from '../../../components/ui/UnitKindChip';
import { unitKindOf } from '../../../utils/unitKind';

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
  /** When a FedEx return came in (search `received_at`): its days waiting. */
  received_at?: string | null;
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
    received_at = null,
  }: InventoryCardProps) => {
    const [flash, setFlash] = useState(false);
    const [glow, setGlow] = useState(false);
    const prevQuantityRef = useRef(quantity);
    const [now] = useState(() => Date.now());
    // A FedEx return's SKU is its tracking (idea-250); the search also says so by
    // `fedex_tracking_number`, which covers a read without `unit_kind`.
    const kind = fedex_tracking_number ? 'return' : unitKindOf(sku_metadata);
    const photo = useSkuPhotoCapture(sku);

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

    // ── Photo-first card (docs/prds/stock-card-photo-first.md, Rafael's C, 6 Oct 2026) ──
    const thumb = cardThumbUrl(sku_metadata?.image_url);
    const groups = compactDistribution(distribution, quantity);
    const sdNumber = sku_metadata?.sd_number ?? null;
    const serial = sku_metadata?.serial_number ?? null;
    // The size inside the name carries its unit, as on the printed label:
    // `CITIZEN 3 S/T 14" 2025 NAVY PEARL` (530ba22).
    const cleanDetail =
      kind === 'return'
        ? null
        : withSizeUnit(
            sanitizeItemName(detail),
            sku_metadata?.size,
            sku_metadata?.is_bike,
            sku_metadata?.category
          );
    // The data line says what each kind is about: an S/D its serial, a return
    // its RMA and days, a PH its defect (its note); and the position note.
    const facts: string[] = [];
    if (kind === 'sd' && serial && !serialRepeatsSku(serial, sku)) facts.push(serial);
    if (kind === 'return') {
      const days = daysWaiting(received_at, now);
      facts.push(
        [
          sku_metadata?.rma ? `RMA ${sku_metadata.rma}` : 'FedEx return',
          days != null ? `${days} d` : null,
        ]
          .filter(Boolean)
          .join(' · ')
      );
    }
    if (internal_note) facts.push(kind === 'photo' ? internal_note : `📍 ${internal_note}`);

    return (
      <div
        onClick={isDisabled ? undefined : onClick}
        className={`bg-card border rounded-xl mb-2 flex flex-col shadow-sm transition-premium origin-center overflow-hidden ${
          isDisabled
            ? 'opacity-50 cursor-not-allowed border-red-500/30'
            : `border-subtle active:scale-[0.98] active:bg-main/50 cursor-pointer ${isZeroStock ? 'opacity-70 border-dashed bg-main/20' : ''} ${glow ? 'animate-glow-success border-emerald-400 z-10' : ''} ${flash ? 'animate-flash-update scale-[1.02] border-accent/50 z-10' : ''}`
        }`}
      >
        <div className="flex items-stretch">
          {/* The photo, always on black (Rafael, 6 Oct 2026); a return's is its FedEx label. */}
          <div className="relative w-[104px] sm:w-[140px] shrink-0 self-stretch min-h-[104px] bg-black border-r border-subtle/50">
            {thumb ? (
              <img
                src={thumb}
                alt={sku}
                loading="lazy"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
                className="absolute inset-0 h-full w-full object-contain"
              />
            ) : (
              // No photo: the hole asks for one (❓1) — the camera, right here.
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  photo.openCamera();
                }}
                aria-label="Take photo"
                className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-white/45 active:bg-white/10"
              >
                {photo.isUploading ? (
                  <div className="h-5 w-5 rounded-full border-2 border-white/60 border-t-transparent animate-spin" />
                ) : (
                  <Camera size={22} />
                )}
                <span className="text-[9px] font-bold uppercase tracking-widest">Photo</span>
              </button>
            )}
            {kind !== 'new' && (
              <UnitKindChip
                kind={kind}
                solid
                className="pointer-events-none absolute left-1.5 top-1.5"
              />
            )}
            {kind === 'sd' && sdNumber != null && (
              <span
                className="pointer-events-none absolute bottom-1.5 left-1.5 rounded bg-orange-500 px-1.5 py-0.5 text-lg font-black leading-none text-[#111214]"
                style={{ fontFamily: 'var(--font-heading)' }}
              >
                #{sdNumber}
              </span>
            )}
            {photo.element}
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-1 p-2">
            {location && (
              <div
                className="text-[10px] sm:text-xs text-accent font-extrabold uppercase tracking-tighter"
                style={{ fontFamily: 'var(--font-heading)' }}
              >
                {location}
              </div>
            )}

            {/* SKU · square · quantity: the quantity once (it was twice). */}
            <div className="flex items-start gap-2">
              <div
                className={`min-w-0 flex-1 truncate text-[22px] sm:text-2xl font-black text-content tracking-tighter leading-none ${!is_active ? 'line-through opacity-60' : ''}`}
                style={{ fontFamily: 'var(--font-heading)' }}
              >
                {sku}
              </div>
              {!is_active && (
                <span className="text-[8px] sm:text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-red-500/10 text-red-500 border border-red-500/20">
                  Del
                </span>
              )}
              {sublocation && sublocation.length > 0 && (
                <span className="inline-flex px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 text-lg font-black uppercase tracking-tighter tabular-nums leading-none border border-amber-500/20 whitespace-nowrap">
                  {sublocation.join(',')}
                </span>
              )}
              <span
                aria-label={`Stock ${quantity}`}
                className="text-[26px] font-black text-accent tabular-nums tracking-tighter leading-none"
                style={{ fontFamily: 'var(--font-heading)' }}
              >
                {quantity}
              </span>
            </div>

            {cleanDetail && (
              <div className="truncate text-[11px] sm:text-xs font-bold uppercase tracking-tight text-muted">
                {cleanDetail}
              </div>
            )}

            {(groups.length > 0 || facts.length > 0) && (
              <div className="flex min-w-0 items-center gap-2 text-[11px] sm:text-xs font-bold text-muted">
                {groups.length > 0 && <CompactDistribution groups={groups} />}
                {facts.length > 0 && <span className="min-w-0 truncate">{facts.join(' · ')}</span>}
              </div>
            )}

            {isPicking && available !== null && (
              <div className="flex items-center gap-2">
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

            <div className="mt-auto flex items-center gap-1.5">
              {mode === 'stock' ? (
                <>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDecrement();
                      feedbackService.success();
                      flashSyncStatus('Stock Saved', 1200);
                    }}
                    className="bg-main text-accent-red flex-1 h-9 rounded-lg flex items-center justify-center active:scale-95 transition-all hover:bg-red-500/10 border border-subtle"
                    aria-label="Decrease quantity"
                  >
                    <Minus size={15} strokeWidth={3} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onMove();
                    }}
                    className="bg-main text-accent-blue flex-1 h-9 rounded-lg flex items-center justify-center active:scale-95 transition-all hover:bg-blue-500/10 border border-subtle"
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
                    className="bg-accent text-white flex-1 h-9 rounded-lg flex items-center justify-center active:scale-95 transition-all shadow-sm shadow-accent/20 hover:brightness-110"
                    aria-label="Increase quantity"
                  >
                    <Plus size={15} strokeWidth={3} />
                  </button>
                </>
              ) : (
                <span className="flex-1" />
              )}
              {/* ⋯ is the menu it always was (Distribution, print, photo, history). */}
              <DistributionMenu
                isEmpty={!distribution || distribution.length === 0}
                onAdjust={() => (onAdjust ?? onClick)()}
                sku={sku}
                quantity={quantity}
                location={location}
                distribution={distribution}
                triggerClassName="h-9 w-9 shrink-0"
              />
            </div>

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

/**
 * The boxes of a spot, compact (Rafael's sketch, 6 Oct 2026): one drawing per
 * kind with the same units each and «count × units» beside it, stacked.
 */
function CompactDistribution({ groups }: { groups: DistributionGroup[] }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-2" aria-label="Distribution">
      {groups.map((g, i) => (
        <span
          key={`${g.type}-${g.unitsEach}`}
          className={`inline-flex items-center gap-1 ${i > 0 ? 'border-l border-subtle pl-2' : ''}`}
        >
          <span className="inline-flex h-[30px] items-end [&_svg]:h-[30px] [&_svg]:w-auto">
            <DistributionGlyph type={g.type} unitsEach={g.unitsEach} showNumber={false} />
          </span>
          <span className="flex flex-col items-center font-mono text-[13px] font-extrabold leading-[12px] text-content tabular-nums">
            <span>{g.count}</span>
            <span className="text-[9px] leading-[9px] text-muted">×</span>
            <span>{g.unitsEach}</span>
          </span>
        </span>
      ))}
    </span>
  );
}

InventoryCard.displayName = 'InventoryCard';
