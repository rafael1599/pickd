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
 * Renders one mini-glyph per DistributionItem (no rollups, no derivation from
 * total quantity — we respect exactly what `distribution` says). Visuals:
 *   · LINE  → horizontal bar (palito) with `units_each` in the center
 *   · TOWER → vertical stack of mini-rungs forming a tower
 *   · PALLET/OTHER → square chip placeholder (TODO: dedicated symbols)
 *
 * If an entry has count > 1, we render `count` copies side by side. A "+" at
 * the right edge invokes `onAdjust` (opens edit on the item).
 */
export const DistributionJengaViz = memo(
  ({ distribution, onAdjust }: DistributionJengaVizProps) => {
    if (!distribution || distribution.length === 0) return null;

    return (
      <div className="flex items-center gap-1.5 w-full bg-surface/40 border border-subtle/60 rounded-md px-1.5 py-1 mb-1">
        <div className="flex-1 min-w-0 flex items-center gap-2 overflow-x-auto flex-wrap">
          {distribution.flatMap((d, idx) =>
            Array.from({ length: d.count }, (_, i) => (
              <DistributionGlyph
                key={`${idx}-${i}-${d.type}`}
                type={d.type}
                unitsEach={d.units_each}
              />
            ))
          )}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAdjust();
          }}
          aria-label="Adjust distribution"
          className="shrink-0 h-6 w-6 rounded-md bg-accent/15 hover:bg-accent/25 text-accent border border-accent/30 flex items-center justify-center active:scale-90 transition-transform"
        >
          <Plus size={12} strokeWidth={3} />
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
  const label = (
    <span
      className="text-[10px] font-black text-accent/90 tabular-nums leading-none"
      style={{ fontFamily: 'var(--font-heading)' }}
    >
      {unitsEach}
    </span>
  );

  if (type === 'LINE') {
    // Horizontal palito, wide-short.
    return (
      <div
        className="relative h-4 min-w-[40px] px-1.5 rounded-[3px] bg-accent/10 border border-accent/30 flex items-center justify-center"
        title={`LINE × ${unitsEach}`}
      >
        {label}
      </div>
    );
  }

  if (type === 'TOWER') {
    // Vertical stack of mini rungs — Jenga tower.
    return (
      <div
        className="relative h-7 w-5 flex flex-col items-stretch justify-between gap-[1px] py-[1px]"
        title={`TOWER × ${unitsEach}`}
      >
        <div className="h-[3px] rounded-[1px] bg-accent/40" />
        <div className="h-[3px] rounded-[1px] bg-accent/40" />
        <div className="absolute inset-0 flex items-center justify-center">{label}</div>
        <div className="h-[3px] rounded-[1px] bg-accent/40" />
        <div className="h-[3px] rounded-[1px] bg-accent/40" />
      </div>
    );
  }

  // TODO(idea-126): dedicated visuals for PALLET / OTHER (cube? grid?).
  // Falling back to a neutral chip with the count in the middle.
  return (
    <div
      className="relative h-6 w-6 rounded-[3px] bg-surface border border-subtle flex items-center justify-center"
      title={`${type} × ${unitsEach}`}
    >
      {label}
    </div>
  );
});

DistributionGlyph.displayName = 'DistributionGlyph';
