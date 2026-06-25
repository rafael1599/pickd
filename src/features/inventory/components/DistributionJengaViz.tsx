import { memo, useRef, useState } from 'react';
import MoreHorizontal from 'lucide-react/dist/esm/icons/more-horizontal';
import Edit3 from 'lucide-react/dist/esm/icons/edit-3';
import type { DistributionItem } from '../../../schemas/inventory.schema';
import { MenuOverlay } from '../../../components/ui/MenuOverlay';
import jamisLogo from './jamis-bikes.webp';

interface DistributionJengaVizProps {
  distribution: DistributionItem[];
  onAdjust: () => void;
}

/**
 * Jenga-style 3D visualization of an inventory item's physical distribution
 * (idea-126). Each glyph is drawn in SVG with isometric front/top/right faces
 * for a real wooden-block look:
 *   · LINE  → a standing bike carton (JAMIS box on its end, idea-137).
 *   · TOWER → a 3-tier stack of bike cartons (JAMIS box at the centre, idea-137).
 *   · empty → a scattered pile of sticks, signaling "stock on the floor but
 *             not yet categorized".
 */
export const DistributionJengaViz = memo(
  ({ distribution, onAdjust }: DistributionJengaVizProps) => {
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
        <DistributionMenu isEmpty={isEmpty} onAdjust={onAdjust} />
      </div>
    );
  }
);
DistributionJengaViz.displayName = 'DistributionJengaViz';

/** "..." menu next to the Jenga strip. Single item for now (Edit) but the
 *  structure leaves room for future actions (Quick add tower, Quick add line,
 *  Clear, etc.) without restructuring the button. */
function DistributionMenu({ isEmpty, onAdjust }: { isEmpty: boolean; onAdjust: () => void }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="shrink-0">
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
        title={isEmpty ? 'Set distribution' : 'Distribution options'}
        className="h-7 w-7 rounded-md bg-accent/15 hover:bg-accent/25 text-accent border border-accent/40 flex items-center justify-center active:scale-90 transition-transform"
      >
        <MoreHorizontal size={16} strokeWidth={3} />
      </button>
      <MenuOverlay anchorRef={btnRef} open={open} onClose={() => setOpen(false)} align="right">
        <div className="min-w-[180px] bg-card border border-subtle rounded-md shadow-xl py-1">
          <button
            type="button"
            role="menuitem"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onAdjust();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs font-bold uppercase tracking-wider text-content hover:bg-surface/70 active:bg-surface"
          >
            <Edit3 size={13} />
            {isEmpty ? 'Set distribution' : 'Edit distribution'}
          </button>
        </div>
      </MenuOverlay>
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

// PALLET wood palette (idea-137: warm tone harmonised with the kraft cartons).
const PALLET_TOP = '#D8A862'; // top deck (lit)
const PALLET_FRONT = '#C68A43'; // front deck boards
const PALLET_BLOCK = '#B5793A'; // support blocks
const PALLET_GAP = '#8A5E2C'; // plank seams

interface GlyphProps {
  type: DistributionItem['type'];
  unitsEach: number;
  /** Hide the small count drawn inside the glyph — for views that render the
   *  number large NEXT to the glyph instead (idea-137, Double-Check pick plan). */
  showNumber?: boolean;
}

/**
 * A single distribution glyph (LINE → bike carton, TOWER → box stack,
 * PALLET → wood pallet, OTHER → crate) with its unit count drawn in the middle.
 * Exported so other views (e.g. the Double-Check pick plan) can render the same
 * graphical representation used in stock view.
 */
export function DistributionGlyph({ type, unitsEach, showNumber = true }: GlyphProps) {
  if (type === 'TOWER') return <BoxTowerGlyph n={unitsEach} showNumber={showNumber} />;
  if (type === 'PALLET') return <WoodPalletGlyph n={unitsEach} showNumber={showNumber} />;
  if (type === 'OTHER') return <JengaCrate n={unitsEach} showNumber={showNumber} />;
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

/** PALLET → a wooden warehouse pallet in perspective: a slatted top deck
 *  receding to the back, and a front face with two fork openings between three
 *  support blocks. Wood tone, warmer than the kraft cartons. showNumber overlays
 *  the unit count on the front face. */
function WoodPalletGlyph({ n, showNumber = true }: { n: number; showNumber?: boolean }) {
  return (
    <div className="relative inline-block" title={`Pallet · ${n}`}>
      <svg width="46" height="31" viewBox="0 0 60 40" aria-hidden>
        {/* Ground shadow */}
        <ellipse cx="30" cy="35.6" rx="25" ry="1.6" fill="black" opacity="0.16" />
        {/* Top deck — perspective parallelogram, receding to the back */}
        <polygon
          points="3,18 8,8 52,8 57,18"
          fill={PALLET_TOP}
          stroke={STROKE}
          strokeWidth="0.8"
          strokeLinejoin="round"
        />
        {/* Plank seams across the deck */}
        <g stroke={PALLET_GAP} strokeWidth="0.7" opacity="0.6">
          <line x1="4" y1="16" x2="56" y2="16" />
          <line x1="5" y1="14" x2="55" y2="14" />
          <line x1="6" y1="12" x2="54" y2="12" />
          <line x1="7" y1="10.2" x2="53" y2="10.2" />
        </g>
        {/* Front face — top + bottom deck boards */}
        <rect
          x="3"
          y="18"
          width="54"
          height="3.6"
          fill={PALLET_FRONT}
          stroke={STROKE}
          strokeWidth="0.7"
        />
        <rect
          x="3"
          y="28.4"
          width="54"
          height="3.6"
          fill={PALLET_FRONT}
          stroke={STROKE}
          strokeWidth="0.7"
        />
        {/* Three support blocks — the two gaps between them are the fork openings */}
        <rect
          x="3"
          y="21.6"
          width="9"
          height="6.8"
          fill={PALLET_BLOCK}
          stroke={STROKE}
          strokeWidth="0.7"
        />
        <rect
          x="25.5"
          y="21.6"
          width="9"
          height="6.8"
          fill={PALLET_BLOCK}
          stroke={STROKE}
          strokeWidth="0.7"
        />
        <rect
          x="48"
          y="21.6"
          width="9"
          height="6.8"
          fill={PALLET_BLOCK}
          stroke={STROKE}
          strokeWidth="0.7"
        />
      </svg>
      {/* Number patch overlaid on the front face (views that want it inside). */}
      {showNumber && (
        <span
          className="absolute left-1/2 top-[62%] -translate-x-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded-sm text-[10px] font-black tabular-nums leading-none pointer-events-none"
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

/** Generic crate — fallback for `OTHER` type. Plain isometric cube. */
function JengaCrate({ n, showNumber = true }: { n: number; showNumber?: boolean }) {
  return (
    <div className="relative inline-block" title={`Other · ${n}`}>
      <svg width="32" height="40" viewBox="0 0 32 40" aria-hidden>
        {/* top */}
        <polygon
          points="4,10 22,10 28,5 10,5"
          fill={TOP}
          stroke={STROKE}
          strokeWidth="0.7"
          strokeLinejoin="round"
        />
        {/* front */}
        <rect x="4" y="10" width="18" height="22" fill={FRONT} stroke={STROKE} strokeWidth="0.7" />
        {/* right */}
        <polygon
          points="22,10 28,5 28,27 22,32"
          fill={SIDE}
          stroke={STROKE}
          strokeWidth="0.7"
          strokeLinejoin="round"
        />
        {/* Crate strap detail on front (a horizontal line + a vertical) */}
        <line x1="4" y1="20" x2="22" y2="20" stroke={STROKE} strokeWidth="0.6" opacity="0.6" />
        <line x1="13" y1="10" x2="13" y2="32" stroke={STROKE} strokeWidth="0.6" opacity="0.6" />
        {/* Ground shadow */}
        <ellipse cx="15" cy="35" rx="12" ry="1.4" fill="black" opacity="0.22" />
      </svg>
      {showNumber && (
        <span
          className="absolute left-[4px] top-[10px] w-[18px] h-[22px] flex items-center justify-center text-[11px] font-black tabular-nums leading-none pointer-events-none"
          style={{ fontFamily: 'var(--font-heading)', color: '#3C1A04' }}
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
