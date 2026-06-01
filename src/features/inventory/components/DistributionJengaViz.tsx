import { memo } from 'react';
import Plus from 'lucide-react/dist/esm/icons/plus';
import type { DistributionItem } from '../../../schemas/inventory.schema';

interface DistributionJengaVizProps {
  distribution: DistributionItem[];
  onAdjust: () => void;
}

/**
 * "Jenga" visualization of an inventory item's physical distribution (idea-126).
 *
 *   LINE  → a wide flat amber brick with the units count centered on top.
 *   TOWER → a tall narrow stack of amber bricks (Jenga tower silhouette).
 *   PALLET/OTHER → square brick fallback (TODO: dedicated visuals).
 *
 * If distribution is empty we render a "messy pile" of scattered, rotated
 * bricks to signal "stock is on the floor but uncategorized" — the operator
 * can fix it with the `+` button which opens the item edit modal.
 *
 * One glyph per physical group (each TOWER, each LINE) — we render `count`
 * copies of the matching glyph.
 */
export const DistributionJengaViz = memo(
  ({ distribution, onAdjust }: DistributionJengaVizProps) => {
    const isEmpty = !distribution || distribution.length === 0;

    return (
      <div className="flex items-center gap-2 w-full bg-surface/30 border border-subtle/40 rounded-md px-2 py-1.5 mb-1.5">
        <div className="flex-1 min-w-0 flex items-center justify-center gap-1.5 flex-wrap">
          {isEmpty ? (
            <DistributionPile />
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

interface DistributionGlyphProps {
  type: DistributionItem['type'];
  unitsEach: number;
}

const DistributionGlyph = memo(({ type, unitsEach }: DistributionGlyphProps) => {
  if (type === 'LINE') {
    // Single wide amber brick — one "line" of stock on the floor.
    return (
      <div
        className="relative h-6 w-14 rounded-[3px] bg-amber-500 border border-amber-800/70 shadow-sm flex items-center justify-center"
        title={`LINE · ${unitsEach}`}
      >
        <span
          className="text-[11px] font-black text-amber-950 leading-none tabular-nums"
          style={{ fontFamily: 'var(--font-heading)' }}
        >
          {unitsEach}
        </span>
      </div>
    );
  }

  if (type === 'TOWER') {
    // Tall narrow stack of 4 bricks alternating shade → Jenga tower silhouette.
    return (
      <div className="relative h-10 w-6 flex flex-col gap-[2px]" title={`TOWER · ${unitsEach}`}>
        <div className="flex-1 rounded-[1px] bg-amber-500 border border-amber-800/70" />
        <div className="flex-1 rounded-[1px] bg-amber-400 border border-amber-800/70" />
        <div className="flex-1 rounded-[1px] bg-amber-500 border border-amber-800/70" />
        <div className="flex-1 rounded-[1px] bg-amber-400 border border-amber-800/70" />
        <span
          className="absolute inset-0 flex items-center justify-center text-[11px] font-black text-amber-950 leading-none tabular-nums"
          style={{ fontFamily: 'var(--font-heading)' }}
        >
          {unitsEach}
        </span>
      </div>
    );
  }

  // TODO(idea-126): dedicated visuals for PALLET / OTHER. Neutral brick fallback.
  return (
    <div
      className="relative h-7 w-7 rounded-[3px] bg-amber-600 border border-amber-900/70 flex items-center justify-center"
      title={`${type} · ${unitsEach}`}
    >
      <span
        className="text-[10px] font-black text-amber-950 leading-none tabular-nums"
        style={{ fontFamily: 'var(--font-heading)' }}
      >
        {unitsEach}
      </span>
    </div>
  );
});
DistributionGlyph.displayName = 'DistributionGlyph';

/**
 * Messy pile of scattered bricks — shown when an SKU has no distribution
 * recorded. Signals "stock exists but the operator hasn't told us how it's
 * laid out on the floor". The `+` button next to the strip opens edit.
 */
const DistributionPile = memo(() => (
  <div className="relative h-10 w-20" aria-label="No distribution recorded">
    <div className="absolute left-0 bottom-0 h-2 w-10 bg-amber-500/85 border border-amber-800/60 rounded-[1px] -rotate-[14deg] shadow-sm" />
    <div className="absolute left-2 bottom-2 h-2 w-9 bg-amber-400/85 border border-amber-800/60 rounded-[1px] rotate-[8deg] shadow-sm" />
    <div className="absolute left-1 top-1 h-2 w-8 bg-amber-500/85 border border-amber-800/60 rounded-[1px] -rotate-[5deg] shadow-sm" />
    <div className="absolute right-0 top-3 h-2 w-7 bg-amber-400/85 border border-amber-800/60 rounded-[1px] rotate-[18deg] shadow-sm" />
    <div className="absolute left-3 top-5 h-2 w-6 bg-amber-500/85 border border-amber-800/60 rounded-[1px] rotate-[3deg] shadow-sm" />
  </div>
));
DistributionPile.displayName = 'DistributionPile';
