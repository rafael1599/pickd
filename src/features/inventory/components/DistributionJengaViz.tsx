import { memo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import MoreHorizontal from 'lucide-react/dist/esm/icons/more-horizontal';
import Edit3 from 'lucide-react/dist/esm/icons/edit-3';
import Printer from 'lucide-react/dist/esm/icons/printer';
import Camera from 'lucide-react/dist/esm/icons/camera';
import History from 'lucide-react/dist/esm/icons/history';
import Copy from 'lucide-react/dist/esm/icons/copy';
import Check from 'lucide-react/dist/esm/icons/check';
import Boxes from 'lucide-react/dist/esm/icons/boxes';
import Zap from 'lucide-react/dist/esm/icons/zap';
import ImagePlus from 'lucide-react/dist/esm/icons/image-plus';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list';
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../context/AuthContext';
import {
  useOpenRecounts,
  recountKey,
  invalidateRecountAndInventoryQueries,
} from '../../../hooks/useOpenRecounts';
import {
  requestRecount,
  cancelRecount,
  unitsHeldByOtherOrders,
} from '../../../services/recount.service';
import type { DistributionItem } from '../../../schemas/inventory.schema';
import { MenuOverlay } from '../../../components/ui/MenuOverlay';
import {
  LabelPrintOptionsModal,
  type LabelPrintResult,
} from '../../labels/components/LabelPrintOptionsModal';
import { ItemHistorySheet } from './ItemDetailView/ItemHistorySheet';
import { useSkuPhotoCapture } from '../hooks/useSkuPhotoCapture';
import {
  fetchSkuUpc,
  printNeedsOptions,
  usePrintSkuLabels,
} from '../../labels/hooks/usePrintSkuLabels';
import { getLabelCodeOptions } from '../../labels/hooks/useLabelPrintOptions';
import { feedbackService } from '../../../services/feedback.service';
import { flashSyncStatus } from '../../../components/layout/SyncStatusIndicator';
import jamisLogo from '../../../assets/jamis-bikes.webp';

interface DistributionJengaVizProps {
  distribution: DistributionItem[];
  onAdjust: () => void;
  sku?: string;
  quantity?: number;
  location?: string | null;
}

/**
 * Jenga-style 3D visualization of an inventory item's physical distribution
 * (idea-126). Each glyph is drawn in SVG with isometric front/top/right faces
 * for a real wooden-block look:
 *   · BASE / TOP / LINE_PALLET → cartons strapped on a wood pallet (idea-254).
 *   · LINE / TOWER → a carton / a stack of cartons — kids bikes only (rule 10).
 *   · empty → a scattered pile of sticks, signaling "stock on the floor but
 *             not yet categorized".
 */
export const DistributionJengaViz = memo(
  ({ distribution, onAdjust, sku, quantity, location }: DistributionJengaVizProps) => {
    const isEmpty = !distribution || distribution.length === 0;

    return (
      <div className="flex items-center gap-2 w-full bg-surface/30 border border-subtle/40 rounded-md px-2 py-2 mb-1.5">
        <div className="flex-1 min-w-0 flex items-center justify-center gap-3 flex-wrap">
          {isEmpty ? (
            <JengaPile />
          ) : (
            distribution.map((d, idx) => (
              <div key={`${idx}-${d.type}`} className="flex items-center gap-1.5">
                {/* The graphic indicator(s) for this distribution. */}
                <div className="flex items-end gap-1">
                  {Array.from({ length: d.count }, (_, i) => (
                    <DistributionGlyph
                      key={i}
                      type={d.type}
                      unitsEach={d.units_each}
                      showNumber={false}
                    />
                  ))}
                </div>
                {/* Units-per-container, shown large to the RIGHT of the indicator
                    (idea-137 parity with the Double-Check pick plan). */}
                <span
                  className="text-2xl font-black tabular-nums leading-none text-content"
                  style={{ fontFamily: 'var(--font-heading)' }}
                >
                  {d.units_each}
                </span>
              </div>
            ))
          )}
        </div>
        <DistributionMenu
          isEmpty={isEmpty}
          onAdjust={onAdjust}
          sku={sku}
          quantity={quantity}
          location={location}
        />
      </div>
    );
  }
);
DistributionJengaViz.displayName = 'DistributionJengaViz';

interface DistributionMenuProps {
  isEmpty: boolean;
  onAdjust: () => void;
  sku?: string;
  quantity?: number;
  location?: string | null;
  warehouse?: string;
  /** The trigger's classes, to sit beside the card's − ⇄ + (photo-first card). */
  triggerClassName?: string;
}

/** "..." menu next to the Jenga strip. Provides quick card actions (Edit distribution, Print label, Photo, History, Copy SKU, Consolidate). */
export function DistributionMenu({
  isEmpty,
  onAdjust,
  sku,
  quantity,
  location,
  warehouse = 'LUDLOW',
  triggerClassName = 'h-7 w-7',
}: DistributionMenuProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, isAdmin, profile } = useAuth();
  const { allOpenBySkuLocation } = useOpenRecounts();
  const { print, isGenerating } = usePrintSkuLabels();

  const effectiveLoc = (location || '').trim();
  const key = sku ? recountKey(sku, effectiveLoc) : '';
  const openReq = sku ? allOpenBySkuLocation.get(key) : undefined;
  const isRequester = !!(user && openReq?.requested_by === user.id);
  const canCancel = isAdmin || isRequester;

  const handleAskRecount = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(false);
    if (!sku) return;
    const userName = profile?.full_name || user?.user_metadata?.full_name || 'Staff';
    try {
      await requestRecount(sku, warehouse, effectiveLoc, `Asked by ${userName}`);
      const held = await unitsHeldByOtherOrders(sku, warehouse, effectiveLoc);
      if (held.length > 0) {
        toast(`Recount requested · waiting for #${held[0].order_number} to ship`);
      } else {
        toast.success('Recount requested');
      }
      invalidateRecountAndInventoryQueries(queryClient);
    } catch (err) {
      console.error('Failed to request recount:', err);
      toast.error('Failed to request recount');
    }
  };

  const handleCancelRecount = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(false);
    if (!openReq) return;
    try {
      await cancelRecount(openReq.id);
      toast.success('Recount request cancelled');
      invalidateRecountAndInventoryQueries(queryClient);
    } catch (err) {
      console.error('Failed to cancel recount:', err);
      toast.error('Failed to cancel recount');
    }
  };

  const [open, setOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const photo = useSkuPhotoCapture(sku);

  const handleCopySku = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!sku) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(sku);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = sku;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      feedbackService.success();
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
        setOpen(false);
      }, 1200);
    } catch {
      feedbackService.error();
    }
  };

  const handleConsolidate = (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(false);
    if (!sku) return;
    navigate(`/consolidation?mode=place-sku&sku=${encodeURIComponent(sku)}`);
  };

  const handleFlashPrint = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(false);
    if (!sku) return;
    try {
      flashSyncStatus('Printing 1 Label...');
      // One tap, the last choice of the print window (UPC).
      await print({
        sku,
        location: location ?? null,
        stock: quantity ?? 0,
        quantity: 1,
        ...getLabelCodeOptions(),
      });
      feedbackService.success();
      flashSyncStatus('Label Ready', 1500);
    } catch {
      feedbackService.error();
    }
  };

  // Nothing to ask (no UPC, one unit) prints straight away; otherwise the window.
  const [hasUpc, setHasUpc] = useState(false);
  const openPrint = async () => {
    if (!sku) return;
    const upc = await fetchSkuUpc(sku);
    if (!printNeedsOptions(upc !== null, quantity ?? 0)) {
      await handleGenerateLabels({ withUpc: false, quantity: 1 });
      return;
    }
    setHasUpc(upc !== null);
    setPrintOpen(true);
  };

  const handleGenerateLabels = async (result: LabelPrintResult) => {
    if (!sku) return;
    try {
      await print({
        sku,
        location: location ?? null,
        stock: quantity ?? 0,
        quantity: result.quantity,
        withUpc: result.withUpc,
      });
      setPrintOpen(false);
    } catch {
      toast.error('Failed to generate labels');
    }
  };

  return (
    <div className="shrink-0">
      {photo.element}

      <button
        ref={btnRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label="Distribution options"
        aria-haspopup="menu"
        aria-expanded={open}
        title={isEmpty ? 'Set distribution' : 'Card actions'}
        className={`${triggerClassName} rounded-md bg-accent/15 hover:bg-accent/25 text-accent border border-accent/40 flex items-center justify-center active:scale-90 transition-transform`}
      >
        {photo.isUploading || isGenerating ? (
          <div className="w-3.5 h-3.5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        ) : (
          <MoreHorizontal size={16} strokeWidth={3} />
        )}
      </button>

      <MenuOverlay
        anchorRef={btnRef}
        open={open}
        onClose={() => setOpen(false)}
        align="right"
        title={sku ? `SKU: ${sku}` : 'Stock Options'}
      >
        <div className="min-w-[240px] divide-y divide-subtle/50 text-content">
          {/* Section 2: Distribution & Printing */}
          <div className="py-1">
            <button
              type="button"
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                onAdjust();
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs font-bold uppercase tracking-wider hover:bg-surface/70 active:bg-surface transition-colors"
            >
              <Edit3 size={15} className="text-amber-400" />
              <span>{isEmpty ? 'Set distribution' : 'Full distribution editor...'}</span>
            </button>

            {sku && (
              <>
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleFlashPrint}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs font-bold uppercase tracking-wider text-amber-400 hover:bg-amber-500/10 active:bg-amber-500/20 transition-colors"
                >
                  <Zap size={15} className="text-amber-400 fill-amber-400/20" />
                  <span>Print 1 Label (Flash 1-Tap)</span>
                </button>

                <button
                  type="button"
                  role="menuitem"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpen(false);
                    void openPrint();
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs font-bold uppercase tracking-wider hover:bg-surface/70 active:bg-surface transition-colors"
                >
                  <Printer size={15} className="text-blue-400" />
                  <span>Print options...</span>
                </button>
              </>
            )}
          </div>

          {/* Section 3: Photos & History */}
          {sku && (
            <div className="py-1">
              <button
                type="button"
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  photo.openCamera();
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs font-bold uppercase tracking-wider hover:bg-surface/70 active:bg-surface transition-colors"
              >
                <Camera size={15} className="text-emerald-400" />
                <span>Take Photo (Camera)</span>
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  photo.openGallery();
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs font-bold uppercase tracking-wider hover:bg-surface/70 active:bg-surface text-muted transition-colors"
              >
                <ImagePlus size={15} className="text-muted" />
                <span>Choose from Gallery</span>
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  setHistoryOpen(true);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs font-bold uppercase tracking-wider hover:bg-surface/70 active:bg-surface transition-colors"
              >
                <History size={15} className="text-purple-400" />
                <span>Movement history</span>
              </button>
            </div>
          )}

          {/* Section 4: Utilities & Consolidation */}
          {sku && (
            <div className="py-1">
              <button
                type="button"
                role="menuitem"
                onClick={handleCopySku}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs font-bold uppercase tracking-wider hover:bg-surface/70 active:bg-surface transition-colors"
              >
                {copied ? (
                  <>
                    <Check size={15} className="text-emerald-400" />
                    <span className="text-emerald-400">Copied to Clipboard!</span>
                  </>
                ) : (
                  <>
                    <Copy size={15} className="text-muted" />
                    <span>Copy SKU</span>
                  </>
                )}
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={handleConsolidate}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs font-bold uppercase tracking-wider text-emerald-400 hover:bg-emerald-500/10 active:bg-emerald-500/20 transition-colors"
              >
                <Boxes size={15} className="text-emerald-400" />
                <span>Consolidate SKU</span>
              </button>

              {openReq ? (
                canCancel ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={handleCancelRecount}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs font-bold uppercase tracking-wider text-red-400 hover:bg-red-500/10 active:bg-red-500/20 transition-colors"
                  >
                    <RotateCcw size={15} className="text-red-400" />
                    <span>Cancel recount request</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    disabled
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs font-bold uppercase tracking-wider text-muted/50 cursor-not-allowed opacity-60"
                  >
                    <RotateCcw size={15} className="text-muted/50" />
                    <span>Recount requested</span>
                  </button>
                )
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleAskRecount}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs font-bold uppercase tracking-wider hover:bg-surface/70 active:bg-surface transition-colors"
                >
                  <ClipboardList size={15} className="text-amber-400" />
                  <span>Ask for recount</span>
                </button>
              )}
            </div>
          )}
        </div>
      </MenuOverlay>

      {/* Modals */}
      {printOpen && sku && (
        <LabelPrintOptionsModal
          title={`Print labels — ${sku}`}
          showQuantity
          initialQuantity={1}
          allQuantity={quantity ?? undefined}
          hasUpc={hasUpc}
          isBusy={isGenerating}
          onClose={() => setPrintOpen(false)}
          onConfirm={handleGenerateLabels}
        />
      )}

      {historyOpen && sku && (
        <ItemHistorySheet isOpen={historyOpen} onClose={() => setHistoryOpen(false)} sku={sku} />
      )}
    </div>
  );
}

const STROKE = '#5C2E0A'; // darker brown for outlines
const FRONT = '#E8A04A'; // amber front face
const TOP = '#F5CE7B'; // lighter top
const SIDE = '#A05A1C'; // darker right side
const FRONT_ALT = '#F0B260'; // slightly lighter front for alternating layers

// LINE bike-carton palette (idea-137: a standing JAMIS box).
const KRAFT = '#C98A4B'; // kraft cardboard face
const KRAFT_HOLE = '#7A5326'; // carry-handle cutout
const KRAFT_HOLE_STROKE = '#4A2608';
const LABEL = '#F4F1EA'; // white shipping label
const LABEL_STROKE = '#C9B79C';
const LABEL_TEXT = '#9AA0A6'; // grey text hints
const LABEL_INK = '#2B2B2B'; // barcode / QR
const JAMIS_BLUE = '#2E78B5'; // label header band

// Wood of a pallet (warm tone harmonised with the kraft cartons).
const PALLET_FRONT = '#C68A43'; // front deck boards
const PALLET_BLOCK = '#B5793A'; // support blocks

interface GlyphProps {
  type: DistributionItem['type'];
  unitsEach: number;
  /** Hide the small count drawn inside the glyph — for views that render the
   *  number large NEXT to the glyph instead (idea-137, Double-Check pick plan). */
  showNumber?: boolean;
}

/**
 * A single distribution glyph (base / top / line pallet → strapped pallet;
 * a kids bike's LINE → bike carton, TOWER → box stack) with its unit count.
 * Exported so other views (e.g. the Double-Check pick plan) can render the same
 * graphical representation used in stock view.
 */
export function DistributionGlyph({ type, unitsEach, showNumber = true }: GlyphProps) {
  if (type === 'BASE' || type === 'TOP' || type === 'LINE_PALLET')
    return <StrappedPalletGlyph kind={type} n={unitsEach} showNumber={showNumber} />;
  // Kids bikes only (idea-254 rule 10): towers and lines the floor builds as it likes.
  if (type === 'TOWER') return <BoxTowerGlyph n={unitsEach} showNumber={showNumber} />;
  // LINE → standing bike carton.
  return <BikeBoxGlyph n={unitsEach} showNumber={showNumber} />;
}

/** LINE → a standing bike carton (JAMIS box stood on its end): kraft body, an
 *  oval carry-handle near the top and a white shipping label. The unit count is
 *  drawn on the label when `showNumber` (stock/idle); views that print the
 *  number large beside the glyph pass `showNumber={false}`. */
function BikeBoxGlyph({ n, showNumber = true }: { n: number; showNumber?: boolean }) {
  return (
    <div className="relative inline-block" title={`Line · ${n}`}>
      <svg width="26" height="48" viewBox="0 0 28 52" aria-hidden>
        {/* Ground shadow */}
        <ellipse cx="14" cy="50.5" rx="10" ry="1.2" fill="black" opacity="0.18" />
        {/* Kraft carton body, standing upright */}
        <rect
          x="4"
          y="2"
          width="20"
          height="47"
          rx="3.5"
          fill={KRAFT}
          stroke={STROKE}
          strokeWidth="1.5"
        />
        {/* Oval carry-handle near the top */}
        <ellipse
          cx="14"
          cy="8.2"
          rx="4.2"
          ry="1.9"
          fill={KRAFT_HOLE}
          stroke={KRAFT_HOLE_STROKE}
          strokeWidth="0.6"
        />
        {/* White shipping label */}
        <rect
          x="6.5"
          y="15.5"
          width="15"
          height="22"
          rx="1.5"
          fill={LABEL}
          stroke={LABEL_STROKE}
          strokeWidth="0.8"
        />
        {!showNumber && (
          <>
            {/* Blue JAMIS header band */}
            <rect x="8.5" y="17.5" width="11" height="3" fill={JAMIS_BLUE} />
            {/* Text lines */}
            <line x1="8.5" y1="23" x2="18.5" y2="23" stroke={LABEL_TEXT} strokeWidth="0.9" />
            <line x1="8.5" y1="25.2" x2="19.5" y2="25.2" stroke={LABEL_TEXT} strokeWidth="0.9" />
            {/* Barcode */}
            <g stroke={LABEL_INK} strokeWidth="0.6">
              <line x1="8.5" y1="27.6" x2="8.5" y2="31.6" />
              <line x1="9.8" y1="27.6" x2="9.8" y2="31.6" />
              <line x1="10.8" y1="27.6" x2="10.8" y2="31.6" />
              <line x1="12.1" y1="27.6" x2="12.1" y2="31.6" />
            </g>
            {/* QR */}
            <rect x="15" y="27.6" width="4.2" height="4.2" fill={LABEL_INK} />
            <line x1="8.5" y1="34.5" x2="19.5" y2="34.5" stroke={LABEL_TEXT} strokeWidth="0.9" />
          </>
        )}
      </svg>
      {/* Number overlay on the label — for views that draw it inside the glyph. */}
      {showNumber && (
        <span
          className="absolute left-[6px] top-[14px] w-[14px] h-[21px] flex items-center justify-center text-[11px] font-black tabular-nums leading-none pointer-events-none"
          style={{ fontFamily: 'var(--font-heading)', color: '#3C1A04' }}
        >
          {n}
        </span>
      )}
    </div>
  );
}

/** TOWER → a 3-tier symmetric stack of bike cartons: three end-on cartons, a
 *  wide carton (long, branded side facing out) and three more — echoing how the
 *  boxes crisscross on the rack. The real JAMIS BIKES logo rides the centre
 *  carton; views that want the number inside pass `showNumber` and it overlays
 *  the centre. */
function BoxTowerGlyph({ n, showNumber = true }: { n: number; showNumber?: boolean }) {
  return (
    <div className="relative inline-block" title={`Tower · ${n}`}>
      <svg width="38" height="47" viewBox="0 0 42 52" aria-hidden>
        <ellipse cx="21" cy="50.5" rx="17" ry="1.4" fill="black" opacity="0.18" />
        {/* Top tier — three cartons seen end-on */}
        <rect
          x="3"
          y="2"
          width="11"
          height="13"
          rx="1.3"
          fill={KRAFT}
          stroke={STROKE}
          strokeWidth="1"
        />
        <rect
          x="15.5"
          y="2"
          width="11"
          height="13"
          rx="1.3"
          fill={KRAFT}
          stroke={STROKE}
          strokeWidth="1"
        />
        <rect
          x="28"
          y="2"
          width="11"
          height="13"
          rx="1.3"
          fill={KRAFT}
          stroke={STROKE}
          strokeWidth="1"
        />
        {/* Middle tier — the wide carton, long branded side facing out */}
        <rect
          x="3"
          y="16.5"
          width="36"
          height="18"
          rx="1.5"
          fill={KRAFT}
          stroke={STROKE}
          strokeWidth="1.1"
        />
        {!showNumber && (
          <image
            href={jamisLogo}
            x="6"
            y="18.5"
            width="30"
            height="14"
            preserveAspectRatio="xMidYMid meet"
          />
        )}
        {/* Bottom tier — mirrors the top */}
        <rect
          x="3"
          y="36"
          width="11"
          height="13"
          rx="1.3"
          fill={KRAFT}
          stroke={STROKE}
          strokeWidth="1"
        />
        <rect
          x="15.5"
          y="36"
          width="11"
          height="13"
          rx="1.3"
          fill={KRAFT}
          stroke={STROKE}
          strokeWidth="1"
        />
        <rect
          x="28"
          y="36"
          width="11"
          height="13"
          rx="1.3"
          fill={KRAFT}
          stroke={STROKE}
          strokeWidth="1"
        />
      </svg>
      {/* Number patch overlaid on the centre carton (views that want it inside). */}
      {showNumber && (
        <span
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded-sm text-[10px] font-black tabular-nums leading-none pointer-events-none"
          style={{
            fontFamily: 'var(--font-heading)',
            backgroundColor: '#3C1A04',
            color: '#FCD9A0',
          }}
        >
          {n}
        </span>
      )}
    </div>
  );
}

/**
 * A strapped pallet (idea-254, «todo es pallet»): cartons standing on a wood
 * pallet with the black strap across them. A base is the wide one (18), a top
 * the shorter one that rides on a base (12, drawn lifted with the base's edge
 * under it), a line pallet one row of cartons (1–12). The letter says which.
 */
function StrappedPalletGlyph({
  kind,
  n,
  showNumber = true,
}: {
  kind: 'BASE' | 'TOP' | 'LINE_PALLET';
  n: number;
  showNumber?: boolean;
}) {
  const boxes = kind === 'BASE' ? 4 : kind === 'TOP' ? 3 : 2;
  const boxH = kind === 'LINE_PALLET' ? 22 : 26;
  const lift = kind === 'TOP' ? 8 : 0;
  const width = 8 + boxes * 10;
  const letter = kind === 'BASE' ? 'B' : kind === 'TOP' ? 'T' : 'L';
  const title = kind === 'BASE' ? 'Base' : kind === 'TOP' ? 'Top' : 'Line pallet';
  const deckY = 40 - lift - 6;
  return (
    <div className="relative inline-block" title={`${title} · ${n}`}>
      <svg width={width} height="46" viewBox={`0 0 ${width} 46`} aria-hidden>
        <ellipse cx={width / 2} cy="44" rx={width / 2 - 2} ry="1.4" fill="black" opacity="0.16" />
        {kind === 'TOP' && (
          // The base it rides on, just its top edge.
          <rect
            x="1"
            y={40 - 6}
            width={width - 2}
            height="8"
            rx="1"
            fill={KRAFT}
            opacity="0.35"
            stroke={STROKE}
            strokeWidth="0.6"
            strokeDasharray="2 1.5"
          />
        )}
        {Array.from({ length: boxes }, (_, i) => (
          <rect
            key={i}
            x={4 + i * 10}
            y={deckY - boxH}
            width="9"
            height={boxH}
            rx="1.2"
            fill={KRAFT}
            stroke={STROKE}
            strokeWidth="1"
          />
        ))}
        {/* The black strap across the cartons */}
        <rect x="3" y={deckY - boxH * 0.55} width={width - 6} height="2.2" fill="#111214" />
        {/* The wood under them */}
        <rect
          x="2"
          y={deckY}
          width={width - 4}
          height="3"
          fill={PALLET_FRONT}
          stroke={STROKE}
          strokeWidth="0.6"
        />
        <rect x="3" y={deckY + 3} width="5" height="3" fill={PALLET_BLOCK} />
        <rect x={width / 2 - 2.5} y={deckY + 3} width="5" height="3" fill={PALLET_BLOCK} />
        <rect x={width - 8} y={deckY + 3} width="5" height="3" fill={PALLET_BLOCK} />
      </svg>
      <span
        className="absolute left-0 top-0 rounded-sm bg-[#111214] px-[3px] text-[8px] font-black leading-[11px] text-white pointer-events-none"
        aria-hidden
      >
        {letter}
      </span>
      {showNumber && (
        <span
          className="absolute left-1/2 top-[45%] -translate-x-1/2 -translate-y-1/2 px-1 rounded-sm text-[10px] font-black tabular-nums leading-none pointer-events-none"
          style={{
            fontFamily: 'var(--font-heading)',
            backgroundColor: '#3C1A04',
            color: '#FCD9A0',
          }}
        >
          {n}
        </span>
      )}
    </div>
  );
}

/** Scattered pile of standing/fallen sticks — empty distribution. */
function JengaPile() {
  return (
    <svg width="92" height="40" viewBox="0 0 92 40" aria-label="No distribution recorded">
      {/* ground shadow */}
      <ellipse cx="46" cy="37" rx="40" ry="2" fill="black" opacity="0.18" />
      {/* sticks at varied angles, drawn back-to-front */}
      <PileStick x={14} y={26} rot={-22} flip />
      <PileStick x={32} y={22} rot={10} />
      <PileStick x={50} y={28} rot={-8} flip />
      <PileStick x={66} y={20} rot={26} />
      <PileStick x={74} y={30} rot={-3} flip />
    </svg>
  );
}

function PileStick({ x, y, rot, flip }: { x: number; y: number; rot: number; flip?: boolean }) {
  // A stick laid down: long thin rectangle with a slim top face and side face.
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`}>
      {/* top face */}
      <polygon
        points="-12,-5 10,-5 12,-3 -10,-3"
        fill={TOP}
        stroke={STROKE}
        strokeWidth="0.4"
        strokeLinejoin="round"
      />
      {/* front face */}
      <rect
        x="-12"
        y="-3"
        width="22"
        height="6"
        fill={flip ? FRONT_ALT : FRONT}
        stroke={STROKE}
        strokeWidth="0.4"
      />
      {/* right end */}
      <polygon
        points="10,-5 12,-3 12,3 10,3"
        fill={SIDE}
        stroke={STROKE}
        strokeWidth="0.4"
        strokeLinejoin="round"
      />
    </g>
  );
}
