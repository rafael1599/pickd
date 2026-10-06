import { memo, useState, useRef, useEffect } from 'react';
import Plus from 'lucide-react/dist/esm/icons/plus';
import Minus from 'lucide-react/dist/esm/icons/minus';
import ArrowRightLeft from 'lucide-react/dist/esm/icons/arrow-right-left';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import Camera from 'lucide-react/dist/esm/icons/camera';
import toast from 'react-hot-toast';
import type {
  DistributionItem,
  InventoryItemWithMetadata,
} from '../../../schemas/inventory.schema';
import { DistributionGlyph, DistributionMenu } from './DistributionJengaViz';
import { useSkuPhotoCapture } from '../hooks/useSkuPhotoCapture';
import { cardThumbUrl } from '../utils/stockCard';
import { useStockBoxEdit } from './StockBoxEdit';
import { useModal } from '../../../context/ModalContext';
import { squaredGroups } from '../../../utils/boxSquares';
import {
  addGroup,
  boxesMismatch,
  boxesToSave,
  mismatchLabel,
  moveGroup,
  setGroupNumber,
  splitGroup,
} from '../utils/squareEdit';
import { isRowLocation, squaresForRow } from '../utils/registerItem';
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
  /** The row itself: with it, Stock edits the boxes from the card (idea-253). */
  item?: InventoryItemWithMetadata;
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
    item,
  }: InventoryCardProps) => {
    const [flash, setFlash] = useState(false);
    const [glow, setGlow] = useState(false);
    const prevQuantityRef = useRef(quantity);
    const [now] = useState(() => Date.now());
    // A FedEx return's SKU is its tracking (idea-250); the search also says so by
    // `fedex_tracking_number`, which covers a read without `unit_kind`.
    const kind = fedex_tracking_number ? 'return' : unitKindOf(sku_metadata);
    const photo = useSkuPhotoCapture(sku);
    const boxEdit = useStockBoxEdit();
    const { open: openModal } = useModal();

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
    // Boxes per square (idea-253): the pending ones while this card is edited.
    const pending =
      boxEdit?.pending && item && String(boxEdit.pending.item.id) === String(item.id)
        ? boxEdit.pending
        : null;
    const editable = !!(boxEdit && item && mode === 'stock' && is_active && quantity > 0);
    // The Stock list groups cards under their row and passes no `location`.
    const rowLoc = location ?? item?.location ?? '';
    const groups =
      boxEdit && item ? boxEdit.groupsFor(item) : squaredGroups(distribution, sublocation);
    const showBoxes = quantity > 1 || !!pending;
    const mismatch = showBoxes ? mismatchLabel(boxesMismatch(groups, quantity)) : null;
    const squaresShown = pending
      ? (boxesToSave(pending.cur, sublocation).sublocation ?? [])
      : (sublocation ?? []);
    const busy = () => {
      toast.error('Save or discard first');
      feedbackService.error();
    };
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
        onClick={
          isDisabled
            ? undefined
            : () => (boxEdit && item ? boxEdit.guard(item.id, onClick) : onClick())
        }
        className={`bg-card border rounded-xl mb-2 ${pending ? 'ring-2 ring-amber-400/80' : ''} flex flex-col shadow-sm transition-premium origin-center overflow-hidden ${
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
              {squaresShown.length > 0 && (
                <span className="inline-flex px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 text-lg font-black uppercase tracking-tighter tabular-nums leading-none border border-amber-500/20 whitespace-nowrap">
                  {squaresShown.join(',')}
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

            {((showBoxes && (groups.length > 0 || editable || mismatch)) || facts.length > 0) && (
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] sm:text-xs font-bold text-muted">
                {showBoxes && (
                  <SquareBoxes
                    groups={groups}
                    base={pending?.base ?? null}
                    editable={editable}
                    mismatch={mismatch}
                    onNumber={(index, field) => {
                      const g = groups[index];
                      if (!item || !g) return;
                      openModal({
                        type: 'box-edit',
                        sheet: {
                          kind: 'number',
                          title: `${g.square ? `${g.square} · ` : ''}${g.type} · ${field === 'count' ? 'how many' : 'units each'}`,
                          value: g[field],
                          min: field === 'count' ? 0 : 1,
                          onCommit: (n) =>
                            boxEdit?.edit(item, (cur) => setGroupNumber(cur, index, field, n)),
                        },
                      });
                    }}
                    onLetter={(index) => {
                      const g = groups[index];
                      if (!item || !g || !isRowLocation(rowLoc)) return;
                      let target = index;
                      openModal({
                        type: 'box-edit',
                        sheet: {
                          kind: 'letters',
                          row: rowLoc,
                          letters: squaresForRow([...(sublocation ?? []), ...squaresShown]),
                          current: g.square ?? '',
                          group: g,
                          onMove: (letter) =>
                            boxEdit?.edit(item, (cur) => moveGroup(cur, target, letter)),
                          onSplit: () => {
                            let out: DistributionItem = g;
                            boxEdit?.edit(item, (cur) => {
                              const r = splitGroup(cur, target);
                              target = r.index;
                              out = r.groups[r.index];
                              return r.groups;
                            });
                            return out;
                          },
                        },
                      });
                    }}
                    onAdd={() => {
                      if (!item) return;
                      const row = isRowLocation(rowLoc);
                      openModal({
                        type: 'box-edit',
                        sheet: {
                          kind: 'add',
                          row: rowLoc,
                          letters: row
                            ? squaresForRow([...(sublocation ?? []), ...squaresShown])
                            : [],
                          square: row ? ([...squaresShown].sort()[0] ?? null) : null,
                          onAdd: (group) => boxEdit?.edit(item, (cur) => addGroup(cur, group)),
                        },
                      });
                    }}
                  />
                )}
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
                      if (pending) return busy();
                      onDecrement();
                      feedbackService.success();
                      flashSyncStatus('Stock Saved', 1200);
                    }}
                    className={`${pending ? 'opacity-35' : ''} bg-main text-accent-red flex-1 h-9 rounded-lg flex items-center justify-center active:scale-95 transition-all hover:bg-red-500/10 border border-subtle`}
                    aria-label="Decrease quantity"
                  >
                    <Minus size={15} strokeWidth={3} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (pending) return busy();
                      onMove();
                    }}
                    className={`${pending ? 'opacity-35' : ''} bg-main text-accent-blue flex-1 h-9 rounded-lg flex items-center justify-center active:scale-95 transition-all hover:bg-blue-500/10 border border-subtle`}
                    aria-label="Move item"
                  >
                    <ArrowRightLeft size={15} strokeWidth={3} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (pending) return busy();
                      onIncrement();
                      feedbackService.success();
                      flashSyncStatus('Stock Saved', 1200);
                    }}
                    className={`${pending ? 'opacity-35' : ''} bg-accent text-white flex-1 h-9 rounded-lg flex items-center justify-center active:scale-95 transition-all shadow-sm shadow-accent/20 hover:brightness-110`}
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
 * The boxes of a spot, compact (Rafael's sketch, 6 Oct 2026), per square
 * (idea-253): the square's letter once, then one drawing per group with
 * «count × units» beside it. Editable on the Stock list: each number opens the
 * keypad, the drawing (or the letter) moves or splits the group, + adds one.
 * A number that changed and is not saved yet has the amber ring.
 */
function SquareBoxes({
  groups,
  base,
  editable,
  mismatch,
  onNumber,
  onLetter,
  onAdd,
}: {
  groups: DistributionItem[];
  base: DistributionItem[] | null;
  editable: boolean;
  mismatch: string | null;
  onNumber: (index: number, field: 'count' | 'units_each') => void;
  onLetter: (index: number) => void;
  onAdd: () => void;
}) {
  const order = groups
    .map((g, index) => ({ g, index }))
    .sort(
      (a, b) =>
        (a.g.square ?? '').localeCompare(b.g.square ?? '') ||
        (RANK[a.g.type] ?? 9) - (RANK[b.g.type] ?? 9) ||
        b.g.units_each - a.g.units_each
    );
  const like = pairWithBase(groups, base);
  const changed = (index: number, field: 'count' | 'units_each') => {
    if (!base || !like.has(index)) return false;
    const b = like.get(index);
    return !b || b[field] !== groups[index][field];
  };
  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };
  const num = (index: number, g: DistributionItem, field: 'count' | 'units_each') => {
    const ring = changed(index, field)
      ? 'rounded-full ring-2 ring-amber-400 text-amber-300 px-[3px]'
      : '';
    return editable ? (
      <button
        type="button"
        aria-label={`${g.square ?? ''} ${field === 'count' ? 'how many' : 'units each'} ${g[field]}`}
        onClick={stop(() => onNumber(index, field))}
        className={`min-w-[16px] leading-[12px] active:bg-white/10 ${ring}`}
      >
        {g[field]}
      </button>
    ) : (
      <span className={ring}>{g[field]}</span>
    );
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1" aria-label="Distribution">
      {order.map(({ g, index }, i) => {
        const showLetter = !!g.square && g.square !== order[i - 1]?.g.square;
        return (
          <span
            key={`${index}-${g.square ?? ''}-${g.type}-${g.units_each}`}
            className={`inline-flex items-center gap-1 ${i > 0 && !showLetter ? 'border-l border-subtle pl-2' : ''}`}
          >
            {showLetter &&
              (editable ? (
                <button
                  type="button"
                  aria-label={`Square ${g.square}`}
                  onClick={stop(() => onLetter(index))}
                  className="rounded border border-amber-500/40 bg-amber-500/10 px-1 font-mono text-[11px] font-black leading-[16px] text-amber-400"
                >
                  {g.square}
                </button>
              ) : (
                <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1 font-mono text-[11px] font-black leading-[16px] text-amber-400">
                  {g.square}
                </span>
              ))}
            <span
              onClick={editable ? stop(() => onLetter(index)) : undefined}
              className="inline-flex h-[30px] items-end [&_svg]:h-[30px] [&_svg]:w-auto"
            >
              <DistributionGlyph type={g.type} unitsEach={g.units_each} showNumber={false} />
            </span>
            <span className="flex flex-col items-center font-mono text-[13px] font-extrabold leading-[12px] text-content tabular-nums">
              {num(index, g, 'count')}
              <span className="text-[9px] leading-[9px] text-muted">×</span>
              {num(index, g, 'units_each')}
            </span>
          </span>
        );
      })}
      {editable && (
        <button
          type="button"
          aria-label="Add boxes"
          onClick={stop(onAdd)}
          className="flex h-6 w-6 items-center justify-center rounded-md border border-dashed border-subtle text-muted active:bg-white/10"
        >
          <Plus size={13} strokeWidth={3} />
        </button>
      )}
      {mismatch && (
        <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-300">
          {mismatch}
        </span>
      )}
    </span>
  );
}

const RANK: Record<string, number> = { TOWER: 0, PALLET: 1, LINE: 2, OTHER: 3 };

/**
 * Which saved group each changed group came from, to ring only the number that
 * changed: 3×30 → 1×30 rings the 1, 1×25 → 1×24 rings the 24. Groups equal to
 * a saved one are not in the map; a changed group with nothing to pair is
 * mapped to null (both numbers are new).
 */
function pairWithBase(
  groups: DistributionItem[],
  base: DistributionItem[] | null
): Map<number, DistributionItem | null> {
  const out = new Map<number, DistributionItem | null>();
  if (!base) return out;
  const free = [...base];
  const take = (i: number) => free.splice(i, 1)[0];
  const open: number[] = [];
  groups.forEach((g, i) => {
    const same = free.findIndex((b) => sameGroup(b, g));
    if (same >= 0) take(same);
    else open.push(i);
  });
  const near = (g: DistributionItem, b: DistributionItem) =>
    (b.square ?? '') === (g.square ?? '') && b.type === g.type;
  for (const pass of ['units_each', 'count', null] as const) {
    for (const i of open) {
      if (out.has(i)) continue;
      const g = groups[i];
      const j = free.findIndex((b) => near(g, b) && (pass === null || b[pass] === g[pass]));
      if (j >= 0) out.set(i, take(j));
    }
  }
  for (const i of open) if (!out.has(i)) out.set(i, null);
  return out;
}

const sameGroup = (a: DistributionItem, b: DistributionItem) =>
  (a.square ?? '') === (b.square ?? '') &&
  a.type === b.type &&
  a.count === b.count &&
  a.units_each === b.units_each;

InventoryCard.displayName = 'InventoryCard';
