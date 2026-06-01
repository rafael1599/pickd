import { memo } from 'react';
import Plus from 'lucide-react/dist/esm/icons/plus';
import type { DistributionItem } from '../../../schemas/inventory.schema';

interface DistributionJengaVizProps {
  distribution: DistributionItem[];
  onAdjust: () => void;
}

/**
 * Jenga-style 3D visualization of an inventory item's physical distribution
 * (idea-126). Each glyph is drawn in SVG with isometric front/top/right faces
 * for a real wooden-block look:
 *   · LINE  → one standing Jenga piece (single block).
 *   · TOWER → classic Jenga tower silhouette (alternating crisscross layers).
 *   · empty → a scattered pile of sticks, signaling "stock on the floor but
 *             not yet categorized".
 */
export const DistributionJengaViz = memo(
  ({ distribution, onAdjust }: DistributionJengaVizProps) => {
    const isEmpty = !distribution || distribution.length === 0;

    return (
      <div className="flex items-center gap-2 w-full bg-surface/30 border border-subtle/40 rounded-md px-2 py-2 mb-1.5">
        <div className="flex-1 min-w-0 flex items-end justify-center gap-2.5 flex-wrap">
          {isEmpty ? (
            <JengaPile />
          ) : (
            distribution.flatMap((d, idx) =>
              Array.from({ length: d.count }, (_, i) => (
                <DistributionGlyph
                  key={`${idx}-${i}-${d.type}`}
                  type={d.type}
                  unitsEach={d.units_each}
                />
              ))
            )
          )}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAdjust();
          }}
          aria-label="Adjust distribution"
          title={isEmpty ? 'Set distribution' : 'Adjust distribution'}
          className="shrink-0 h-7 w-7 rounded-md bg-accent/15 hover:bg-accent/25 text-accent border border-accent/40 flex items-center justify-center active:scale-90 transition-transform"
        >
          <Plus size={14} strokeWidth={3} />
        </button>
      </div>
    );
  }
);
DistributionJengaViz.displayName = 'DistributionJengaViz';

const STROKE = '#5C2E0A'; // darker brown for outlines
const FRONT = '#E8A04A'; // amber front face
const TOP = '#F5CE7B'; // lighter top
const SIDE = '#A05A1C'; // darker right side
const FRONT_ALT = '#F0B260'; // slightly lighter front for alternating layers

interface GlyphProps {
  type: DistributionItem['type'];
  unitsEach: number;
}

function DistributionGlyph({ type, unitsEach }: GlyphProps) {
  if (type === 'TOWER') return <JengaTower n={unitsEach} />;
  // LINE + Pallet/Other fallback → standing stick.
  return <JengaStick n={unitsEach} />;
}

/** Single standing Jenga block — isometric 3D look. */
function JengaStick({ n }: { n: number }) {
  return (
    <div className="relative inline-block" title={`Line · ${n}`}>
      <svg width="24" height="44" viewBox="0 0 24 44" aria-hidden>
        {/* Top face (parallelogram) */}
        <polygon
          points="3,5 17,5 21,9 7,9"
          fill={TOP}
          stroke={STROKE}
          strokeWidth="0.7"
          strokeLinejoin="round"
        />
        {/* Front face */}
        <rect x="3" y="9" width="14" height="32" fill={FRONT} stroke={STROKE} strokeWidth="0.7" />
        {/* Right side face (parallelogram) */}
        <polygon
          points="17,9 21,9 21,37 17,41"
          fill={SIDE}
          stroke={STROKE}
          strokeWidth="0.7"
          strokeLinejoin="round"
        />
        {/* Wood grain hints on front */}
        <line x1="5" y1="14" x2="15" y2="14" stroke={STROKE} strokeWidth="0.3" opacity="0.35" />
        <line x1="5" y1="20" x2="15" y2="20" stroke={STROKE} strokeWidth="0.3" opacity="0.35" />
        <line x1="5" y1="32" x2="15" y2="32" stroke={STROKE} strokeWidth="0.3" opacity="0.35" />
        {/* Ground shadow */}
        <ellipse cx="11" cy="42" rx="9" ry="1.2" fill="black" opacity="0.22" />
      </svg>
      {/* Number overlay on the front face */}
      <span
        className="absolute left-[3px] top-[9px] w-[14px] h-[32px] flex items-center justify-center text-[11px] font-black tabular-nums leading-none pointer-events-none"
        style={{ fontFamily: 'var(--font-heading)', color: '#3C1A04' }}
      >
        {n}
      </span>
    </div>
  );
}

/** Jenga tower — 5 alternating crisscross layers. */
function JengaTower({ n }: { n: number }) {
  const layers = [0, 1, 2, 3, 4]; // bottom → top
  const layerH = 7;
  const baseY = 6;
  return (
    <div className="relative inline-block" title={`Tower · ${n}`}>
      <svg width="34" height="50" viewBox="0 0 34 50" aria-hidden>
        {/* Ground shadow */}
        <ellipse cx="17" cy="47" rx="13" ry="1.4" fill="black" opacity="0.22" />
        {layers.map((idx) => {
          const y = baseY + (layers.length - 1 - idx) * layerH; // build top-down
          // Even layer = 3 sticks side by side (ends-on view).
          // Odd layer = 1 wide block (long side facing front), rotated 90°.
          const isPerp = idx % 2 === 0;
          if (isPerp) {
            return (
              <g key={idx}>
                {/* top of layer (thin lighter band) */}
                <rect
                  x="5"
                  y={y}
                  width="6"
                  height={layerH}
                  fill={FRONT}
                  stroke={STROKE}
                  strokeWidth="0.5"
                />
                <rect
                  x="13"
                  y={y}
                  width="6"
                  height={layerH}
                  fill={FRONT}
                  stroke={STROKE}
                  strokeWidth="0.5"
                />
                <rect
                  x="21"
                  y={y}
                  width="6"
                  height={layerH}
                  fill={FRONT}
                  stroke={STROKE}
                  strokeWidth="0.5"
                />
                {/* top edges */}
                <line x1="5" y1={y + 1} x2="11" y2={y + 1} stroke={TOP} strokeWidth="1.2" />
                <line x1="13" y1={y + 1} x2="19" y2={y + 1} stroke={TOP} strokeWidth="1.2" />
                <line x1="21" y1={y + 1} x2="27" y2={y + 1} stroke={TOP} strokeWidth="1.2" />
              </g>
            );
          }
          return (
            <g key={idx}>
              <rect
                x="5"
                y={y}
                width="22"
                height={layerH}
                fill={FRONT_ALT}
                stroke={STROKE}
                strokeWidth="0.5"
              />
              <line x1="5" y1={y + 1} x2="27" y2={y + 1} stroke={TOP} strokeWidth="1.2" />
            </g>
          );
        })}
      </svg>
      {/* Number patch overlaid center of the tower */}
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
